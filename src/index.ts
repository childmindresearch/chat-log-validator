import { Effect } from "effect";
import {
  processChatLog,
  Config,
  AnyFailure,
  Artifacts,
  Debug,
  DebugEventFn,
} from "@validator/pipeline";

export type Options = {
  truncateBefore?: Date;
  debug?: DebugEventFn;
};

export type PipelineArtifacts = Artifacts;

type FailureData<F extends AnyFailure> = F extends unknown
  ? Pick<F, "stage" | "message" | "detail" | "prior" | "cause">
  : never;

export type PipelineFailure = FailureData<AnyFailure>;

export class PipelineError extends Error {
  constructor(readonly failure: PipelineFailure) {
    super(`[${failure.stage}] ${failure.message}`, { cause: failure.cause });
    this.name = "PipelineError";
  }
}

export type SafeResult =
  | { ok: true; artifacts: PipelineArtifacts }
  | { ok: false; failure: PipelineFailure };

export const safeProcessExport = (file: File, options: Options = {}): Promise<SafeResult> =>
  processChatLog(file).pipe(
    Effect.provideService(Config, options),
    Effect.provideService(Debug, options.debug ?? (() => {})),
    Effect.match({
      onSuccess: (artifacts) => ({ ok: true as const, artifacts }),
      onFailure: ({ stage, message, detail, prior, cause }) => ({
        ok: false as const,
        failure: { stage, message, detail, prior, cause } as PipelineFailure,
      }),
    }),
    Effect.runPromise,
  );

export async function processExport(file: File, options: Options = {}): Promise<PipelineArtifacts> {
  const result = await safeProcessExport(file, options);
  if (!result.ok) throw new PipelineError(result.failure);
  return result.artifacts;
}
