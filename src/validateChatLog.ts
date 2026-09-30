import { z } from "zod";
import { $ZodIssueBase } from "zod/v4/core";
import {
  ClaudeConversationArraySchema,
  ChatGPTConversationArraySchema,
  GeminiPromptArraySchema,
  ValidSourceDataMap,
  ValidSource,
  ValidDataT,
} from "@/schema";

function formatIssues(issues: $ZodIssueBase[]) {
  return issues.map((issue) => {
    const [lineIndex, ...rest] = issue.path;
    const lineNumber = typeof lineIndex === "number" ? lineIndex : "?";
    const location = rest.length ? ` (${rest.join(".")})` : "";
    return `Index ${lineNumber}${location}: ${issue.message}`;
  });
}

// Parsing failures

export type JSONParsingFailure = {
  type: "invalid_json_failure";
  errors: string[];
  data: {
    source: ValidSource | "unknown";
    content: string;
  };
};

export type MissingParsingFailure = {
  type: "missing_failure";
  errors: string[];
  data: {
    source: ValidSource;
    content: null;
  };
};

export type ParsingFailure = JSONParsingFailure | MissingParsingFailure;

/* -----------------------------------------------------------------------------
 * Generic Conversation Validation
 * -------------------------------------------------------------------------- */

type ValidationSuccessT<S extends ValidSource> = {
  type: "success";
  data: ValidDataT<S>;
};

export type ValidationSuccess = { [S in ValidSource]: ValidationSuccessT<S> }[ValidSource];

export type SafeValidationFailureReason = "empty_after_truncation" | null;

export type SafeValidationFailure = {
  type: "safe_failure";
  errors: string[];
  reason?: SafeValidationFailureReason;
  data: {
    source: ValidSource | "unknown";
    content: any;
  };
};

export type UnknownValidationFailure = {
  type: "unknown_failure";
  errors: string[];
  data: {
    source: ValidSource | "unknown";
    content: any;
  };
};

export type ValidationFailure = SafeValidationFailure | UnknownValidationFailure;

export type ValidationResult = ValidationSuccess | ValidationFailure;

export type UnknownResult = {
  type: "unknown";
  data: unknown;
};

function validateWith<S extends ValidSource>(
  schema: z.ZodType,
  data: unknown,
  source: S,
): ValidationSuccessT<S> | SafeValidationFailure {
  const result = schema.safeParse(data);

  if (result.success) {
    return {
      type: "success",
      data: {
        content: result.data as ValidSourceDataMap[S],
        source,
      },
    };
  }

  return {
    type: "safe_failure",
    errors: formatIssues(result.error.issues),
    data: {
      source,
      content: data,
    },
  };
}

/**
 * Validates chat log file content and returns validation results.
 *
 * @param data - Raw file content string
 * @returns ValidationResult - An object with validation status and array of errors
 */
export function validateChatLog(data: unknown): ValidationResult {
  const sample = Array.isArray(data) ? data[0] : data;

  if (sample && typeof sample === "object") {
    if ("chat_messages" in sample) {
      return validateWith(ClaudeConversationArraySchema, data, "claude");
    }
    if ("mapping" in sample) {
      return validateWith(ChatGPTConversationArraySchema, data, "chatgpt");
    }
    if ("activityControls" in sample) {
      return validateWith(GeminiPromptArraySchema, data, "gemini");
    }
  }

  return {
    type: "unknown_failure",
    errors: ["Unknown source"],
    data: {
      source: "unknown",
      content: data,
    },
  };
}
