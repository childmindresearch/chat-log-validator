import JSZip from "jszip";
import { VFile } from "vfile";
import * as R from "remeda";
import { BaseGeminiPromptSchema, BaseGeminiPrompt } from "@validator/schema";

// Types -----------------------------------------------------------------------

export type ReadChatLogFileErrorFn = (error: ReadChatLogFileError) => void;

export type ReadChatLogFileFn = (file: File) => Promise<void>;

export type InputFileType = "json" | "zip";

export interface ReadChatLogFileError {
  message: string;
  log?: boolean;
}

export type ReadChatLogFileResult =
  | {
      status: "extracted";
      input: File;
      inputFileType: InputFileType;
      extracted: File;
      content: string;
    }
  | { status: "empty"; input: File; inputFileType: "zip"; reason: string }
  | { status: "error"; error: ReadChatLogFileError };

// File Path Checks ------------------------------------------------------------

function isValidSingleFilePath(name: string) {
  const file = new VFile({ path: name });
  return file.basename === "conversations.json";
}

function isGeminiActivityPath(name: string) {
  return /(^|\/)gemini apps\/[^/]+\.json$/i.test(name);
}

function isArchive(name: string) {
  const file = new VFile({ path: name });
  return file.extname?.toLowerCase() === ".zip";
}

function isValidMultiFilePath(name: string) {
  const file = new VFile({ path: name });
  const match = file.basename?.match(/^conversations-\d+\.json$/);
  return !!match;
}

// Gemini Archive Parsing ------------------------------------------------------

function isGeminiRecord(data: unknown): data is BaseGeminiPrompt {
  return BaseGeminiPromptSchema.validate(data);
}

async function mergeGeminiEntries(entries: JSZip.JSZipObject[]) {
  const records: BaseGeminiPrompt[] = [];

  for (const entry of R.sortBy(entries, (e) => e.name)) {
    const parsed: unknown = JSON.parse(await entry.async("string"));

    if (!Array.isArray(parsed)) {
      continue;
    }

    records.push(...parsed.filter(isGeminiRecord));
  }

  const deduped = R.uniqueBy(records, (r) => JSON.stringify(r));
  return R.sortBy(deduped, (r) => r.time);
}

// ChatGPT File Concatenation -------------------------------------------------

async function concatChatGPTFiles(
  files: File[],
  extracted: (content: string, name: string) => ReadChatLogFileResult,
  empty: (reason: string) => ReadChatLogFileResult,
) {
  try {
    const results: unknown[][] = [];

    for (const entry of R.sortBy(files, (e) => e.name)) {
      const parsed: unknown = JSON.parse(await entry.text());

      if (!Array.isArray(parsed)) {
        throw new Error(`${entry.name} is not a JSON array`);
      }

      results.push(parsed);
    }

    return extracted(JSON.stringify(results.flat()), "conversations.json");
  } catch {
    return empty("Failed to compile conversations.json from multiple sources");
  }
}

// Readers ---------------------------------------------------------------------

let MAX_ARCHIVE_DEPTH: number | null = null;

export function setMaxArchiveDepth(depth: number | null) {
  MAX_ARCHIVE_DEPTH = depth;
}

async function scanArchive(input: File, blob: Blob, depth: number): Promise<ReadChatLogFileResult> {
  const extracted = (content: string, name: string): ReadChatLogFileResult => ({
    status: "extracted",
    input,
    inputFileType: "zip",
    extracted: new File([content], name, { type: "application/json" }),
    content,
  });

  const empty = (reason: string): ReadChatLogFileResult => ({
    status: "empty",
    input,
    inputFileType: "zip",
    reason,
  });

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await blob.arrayBuffer());
  } catch {
    return depth === 0
      ? { status: "error", error: { message: "Archive is not a valid zip file" } }
      : empty("Nested archive is not a valid zip file");
  }

  const files = Object.values(zip.files).filter((e) => !e.dir);

  const geminiEntries = files.filter((e) => isGeminiActivityPath(e.name));

  if (geminiEntries.length > 0) {
    try {
      const merged = await mergeGeminiEntries(geminiEntries);

      if (merged.length === 0) {
        return empty("Gemini export contains no activity records");
      }

      return extracted(JSON.stringify(merged), "MyActivity.json");
    } catch {
      return empty("Failed to compile Gemini activity from archive");
    }
  }

  // ChatGPT sometimes splits exports into conversations-000.json, conversations-001.json, ...
  // These take priority over a plain conversations.json, which in split exports
  // can be a stub containing only conversation ids and titles.
  const chatGPTEntries = files.filter((e) => isValidMultiFilePath(e.name));

  if (chatGPTEntries.length > 0) {
    const jsonFiles = await Promise.all(
      chatGPTEntries.map(async (e) => new File([await e.async("blob")], e.name)),
    );
    return concatChatGPTFiles(jsonFiles, extracted, empty);
  }

  const entry = files.find((e) => isValidSingleFilePath(e.name));

  if (entry) {
    return extracted(await entry.async("string"), entry.name);
  }

  const nestedArchives = R.sortBy(
    files.filter((e) => isArchive(e.name)),
    (e) => e.name,
  );

  if (nestedArchives.length > 0) {
    if (MAX_ARCHIVE_DEPTH !== null && depth >= MAX_ARCHIVE_DEPTH) {
      return empty("Archive is nested too deeply");
    }

    const results: Extract<ReadChatLogFileResult, { status: "extracted" }>[] = [];

    for (const archive of nestedArchives) {
      const result = await scanArchive(input, await archive.async("blob"), depth + 1);

      if (result.status !== "extracted") {
        return result.status === "error" ? result : empty(result.reason);
      }

      results.push(result);
    }

    const jsonFiles = results.map((r) => r.extracted);

    return concatChatGPTFiles(jsonFiles, extracted, empty);
  }

  return empty("Archive does not contain any known chat log files");
}

export async function readArchive(input: File): Promise<ReadChatLogFileResult> {
  return scanArchive(input, input, 0);
}

async function readJSON(input: File): Promise<ReadChatLogFileResult> {
  try {
    const content = await input.text();
    return { status: "extracted", input, inputFileType: "json", extracted: input, content };
  } catch {
    return { status: "error", error: { message: "Failed to read file" } };
  }
}

// Main ------------------------------------------------------------------------

export async function readChatLogFile(input: File): Promise<ReadChatLogFileResult> {
  if (input.type.includes("zip") || input.name.toLowerCase().endsWith(".zip")) {
    return readArchive(input);
  }

  if (input.type.includes("json") || input.name.toLowerCase().endsWith(".json")) {
    return readJSON(input);
  }

  const extname = new VFile({ path: input.name }).extname?.toLowerCase();
  const message = extname ? `Invalid file type: ${extname}` : "Invalid file type";
  return { status: "error", error: { message, log: false } };
}
