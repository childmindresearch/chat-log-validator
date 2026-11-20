import { $ZodIssueBase } from "zod/v4/core";
import {
  ValidSourceDataMap,
  ValidSource,
  ValidDataT,
  validSourceSchemaMap,
} from "@validator/schema";

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

export type SafeValidationFailureReason = "validation_failed" | null;

export type ValidationFailureData = {
  source: ValidSource | "unknown";
  content: any;
};

export type SafeValidationFailure = {
  type: "safe_failure";
  errors: string[];
  reason?: SafeValidationFailureReason;
  data: ValidationFailureData;
};

export type UnknownValidationFailure = {
  type: "unknown_failure";
  errors: string[];
  data: ValidationFailureData;
};

export type ValidationFailure = SafeValidationFailure | UnknownValidationFailure;

export type ValidationResult = ValidationSuccess | ValidationFailure;

export type UnknownResult = {
  type: "unknown";
  data: unknown;
};

function validateWith<S extends ValidSource>(
  source: S,
  data: unknown,
): ValidationSuccessT<S> | SafeValidationFailure {
  const schema = validSourceSchemaMap[source];
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
    reason: "validation_failed",
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
      return validateWith("claude", data);
    }
    if ("mapping" in sample) {
      return validateWith("chatgpt", data);
    }
    if ("createTimeUtc" in sample) {
      return validateWith("chatgpt_v2", data);
    }
    if ("activityControls" in sample) {
      return validateWith("gemini", data);
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
