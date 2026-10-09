import { describe, it, expect, spyOn, mock, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { Effect } from "effect";
import JSZip from "jszip";

import {
  Config,
  Failure,
  StageError,
  extract,
  parseJson,
  validate,
  truncate,
  processChatLog,
} from "@validator/pipeline";
import * as truncateModule from "@validator/stages/truncateChatLog";
import { validateChatLog, ValidationSuccess } from "@validator/stages/validateChatLog";

/* -----------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------- */

const fixturePath = (name: string) => path.join(import.meta.dir, "data", name);

function fixtureFile(name: string) {
  return new File([readFileSync(fixturePath(name))], name, { type: "application/json" });
}

function fixtureJson(name: string): unknown {
  return JSON.parse(readFileSync(fixturePath(name)).toString());
}

function validFixture(name: string): ValidationSuccess {
  const result = validateChatLog(fixtureJson(name));
  assert(result.type === "success");
  return result;
}

async function makeZip(entries: Record<string, string>, name = "export.zip"): Promise<File> {
  const zip = new JSZip();
  for (const [p, content] of Object.entries(entries)) zip.file(p, content);
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  return new File([bytes], name, { type: "application/zip" });
}

const withConfig =
  (config: Config["Service"] = {}) =>
  <A, E>(effect: Effect.Effect<A, E, Config>) =>
    Effect.provideService(effect, Config, config);

/** Run an effect expected to succeed. */
const succeed = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

/** Run an effect expected to fail, resolving with its error. */
const fail = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(effect));

/* -----------------------------------------------------------------------------
 * extract
 * -------------------------------------------------------------------------- */

describe("extract", () => {
  it("succeeds with the extracted result for a json file", async () => {
    const file = new File(['{"x":1}'], "log.json", { type: "application/json" });
    const result = await succeed(extract(file));

    expect(result).toMatchObject({
      status: "extracted",
      content: '{"x":1}',
      inputFileType: "json",
    });
  });

  it("fails with the read error message for an unsupported file type", async () => {
    const error = await fail(extract(new File(["x"], "notes.txt", { type: "text/plain" })));

    expect(error).toBeInstanceOf(StageError);
    expect(error.message).toBe("Invalid file type: .txt");
    expect(error.detail).toMatchObject({ status: "error", error: { log: false } });
  });

  it("fails with a generic message when an archive has no chat logs", async () => {
    const error = await fail(extract(await makeZip({ "readme.txt": "hi" })));

    expect(error.message).toBe("No valid files found");
    expect(error.detail).toMatchObject({
      status: "empty",
      reason: expect.stringContaining("known chat log"),
    });
  });
});

/* -----------------------------------------------------------------------------
 * parseJson
 * -------------------------------------------------------------------------- */

describe("parseJson", () => {
  it("parses valid JSON", async () => {
    expect(await succeed(parseJson('[{"a":1}]'))).toStrictEqual([{ a: 1 }]);
  });

  it("fails with the SyntaxError as cause", async () => {
    const error = await fail(parseJson("not json"));

    expect(error).toBeInstanceOf(StageError);
    expect(error.cause).toBeInstanceOf(SyntaxError);
    expect(error.message).toBe((error.cause as SyntaxError).message);
    expect(error.detail).toBeUndefined();
  });
});

/* -----------------------------------------------------------------------------
 * validate
 * -------------------------------------------------------------------------- */

describe("validate", () => {
  it("succeeds with the validation result for a valid chat log", async () => {
    const json = fixtureJson("valid-gemini-activity.json");
    const result = await succeed(validate(json));

    expect(result.type).toBe("success");
    expect(result.data.source).toBe("gemini");
  });

  it("fails with the safe failure as detail for an invalid chat log", async () => {
    const error = await fail(validate(fixtureJson("invalid-claude-conversations.json")));

    expect(error.message).toBe("Could not validate chat log");
    expect(error.detail).toMatchObject({ type: "safe_failure", reason: "validation_failed" });
  });

  it("fails with the unknown failure as detail for an unrecognised source", async () => {
    const error = await fail(validate({ data: ["hello"] }));

    expect(error.detail).toMatchObject({ type: "unknown_failure", errors: ["Unknown source"] });
  });
});

/* -----------------------------------------------------------------------------
 * truncate
 * -------------------------------------------------------------------------- */

