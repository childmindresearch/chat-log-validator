import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert";

import { validateChatLog } from "@/validateChatLog";
import {
  truncateChatGPTChatLog,
  truncateClaudeChatLog,
  truncateGeminiChatLog,
} from "@/truncateChatLog";

describe("truncateClaudeChatLog", () => {
  const filePath = path.join(import.meta.dir, "data", "valid-claude-conversations.json");
  const fileContent = JSON.parse(readFileSync(filePath).toString());
  const result = validateChatLog(fileContent);
  assert(result.type === "success");

  it("truncates logs to last 5 days of history", () => {
    assert(result.data.source === "claude");
    const truncated = truncateClaudeChatLog(result.data, new Date("2026-07-27"));
    expect(truncated.content).toMatchSnapshot();
  });

  it("returns data unchanged given a large enough window", () => {
    assert(result.data.source === "claude");
    const truncated = truncateClaudeChatLog(result.data, new Date("2000-01-01"));
    expect(truncated.content).toStrictEqual(result.data.content);
  });
});

describe("truncateChatGPTChatLog", () => {
  const filePath = path.join(import.meta.dir, "data", "valid-chatgpt-conversations.json");
  const fileContent = JSON.parse(readFileSync(filePath).toString());
  const result = validateChatLog(fileContent);
  assert(result.type === "success");

  it("truncates logs to last 5 days of history", () => {
    assert(result.data.source === "chatgpt");
    const truncated = truncateChatGPTChatLog(result.data, new Date("2026-07-27"));
    expect(truncated.content).toMatchSnapshot();
  });

  it("returns data unchanged given a large enough window", () => {
    assert(result.data.source === "chatgpt");
    const truncated = truncateChatGPTChatLog(result.data, new Date("2000-01-01"));
    expect(truncated.content).toStrictEqual(result.data.content);
  });
});

describe("truncateGeminiChatLog", () => {
  const filePath = path.join(import.meta.dir, "data", "valid-gemini-activity.json");
  const fileContent = JSON.parse(readFileSync(filePath).toString());
  const result = validateChatLog(fileContent);
  assert(result.type === "success");

  it("truncates logs to last 5 days of history", () => {
    assert(result.data.source === "gemini");
    const truncated = truncateGeminiChatLog(result.data, new Date("2026-07-27"));
    expect(truncated.content).toMatchSnapshot();
  });

  it("returns data unchanged given a large enough window", () => {
    assert(result.data.source === "gemini");
    const truncated = truncateGeminiChatLog(result.data, new Date("2000-01-01"));
    expect(truncated.content).toStrictEqual(result.data.content);
  });
});
