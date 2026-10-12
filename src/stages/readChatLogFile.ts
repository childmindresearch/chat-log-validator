import JSZip from "jszip";
import { VFile } from "vfile";
import * as R from "remeda";
import { InputFileType, BaseGeminiPromptSchema, BaseGeminiPrompt } from "@validator/schema";

// Types -----------------------------------------------------------------------

const EMPTY_MESSAGES = {
  archive_contains_no_known_files: "Archive does not contain any known chat log files",
  invalid_nested_archive: "Nested archive is not a valid zip file",
  archive_nested_too_deeply: "Archive is nested too deeply",
  empty_gemini_export: "Gemini export contains no activity records",
  failed_to_compile_gemini_activity: "Failed to compile Gemini activity from archive",
  failed_to_compile_conversations: "Failed to compile conversations.json from multiple sources",
} as const;

const ERROR_MESSAGES = {
  invalid_zip_file: "Archive is not a valid zip file",
  unsupported_file: "Invalid file type",
  file_read_failed: "Failed to read file",
} as const;

export type EmptyReason = keyof typeof EMPTY_MESSAGES;
export type FileErrorReason = keyof typeof ERROR_MESSAGES;

export type ReadChatLogFileResult =
  | {
      status: "extracted";
      input: File;
      inputFileType: InputFileType;
      extracted: File;
      content: string;
    }
  | { status: "empty"; input: File; inputFileType: "zip"; message: string; reason: EmptyReason }
  | { status: "error"; message: string; reason: FileErrorReason };

const failed = (
  reason: FileErrorReason,
  message: string = ERROR_MESSAGES[reason],
): ReadChatLogFileResult => ({ status: "error", reason, message });

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
  empty: (reason: EmptyReason) => ReadChatLogFileResult,
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
    return empty("failed_to_compile_conversations");
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

  const empty = (reason: EmptyReason): ReadChatLogFileResult => ({
    status: "empty",
    input,
    inputFileType: "zip",
    reason,
    message: EMPTY_MESSAGES[reason],
  });

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await blob.arrayBuffer());
  } catch {
    return depth === 0 ? failed("invalid_zip_file") : empty("invalid_nested_archive");
  }

  const files = Object.values(zip.files).filter((e) => !e.dir);

  const geminiEntries = files.filter((e) => isGeminiActivityPath(e.name));

  if (geminiEntries.length > 0) {
    try {
      const merged = await mergeGeminiEntries(geminiEntries);

      if (merged.length === 0) {
        return empty("empty_gemini_export");
      }

      return extracted(JSON.stringify(merged), "MyActivity.json");
    } catch {
      return empty("failed_to_compile_gemini_activity");
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
      return empty("archive_nested_too_deeply");
    }

    const results: Extract<ReadChatLogFileResult, { status: "extracted" }>[] = [];

    let firstEmpty: Extract<ReadChatLogFileResult, { status: "empty" }> | null = null;

    for (const archive of nestedArchives) {
      const result = await scanArchive(input, await archive.async("blob"), depth + 1);

      if (result.status === "error") {
        return result;
      }

      if (result.status === "empty") {
        firstEmpty ??= result;
        continue;
      }

      results.push(result);
    }

    if (results.length === 0) {
      return firstEmpty ?? empty("archive_contains_no_known_files");
    }

    const jsonFiles = results.map((r) => r.extracted);

    return concatChatGPTFiles(jsonFiles, extracted, empty);
  }

  return empty("archive_contains_no_known_files");
}

export async function readArchive(input: File): Promise<ReadChatLogFileResult> {
  return scanArchive(input, input, 0);
}

async function readJSON(input: File): Promise<ReadChatLogFileResult> {
  try {
    const content = await input.text();
    return { status: "extracted", input, inputFileType: "json", extracted: input, content };
  } catch {
    return failed("file_read_failed");
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
  return failed(
    "unsupported_file",
    extname ? `${ERROR_MESSAGES.unsupported_file}: ${extname}` : undefined,
  );
}
