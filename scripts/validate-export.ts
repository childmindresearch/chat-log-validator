#!/usr/bin/env bun
/*
 * validate-export.ts
 *
 * Takes a chat log export as input, extracts the conversations, concatenates,
 * validates, and optionally truncates them.
 *
 * Usage: validate-export [options]
 *
 * Options:
 *   -i --input <path>          chat log export file path (.zip or .json)
 *   -t --truncate-days <days>  truncate messages older than: today - days
 *   -o --output <path>         save validated/truncated data to output file path
 *   -r --raw                   output raw string to stdout (default: false)
 *   -h, --help                 display help for command
 */

import { extname, basename } from "path";
import { styleText } from "node:util";

import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { subDays } from "date-fns";
import { z } from "zod";
import "zod/compile";

import { formatSource } from "@validator/schema";
import { formatBytes } from "@validator/utils/formatBytes";
import { processExport, PipelineError } from "@validator/index";

/* Parse Args ----------------------------------------------------------------*/

const IntStrSchema = z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1));
const InputExtSchema = z.enum([".zip", ".json"]);

function resolveTruncateDaysOpt(i: string) {
  const result = IntStrSchema.safeParse(i);
  if (!result.success) throw new InvalidArgumentError("Must be an integer > 0");
  return result.data;
}

function resolveInputPathOpt(path: string) {
  const result = InputExtSchema.safeParse(extname(path));
  if (!result.success) throw new InvalidArgumentError("Not a .zip or .json path");

  const file = Bun.file(path);
  if (!file.exists()) throw new InvalidArgumentError("Input file does not exist");

  return { path, ext: result.data, file };
}

function resolveOutputPathOpt(path: string) {
  return { path: path, file: Bun.file(path) };
}

const program = new Command()
  .requiredOption(
    "-i --input <path>",
    "chat log export file path (.zip or .json)",
    resolveInputPathOpt,
  )
  .option(
    "-t --truncate-days <days>",
    "truncate messages older than: today - days",
    resolveTruncateDaysOpt,
  )
  .option(
    "-o --output <path>",
    "save validated/truncated data to output file path",
    resolveOutputPathOpt,
  )
  .option("-r --raw", "output raw string to stdout", false)
  .configureHelp({
    styleTitle: (s) => styleText("bold", s),
    styleCommandText: (s) => styleText("cyan", s),
    styleOptionText: (s) => styleText("green", s),
    styleArgumentText: (s) => styleText("yellow", s),
    styleDescriptionText: (s) => styleText("dim", s),
  })
  .showHelpAfterError()
  .parse();

const options = program.opts();

/* Helpers -------------------------------------------------------------------*/

function log(...args: string[]) {
  if (!options.raw) {
    console.log(...args.map((s) => styleText("blue", s)));
  }
}

function warn(...args: string[]) {
  if (!options.raw) {
    console.log(...args.map((s) => styleText("yellow", s)));
  }
}

/* Read File -----------------------------------------------------------------*/

let file: File;

try {
  const buffer = await options.input.file.arrayBuffer();
  file = new File([buffer], basename(options.input.path), {
    type: extname(options.input.ext) === ".zip" ? "application/zip" : "application/json",
  });
} catch (e) {
  console.error(`(!) Could not read file: ${options.input.path}`);
  process.exit(1);
}

log("> Read file:", options.input.path);

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

const truncateBefore = options.truncateDays ? subDays(new Date(), options.truncateDays) : undefined;

try {
  const { encode } = await processExport(file, {
    truncateBefore,
    debug: ({ stage, artifacts }) => {
      switch (stage) {
        case "extract":
          log("> Extracted chat logs");
          log(`> Chat log size: ${formatBytes(artifacts.extract.extracted.size)}`);
          return;
        case "parse":
          log("> Parsed JSON");
          return;
        case "validate":
          log("> Validated chat log from source:", formatSource(artifacts.validate.data.source));
          return;
        case "truncate":
          if (truncateBefore) log(`> Truncated chat log to ${options.truncateDays} days`);
          else warn("> Skipped truncation");
          return;
        case "encode":
          if (truncateBefore) {
            const fullSize = artifacts.extract.extracted.size;
            const truncatedSize = bytes(artifacts.encode);
            const sign = fullSize > truncatedSize ? "-" : "";
            log(`> Truncated size: ${formatBytes(truncatedSize)}`);
            log(`> Size diff: ${sign}${formatBytes(fullSize - truncatedSize)}`);
          }
          return;
      }
    },
  });

  if (options.raw) {
    console.log(encode);
  }

  if (options.output) {
    try {
      options.output.file.write(encode);
      log(`> Wrote output logs to: ${options.output.path}`);
    } catch (e) {
      console.error(`(!) Could not write output to: ${options.output.path}`);
      process.exit(1);
    }
  }
} catch (e) {
  if (!(e instanceof PipelineError)) throw e;

  console.error(`(!) [${e.failure.stage}] ${e.failure.message}`);

  if (e.failure.stage === "validate") {
    e.failure.detail.errors.forEach((s) => console.error("    |", s));
    const contentBytes = bytes(e.failure.prior.extract.content);
    console.error(`    input was ${formatBytes(contentBytes)} of valid JSON`);
  }

  process.exit(1);
}
