import { Context as Ctx, Data, Effect } from "effect";

import { readChatLogFile } from "@validator/stages/readChatLogFile";
import { validateChatLog } from "@validator/stages/validateChatLog";
import { truncateChatLog } from "@validator/stages/truncateChatLog";

/* Config --------------------------------------------------------------------*/

export class Config extends Ctx.Service<
  Config,
  {
    readonly truncateBefore?: Date;
  }
>()("Config") {}

/* Errors --------------------------------------------------------------------*/

// raised by a single step
export class StageError<Detail = undefined> extends Data.TaggedError("StageError")<{
  message: string;
  detail: Detail;
  cause?: unknown;
}> {}

// returned by the pipeline: the stage error plus everything that succeeded before it
export class Failure<Stage extends string, Detail, Prior> extends Data.TaggedError("Failure")<{
  stage: Stage;
  message: string;
  detail: Detail;
  cause?: unknown;
  prior: Prior;
}> {}

const thrown = (cause: unknown) =>
  new StageError({
    message: cause instanceof Error ? cause.message : String(cause),
    detail: undefined,
    cause,
  });

/* Result types --------------------------------------------------------------*/

type ReadResult = Awaited<ReturnType<typeof readChatLogFile>>;
type Extracted = Extract<ReadResult, { status: "extracted" }>;
type NotExtracted = Exclude<ReadResult, { status: "extracted" }>;

type ValidateResult = ReturnType<typeof validateChatLog>;
type Validated = Extract<ValidateResult, { type: "success" }>;
type Invalid = Exclude<ValidateResult, { type: "success" }>;

/* Debug ---------------------------------------------------------------------*/

type DebugFn = (event: { stage: string; artifacts: object }) => void;

export const Debug = Ctx.Reference<DebugFn>("Debug", {
  defaultValue: () => () => {},
});

const debugStage = (stage: string, artifacts: object) =>
  Effect.gen(function* () {
    const debug = yield* Debug;
    debug({ stage, artifacts });
  });

/* Steps ---------------------------------------------------------------------*/

export const extract = (file: File): Effect.Effect<Extracted, StageError<NotExtracted>> =>
  Effect.promise(() => readChatLogFile(file)).pipe(
    Effect.flatMap((result) =>
      result.status === "extracted"
        ? Effect.succeed(result)
        : Effect.fail(
            new StageError({
              message: result.status === "empty" ? "No valid files found" : result.error.message,
              detail: result,
            }),
          ),
    ),
  );

export const parseJson = (body: string) =>
  Effect.try({ try: () => JSON.parse(body) as unknown, catch: thrown });

export const validate = (json: unknown): Effect.Effect<Validated, StageError<Invalid>> => {
  const result = validateChatLog(json);
  return result.type === "success"
    ? Effect.succeed(result)
    : Effect.fail(new StageError({ message: "Could not validate chat log", detail: result }));
};

export const truncate = (valid: Validated) =>
  Effect.gen(function* () {
    const { truncateBefore } = yield* Config;
    return yield* Effect.try({
      try: () => (truncateBefore ? truncateChatLog(valid, truncateBefore) : valid),
      catch: thrown,
    });
  });

export const encode = (valid: Validated) =>
  Effect.try({ try: () => JSON.stringify(valid.data.content), catch: thrown });

/* Pipeline ------------------------------------------------------------------*/

/** A stage's work: reads the context built so far and yields this stage's value. */
type Run<Prior, Value, Detail, Req> = (
  prior: Prior,
) => Effect.Effect<Value, StageError<Detail>, Req>;

/** The context after a stage succeeds: everything before it, plus its value under its name. */
type Extended<Prior, Name extends string, Value> = Prior & Record<Name, Value>;

/** Add a stage's value to the context. */
function extend<Prior extends object, Name extends string, Value>(
  prior: Prior,
  name: Name,
  value: Value,
) {
  return { ...prior, [name]: value } as Extended<Prior, Name, Value>;
}

/** Promote a step's error to a pipeline failure by attaching the stage name and prior context. */
function toFailure<Name extends string, Detail, Prior>(
  stage: Name,
  { message, detail, cause }: StageError<Detail>,
  prior: Prior,
) {
  return new Failure({ stage, message, detail, cause, prior });
}

/**
 * Append a named stage to a pipeline.
 *
 * On success, the stage's value is added to the context under `name`.
 * On failure, the error becomes a `Failure` carrying the context so far as `prior`.
 */

function step<Name extends string, Prior extends object, Value, Detail, Req>(
  name: Name,
  run: Run<Prior, Value, Detail, Req>,
) {
  type A = Extended<Prior, Name, Value>;
  type E2 = Failure<Name, Detail, Prior>;
  return <E, R>(pipeline: Effect.Effect<Prior, E, R>): Effect.Effect<A, E | E2, R | Req> =>
    Effect.flatMap(pipeline, (prior) =>
      run(prior).pipe(
        Effect.map((value) => extend(prior, name, value)),
        Effect.mapError((error) => toFailure(name, error, prior)),
        Effect.tap((result) => debugStage(name, result)),
      ),
    );
}

export function processChatLog(file: File) {
  return Effect.succeed({}).pipe(
    step("extract", () => extract(file)),
    step("parse", ({ extract }) => parseJson(extract.content)),
    step("validate", ({ parse }) => validate(parse)),
    step("truncate", ({ validate }) => truncate(validate)),
    step("encode", ({ truncate }) => encode(truncate)),
  );
}

/* Derived types -------------------------------------------------------------*/

type Pipeline = ReturnType<typeof processChatLog>;

export type Artifacts = Effect.Success<Pipeline>;
export type AnyFailure = Effect.Error<Pipeline>;
export type Stage = AnyFailure["stage"];

type EventOf<F extends AnyFailure> = F extends unknown
  ? { stage: F["stage"]; artifacts: F["prior"] & Pick<Artifacts, F["stage"]> }
  : never;

export type DebugEvent = EventOf<AnyFailure>;
export type DebugEventFn = (event: DebugEvent) => void;
