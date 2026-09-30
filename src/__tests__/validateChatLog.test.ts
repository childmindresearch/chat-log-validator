import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert";

import { validateChatLog } from "@shared/validateChatLog";

describe("validateChatLog", () => {
  describe("invalid chat logs", () => {
    it("should detect missing messages field", () => {
      const content = JSON.stringify({ data: ["hello"] });
      const result = validateChatLog(content);
      assert(result.type === "unknown_failure");
      expect(result.errors).toStrictEqual(["Unknown source"]);
      expect(result.data.source).toBe("unknown");
    });
  });
});

describe("validateClaudeChatLog", () => {
  describe("valid chat logs", () => {
    const filePath = path.join(import.meta.dir, "data", "valid-claude-conversations.json");
    const fileContent = JSON.parse(readFileSync(filePath).toString());

    it("should validate a valid conversation", () => {
      const result = validateChatLog(fileContent);

      assert(result.type === "success");
      expect(result.data.source).toBe("claude");
      expect(result.data.content).toStrictEqual(fileContent);
    });
  });

  describe("invalid chat logs", () => {
    const filePath = path.join(import.meta.dir, "data", "invalid-claude-conversations.json");
    const fileContent = JSON.parse(readFileSync(filePath).toString());

    it("should detect invalid conversation", () => {
      const result = validateChatLog(fileContent);

      expect(result).toStrictEqual({
        type: "safe_failure",
        errors: [
          "Index 0 (account): Invalid input: expected object, received undefined",
          "Index 0 (chat_messages.0.content.0): Invalid input",
          "Index 0 (chat_messages.1.created_at): Invalid input: expected string, received undefined",
          "Index 0 (chat_messages.1.sender): Invalid input",
          "Index 0 (chat_messages.1.updated_at): Invalid input: expected string, received undefined",
        ],
        data: {
          source: "claude",
          content: fileContent,
        },
      });
    });
  });
});

describe("validateChatGPTChatLog", () => {
  describe("valid chat logs", () => {
    const filePath = path.join(import.meta.dir, "data", "valid-chatgpt-conversations.json");
    const fileContent = JSON.parse(readFileSync(filePath).toString());

    it("should validate a valid conversation", () => {
      const result = validateChatLog(fileContent);

      assert(result.type === "success");
      expect(result.data.source).toBe("chatgpt");
      expect(result.data.content).toStrictEqual(fileContent);
    });
  });

  describe("invalid chat logs", () => {
    const filePath = path.join(import.meta.dir, "data", "invalid-chatgpt-conversations.json");
    const fileContent = JSON.parse(readFileSync(filePath).toString());

    it("should detect invalid conversation", () => {
      const result = validateChatLog(fileContent);

      expect(result).toStrictEqual({
        type: "safe_failure",
        errors: [
          'Index 0 (mapping.1b5080e5-1d55-4b82-8d71-d2f8c6cba33e.message.author.role): Invalid option: expected one of "user"|"assistant"|"system"|"tool"',
        ],
        data: {
          source: "chatgpt",
          content: fileContent,
        },
      });
    });
  });
});

describe("validateGeminiChatLog", () => {
  describe("valid chat logs", () => {
    const filePath = path.join(import.meta.dir, "data", "valid-gemini-activity.json");
    const fileContent = JSON.parse(readFileSync(filePath).toString());

    it("should validate a valid conversation", () => {
      const result = validateChatLog(fileContent);

      assert(result.type === "success");
      expect(result.data.source).toBe("gemini");
      expect(result.data.content).toStrictEqual(fileContent);
    });
  });

  describe("invalid chat logs", () => {
    const filePath = path.join(import.meta.dir, "data", "invalid-gemini-activity.json");
    const fileContent = JSON.parse(readFileSync(filePath).toString());

    it("should detect invalid conversation", () => {
      const result = validateChatLog(fileContent);

      expect(result).toStrictEqual({
        type: "safe_failure",
        errors: ["Index 0 (activityControls): Invalid input: expected array, received null"],
        data: {
          source: "gemini",
          content: fileContent,
        },
      });
    });
  });
});