describe("truncate", () => {
  const valid = validFixture("valid-claude-conversations.json");

  afterEach(() => mock.restore());

  it("returns the input untouched when truncateBefore is not configured", async () => {
    const result = await succeed(truncate(valid).pipe(withConfig()));

    expect(result).toBe(valid);
  });

  it("truncates when truncateBefore is configured", async () => {
    const truncateBefore = new Date("2025-12-26");
    const result = await succeed(truncate(valid).pipe(withConfig({ truncateBefore })));

    expect(result).toStrictEqual(truncateModule.truncateChatLog(valid, truncateBefore));
    assert(result.data.source === "claude" && valid.data.source === "claude");
    expect(result.data.content.length).toBeLessThan(valid.data.content.length);
  });

  it("fails with the thrown error as cause", async () => {
    const thrown = new Error("failed operation");
    spyOn(truncateModule, "truncateChatLog").mockImplementation(() => {
      throw thrown;
    });

    const error = await fail(
      truncate(valid).pipe(withConfig({ truncateBefore: new Date("2025-12-26") })),
    );

    expect(error).toBeInstanceOf(StageError);
    expect(error.message).toBe("failed operation");
    expect(error.cause).toBe(thrown);
  });
});

/* -----------------------------------------------------------------------------
 * processChatLog
 * -------------------------------------------------------------------------- */

describe("processChatLog", () => {
  afterEach(() => mock.restore());

  describe("success", () => {
    it.each([
      ["claude", "valid-claude-conversations.json"],
      ["chatgpt", "valid-chatgpt-conversations.json"],
      ["gemini", "valid-gemini-activity.json"],
    ] as const)("collects every stage's value for a valid %s log", async (source, name) => {
      const artifacts = await succeed(processChatLog(fixtureFile(name)).pipe(withConfig()));

      expect(Object.keys(artifacts)).toStrictEqual([
        "extract",
        "parse",
        "validate",
        "truncate",
        "final",
      ]);
      expect(artifacts.extract.status).toBe("extracted");
      expect(artifacts.parse).toStrictEqual(fixtureJson(name));
      expect(artifacts.validate.data.source).toBe(source);
      expect(artifacts.truncate).toBe(artifacts.validate);
      expect(artifacts.final).toBe(artifacts.truncate);
    });

    it("reads chat logs out of a zip archive", async () => {
      const content = readFileSync(fixturePath("valid-chatgpt-conversations.json")).toString();
      const artifacts = await succeed(
        processChatLog(await makeZip({ "conversations.json": content })).pipe(withConfig()),
      );

      expect(artifacts.extract.inputFileType).toBe("zip");
      expect(artifacts.final.data.source).toBe("chatgpt");
    });

    it("applies the configured truncation to the final result", async () => {
      const truncateBefore = new Date("2025-12-26");
      const artifacts = await succeed(
        processChatLog(fixtureFile("valid-claude-conversations.json")).pipe(
          withConfig({ truncateBefore }),
        ),
      );

      expect(artifacts.truncate).not.toBe(artifacts.validate);
      expect(artifacts.final).toStrictEqual(
        truncateModule.truncateChatLog(artifacts.validate, truncateBefore),
      );
    });
  });

  describe("failure", () => {
    it("fails at extract with no prior context", async () => {
      const failure = await fail(
        processChatLog(new File(["x"], "notes.txt", { type: "text/plain" })).pipe(withConfig()),
      );

      expect(failure).toBeInstanceOf(Failure);
      expect(failure._tag).toBe("Failure");
      assert(failure.stage === "extract");
      expect(failure.message).toBe("Invalid file type: .txt");
      expect(failure.detail).toMatchObject({ status: "error" });
      expect(failure.prior).toStrictEqual({});
    });

    it("fails at parse with the extract result as prior context", async () => {
      const file = new File(["not json"], "log.json", { type: "application/json" });
      const failure = await fail(processChatLog(file).pipe(withConfig()));

      assert(failure.stage === "parse");
      expect(failure.cause).toBeInstanceOf(SyntaxError);
      expect(Object.keys(failure.prior)).toStrictEqual(["extract"]);
      expect(failure.prior.extract).toMatchObject({ status: "extracted", content: "not json" });
    });

    it("fails at validate with extract and parse results as prior context", async () => {
      const failure = await fail(
        processChatLog(fixtureFile("invalid-chatgpt-conversations.json")).pipe(withConfig()),
      );

      assert(failure.stage === "validate");
      expect(failure.message).toBe("Could not validate chat log");
      expect(failure.detail.type).toBe("safe_failure");
      expect(Object.keys(failure.prior)).toStrictEqual(["extract", "parse"]);
      expect(failure.prior.parse).toStrictEqual(fixtureJson("invalid-chatgpt-conversations.json"));
    });

    it("fails at truncate with everything before it as prior context", async () => {
      const thrown = new Error("failed operation");
      spyOn(truncateModule, "truncateChatLog").mockImplementation(() => {
        throw thrown;
      });

      const failure = await fail(
        processChatLog(fixtureFile("valid-gemini-activity.json")).pipe(
          withConfig({ truncateBefore: new Date("2025-12-26") }),
        ),
      );

      assert(failure.stage === "truncate");
      expect(failure.message).toBe("failed operation");
      expect(failure.cause).toBe(thrown);
      expect(Object.keys(failure.prior)).toStrictEqual(["extract", "parse", "validate"]);
      expect(failure.prior.validate.data.source).toBe("gemini");
    });
  });
});
