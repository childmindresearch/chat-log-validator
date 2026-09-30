import { describe, it, expect } from "bun:test";
import JSZip from "jszip";
import { readChatLogFile } from "../utils/readChatLogFile";
import * as R from "remeda";

async function makeZip(entries: Record<string, string>, name = "export.zip"): Promise<File> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  return new File([bytes], name, { type: "application/zip" });
}

async function makeNestedZip(
  entries: Record<string, [string, string]>,
  name = "export.zip",
): Promise<File> {
  const zip = new JSZip();

  for (const [path, [nestedPath, content]] of R.entries(entries)) {
    const nestedZip = new JSZip();
    nestedZip.file(nestedPath, content);
    const nestedZipData = await nestedZip.generateAsync({ type: "arraybuffer" });
    zip.file(path, nestedZipData);
  }

  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  return new File([bytes], name, { type: "application/zip" });
}

async function zipWithConversations(name: string, type: string) {
  const zip = new JSZip();
  zip.file("conversations.json", "[]");
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  return new File([bytes], name, { type });
}

describe("zip: single-file path", () => {
  it("finds conversations.json anywhere in the archive", async () => {
    const file = await makeZip({ "some/nested/conversations.json": '[{"a":1}]' });
    const r = await readChatLogFile(file);

    expect(r).toMatchObject({
      status: "extracted",
      content: '[{"a":1}]',
      inputFileType: "zip",
    });
    if (r.status === "extracted") expect(r.input.name).toBe("export.zip"); // outer zip name
  });

  it("finds Gemini Apps/MyActivity.json", async () => {
    const content = JSON.stringify([
      { header: "header", title: "title", time: "2026-09-23T12:00:00.000Z" },
    ]);
    const file = await makeZip({ "Takeout/Gemini Apps/MyActivity.json": content });
    const r = await readChatLogFile(file);
    expect(r.status).toBe("extracted");
  });

  it("skips directories", async () => {
    const zip = new JSZip();
    zip.folder("conversations.json");
    const bytes = await zip.generateAsync({ type: "arraybuffer" });
    const r = await readChatLogFile(new File([bytes], "x.zip", { type: "application/zip" }));
    expect(r).toMatchObject({
      status: "empty",
      inputFileType: "zip",
      reason: expect.stringContaining("known chat log"),
    });
    if (r.status === "empty") expect(r.input.name).toBe("x.zip");
  });
});

