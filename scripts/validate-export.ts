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
import { readChatLogFile } from "@validator/readChatLogFile";
import { validateChatLog } from "@validator/validateChatLog";
import { truncateChatLog } from "@validator/truncateChatLog";
import { formatBytes } from "@validator/utils/formatBytes";

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

/* Extract Logs --------------------------------------------------------------*/

const readResult = await readChatLogFile(file);

if (readResult.status !== "extracted") {
  console.error(
    "(!) Failed to extract chat logs:",
    readResult.status === "empty" ? "No valid files found" : readResult.error.message,
  );
  process.exit(1);
}

log("> Extracted chat logs");

/* Parse Extracted JSON ------------------------------------------------------*/

let data: unknown;

try {
  data = JSON.parse(readResult.content);
} catch (e) {
  console.error("(!) Failed to parse JSON:", e instanceof Error ? e.message : "Uknown error");
}

log("> Parsed JSON");

/* Validate Chat Log ---------------------------------------------------------*/

const result = validateChatLog(data);

if (result.type !== "success") {
  console.error("(!) Could not validate chat log");
  result.errors.forEach((s) => console.error("    |", s));
  process.exit(1);
}

log("> Validated chat log content from source:", formatSource(result.data.source));

const fullSize = Buffer.byteLength(readResult.content, "utf8");

log(`> Chat log size: ${formatBytes(fullSize)}`);

/* Truncate Chat Log ---------------------------------------------------------*/

const truncated = options.truncateDays
  ? truncateChatLog(result, subDays(new Date(), options.truncateDays)).data.content
  : result.data.content;

if (options.truncateDays) {
  const truncatedSize = Buffer.byteLength(JSON.stringify(truncated), "utf8");
  const sign = fullSize > truncatedSize ? "-" : "";

  log(`> Truncated chat log to ${options.truncateDays} days`);
  log(`> Truncated size: ${formatBytes(truncatedSize)}`);
  log(`> Size diff: ${sign}${formatBytes(fullSize - truncatedSize)}`);
} else {
  warn("> Skipped truncation");
}

/* Output Data ---------------------------------------------------------------*/

if (options.output) {
  try {
    options.output.file.write(JSON.stringify(truncated));
    log(`Wrote output logs to: ${options.output.path}`);
  } catch (e) {
    console.error(`(!) Could not write output to: ${options.output.path}`);
    process.exit(1);
  }
}

if (options.raw) {
  console.log(JSON.stringify(truncated));
  process.exit(0);
}