describe("zip: multi-file path", () => {
  it("concatenates conversations-NNN.json in name order", async () => {
    const file = await makeZip({
      // insertion order deliberately shuffled — sortBy must fix it
      "conversations-001.json": '[{"n":2}]',
      "conversations-000.json": '[{"n":1}]',
      "conversations-002.json": '[{"n":3}]',
    });
    const r = await readChatLogFile(file);

    expect(r.status).toBe("extracted");
    if (r.status === "extracted") {
      expect(JSON.parse(r.content)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
      expect(r.extracted.name).toBe("conversations.json");
    }
  });

  it("prefers the numbered set over a plain conversations.json", async () => {
    const file = await makeZip({
      "conversations.json": '[{"conversation_id":"x","id":"y","is_anonymous":true,"title":"stub"}]',
      "conversations-000.json": '[{"n":1}]',
    });
    const r = await readChatLogFile(file);
    expect(r).toMatchObject({ status: "extracted", content: '[{"n":1}]' });
  });

  it("is empty when one part is invalid JSON", async () => {
    const file = await makeZip({
      "conversations-000.json": "[]",
      "conversations-001.json": "not json",
    });
    const r = await readChatLogFile(file);
    expect(r).toMatchObject({
      status: "empty",
      reason: expect.stringContaining("multiple sources"),
    });
  });

  it("is empty when a part is not an array", async () => {
    const file = await makeZip({ "conversations-000.json": '{"obj":true}' });
    const r = await readChatLogFile(file);
    expect(r).toMatchObject({
      status: "empty",
      reason: expect.stringContaining("multiple sources"),
    });
  });

  it("accepts nested ChatGPT zips", async () => {
    const nestedChatGPTZip = await makeNestedZip({
      "/User Online Activity/Conversations__abcdef-chatgpt-0001.zip": [
        "conversations.json",
        '[{"message": "hello1"}]',
      ],
      "/User Online Activity/Conversations__abcdef-chatgpt-0002.zip": [
        "conversations.json",
        '[{"message": "hello2"}]',
      ],
      "/User Online Activity/Conversations__abcdef-chatgpt-0003.zip": [
        "conversations.json",
        '[{"message": "hello3"}]',
      ],
    });
    const r = await readChatLogFile(nestedChatGPTZip);
    expect(r).toMatchObject({
      status: "extracted",
      content: '[{"message":"hello1"},{"message":"hello2"},{"message":"hello3"}]',
    });
  });

  it("rejects nested ChatGPT zips with invalid data", async () => {
    const nestedChatGPTZip = await makeNestedZip({
      "/User Online Activity/Conversations__abcdef-chatgpt-0001.zip": [
        "conversations.json",
        '[{"message": "hello1"}]',
      ],
      "/User Online Activity/Conversations__abcdef-chatgpt-0002.zip": [
        "conversations.json",
        '[{"message": "hello2"}]',
      ],
      "/User Online Activity/Conversations__abcdef-chatgpt-0003.zip": [
        "conversations.json",
        '[{"message": "hello3"}',
      ],
    });
    const r = await readChatLogFile(nestedChatGPTZip);
    expect(r).toMatchObject({
      status: "empty",
      reason: expect.stringContaining("multiple sources"),
    });
  });
});

describe("zip: gemini path", () => {
  const rec = (time: string, title = "t") => ({ header: "header", title, time });

  it("merges, dedupes, and sorts activity by time into MyActivity.json", async () => {
    const file = await makeZip({
      "Takeout/Gemini Apps/MyActivity.json": JSON.stringify([
        rec("2026-09-23T12:00:00.000Z", "b"),
        rec("2026-09-22T12:00:00.000Z", "a"),
      ]),
      "Takeout/Gemini Apps/MyActivity(1).json": JSON.stringify([
        rec("2026-09-22T12:00:00.000Z", "a"), // duplicate
        rec("2026-09-24T12:00:00.000Z", "c"),
      ]),
    });
    const r = await readChatLogFile(file);

    expect(r.status).toBe("extracted");
    if (r.status === "extracted") {
      expect(JSON.parse(r.content).map((x: { title: string }) => x.title)).toEqual(["a", "b", "c"]);
      expect(r.extracted.name).toBe("MyActivity.json");
      expect(r.input.name).toBe("export.zip");
    }
  });

  it("skips non-array and non-record entries", async () => {
    const file = await makeZip({
      "Gemini Apps/MyActivity.json": JSON.stringify([rec("2026-09-23T12:00:00.000Z"), { junk: 1 }]),
      "Gemini Apps/other.json": '{"not":"array"}',
    });
    const r = await readChatLogFile(file);
    expect(r.status === "extracted" && JSON.parse(r.content)).toHaveLength(1);
  });

  it("is empty when no valid activity records exist", async () => {
    const file = await makeZip({ "Gemini Apps/MyActivity.json": '[{"junk":1}]' });
    const r = await readChatLogFile(file);
    expect(r).toMatchObject({
      status: "empty",
      reason: expect.stringContaining("no activity records"),
    });
  });
});

describe("zip: precedence", () => {
  const geminiRecord = JSON.stringify([
    { header: "h", title: "t", time: "2026-09-23T12:00:00.000Z" },
  ]);

  it("gemini beats plain conversations.json", async () => {
    const file = await makeZip({
      "conversations.json": '["single"]',
      "Gemini Apps/MyActivity.json": geminiRecord,
    });
    const r = await readChatLogFile(file);
    expect(r.status === "extracted" && r.extracted.name).toBe("MyActivity.json");
  });

  it("gemini beats numbered conversations", async () => {
    const file = await makeZip({
      "Gemini Apps/MyActivity.json": geminiRecord,
      "conversations-000.json": '["multi"]',
    });
    const r = await readChatLogFile(file);
    expect(r.status === "extracted" && r.extracted.name).toBe("MyActivity.json");
  });

  it("empty gemini activity does not fall through to chatgpt files", async () => {
    const file = await makeZip({
      "Gemini Apps/MyActivity.json": "[]",
      "conversations.json": '["single"]',
    });
    const r = await readChatLogFile(file);
    expect(r).toMatchObject({ status: "empty" });
  });
});

describe("zip: empty", () => {
  it("returns the original file as input when nothing matches", async () => {
    const file = await makeZip({ "readme.txt": "hi", "data/other.json": "{}" });
    const r = await readChatLogFile(file);
    expect(r).toMatchObject({ status: "empty", inputFileType: "zip" });
    if (r.status === "empty") expect(r.input).toBe(file);
  });

  it("handles an empty archive", async () => {
    const r = await readChatLogFile(await makeZip({}));
    expect(r).toMatchObject({ status: "empty" });
  });
});

describe("zip: failure modes", () => {
  it("rejects a non-zip file named .zip", async () => {
    const r = await readChatLogFile(
      new File(["definitely not a zip"], "fake.zip", { type: "application/zip" }),
    );
    expect(r).toMatchObject({
      status: "error",
      error: { message: expect.stringContaining("not a valid zip") },
    });
  });
});

describe("zip: detection", () => {
  it("detects by mime type when the name lacks .zip", async () => {
    const r = await readChatLogFile(
      await zipWithConversations("export", "application/x-zip-compressed"),
    );
    expect(r).toMatchObject({ status: "extracted", inputFileType: "zip" });
  });

  it("detects by extension when mime type is empty", async () => {
    const r = await readChatLogFile(await zipWithConversations("export.ZIP", ""));
    expect(r).toMatchObject({ status: "extracted", inputFileType: "zip" });
  });
});

describe("plain json", () => {
  it("reads by extension even with empty mime type", async () => {
    const file = new File(['{"x":1}'], "log.JSON", { type: "" });
    const r = await readChatLogFile(file);
    expect(r).toMatchObject({ status: "extracted", content: '{"x":1}', inputFileType: "json" });
    if (r.status === "extracted") expect(r.extracted).toBe(file);
  });
});

describe("rejected types", () => {
  it("names the extension and sets log: false", async () => {
    const r = await readChatLogFile(new File(["x"], "notes.txt", { type: "text/plain" }));
    expect(r).toMatchObject({
      status: "error",
      error: { message: expect.stringContaining(".txt"), log: false },
    });
  });

  it("uses the generic message for a file with no extension", async () => {
    const r = await readChatLogFile(new File(["x"], "README", { type: "text/plain" }));
    expect(r).toMatchObject({
      status: "error",
      error: { message: "Invalid file type", log: false },
    });
  });
});
