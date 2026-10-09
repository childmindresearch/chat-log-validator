import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert";
import * as R from "remeda";

import { validateChatLog, ValidationSuccess } from "@validator/stages/validateChatLog";
import {
  truncateChatLog,
  truncateChatGPTChatLog,
  truncateClaudeChatLog,
  truncateGeminiChatLog,
} from "@validator/stages/truncateChatLog";
import {
  ChatGPTConversation,
  ChatGPTMapping,
  ChatGPTRole,
  ClaudeChatMessage,
  ClaudeConversation,
  GeminiPrompt,
  ValidDataT,
} from "@validator/schema";

/* -----------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------- */

const CUTOFF = new Date("2026-01-01T00:00:00.000Z");
const HOUR = 60 * 60 * 1000;

const offset = (ms: number) => new Date(CUTOFF.getTime() + ms);
const iso = (ms: number) => offset(ms).toISOString();
const unix = (ms: number) => offset(ms).getTime() / 1000;

function loadFixture(name: string) {
  const filePath = path.join(import.meta.dir, "data", name);
  const result = validateChatLog(JSON.parse(readFileSync(filePath).toString()));
  assert(result.type === "success");
  return result.data;
}

function claudeMessage(createdAt: string, text = ""): ClaudeChatMessage {
  return {
    uuid: crypto.randomUUID(),
    parent_message_uuid: crypto.randomUUID(),
    sender: "human",
    text,
    content: [],
    attachments: [],
    files: [],
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function claudeConversation(messages: ClaudeChatMessage[]): ClaudeConversation {
  return {
    uuid: crypto.randomUUID(),
    account: { uuid: crypto.randomUUID() },
    name: "Test conversation",
    summary: "",
    created_at: messages[0]?.created_at ?? iso(0),
    updated_at: messages[messages.length - 1]?.created_at ?? iso(0),
    chat_messages: messages,
  };
}

/** Builds a linear ChatGPT conversation under a message-less root node. */
function chatgptConversation(createTimes: (number | null)[]): ChatGPTConversation {
  const rootId = crypto.randomUUID();
  const ids = createTimes.map(() => crypto.randomUUID());
  const mapping = R.reduce(
    createTimes,
    (acc: ChatGPTMapping, createTime, i) => {
      const id = ids[i]!;
      const role: ChatGPTRole = i % 2 === 0 ? "user" : "assistant";
      return {
        ...acc,
        [id]: {
          id,
          parent: i === 0 ? rootId : ids[i - 1]!,
          children: ids.slice(i + 1, i + 2),
          message: {
            id,
            author: { role },
            create_time: createTime,
            content: { content_type: "text", parts: [] },
          },
        },
      };
    },
    { [rootId]: { id: rootId, parent: null, children: ids.slice(0, 1), message: null } },
  );

  return { id: crypto.randomUUID(), title: "Test", create_time: 0, update_time: 0, mapping };
}

function geminiPrompt(time: string, title = "Prompted test"): GeminiPrompt {
  return {
    header: "Gemini Apps",
    title,
    time,
    products: ["Gemini Apps"],
    activityControls: ["Gemini Apps Activity"],
  };
}

const claude = (content: ClaudeConversation[]): ValidDataT<"claude"> => ({
  source: "claude",
  content,
});

const chatgpt = (content: ChatGPTConversation[]): ValidDataT<"chatgpt"> => ({
  source: "chatgpt",
  content,
});

const gemini = (content: GeminiPrompt[]): ValidDataT<"gemini"> => ({ source: "gemini", content });

/* -----------------------------------------------------------------------------
 * Claude
 * -------------------------------------------------------------------------- */

describe("truncateClaudeChatLog", () => {
  const data = loadFixture("valid-claude-conversations.json");
  assert(data.source === "claude");

  it("truncates logs to last 5 days of history", () => {
    const truncated = truncateClaudeChatLog(data, new Date("2025-12-26"));
    expect(truncated.content).toMatchSnapshot();
  });

  it("returns data unchanged given a large enough window", () => {
    const truncated = truncateClaudeChatLog(data, new Date("2000-01-01"));
    expect(truncated.content).toStrictEqual(data.content);
  });

  it("keeps messages after the cutoff and drops messages before it", () => {
    const old = claudeMessage(iso(-HOUR), "old");
    const recent = claudeMessage(iso(HOUR), "recent");
    const truncated = truncateClaudeChatLog(claude([claudeConversation([old, recent])]), CUTOFF);

    expect(truncated.content).toHaveLength(1);
    expect(truncated.content[0]!.chat_messages).toStrictEqual([recent]);
  });

  it("drops messages created exactly at the cutoff", () => {
    const atCutoff = claudeMessage(iso(0));
    const justAfter = claudeMessage(iso(1));
    const truncated = truncateClaudeChatLog(
      claude([claudeConversation([atCutoff, justAfter])]),
      CUTOFF,
    );

    expect(truncated.content[0]!.chat_messages).toStrictEqual([justAfter]);
  });

  it("drops messages with an unparseable created_at", () => {
    const invalid = claudeMessage("not a date");
    const recent = claudeMessage(iso(HOUR));
    const truncated = truncateClaudeChatLog(
      claude([claudeConversation([invalid, recent])]),
      CUTOFF,
    );

    expect(truncated.content[0]!.chat_messages).toStrictEqual([recent]);
  });

  it("removes conversations whose messages have all expired", () => {
    const expired = claudeConversation([claudeMessage(iso(-2 * HOUR)), claudeMessage(iso(-HOUR))]);
    const active = claudeConversation([claudeMessage(iso(HOUR))]);
    const truncated = truncateClaudeChatLog(claude([expired, active]), CUTOFF);

    expect(truncated.content.map((c) => c.uuid)).toStrictEqual([active.uuid]);
  });

  it("removes conversations with no messages regardless of cutoff", () => {
    const empty = claudeConversation([]);
    const truncated = truncateClaudeChatLog(claude([empty]), new Date(0));

    expect(truncated.content).toStrictEqual([]);
  });

  it("preserves conversation-level fields on partially truncated conversations", () => {
    const conversation = {
      ...claudeConversation([claudeMessage(iso(-HOUR)), claudeMessage(iso(HOUR))]),
    };
    const truncated = truncateClaudeChatLog(claude([conversation]), CUTOFF);

    expect(R.omit(truncated.content[0]!, ["chat_messages"])).toStrictEqual(
      R.omit(conversation, ["chat_messages"]),
    );
  });

  it("preserves message order and unknown message fields", () => {
    const messages = [3, 1, 2].map((h) => ({
      ...claudeMessage(iso(h * HOUR), `message ${h}`),
    }));
    const truncated = truncateClaudeChatLog(claude([claudeConversation(messages)]), CUTOFF);

    expect(truncated.content[0]!.chat_messages).toStrictEqual(messages);
  });

  it("does not mutate its input", () => {
    const input = claude([
      claudeConversation([claudeMessage(iso(-HOUR)), claudeMessage(iso(HOUR))]),
      claudeConversation([claudeMessage(iso(-HOUR))]),
    ]);
    const before = structuredClone(input);
    truncateClaudeChatLog(input, CUTOFF);

    expect(input).toStrictEqual(before);
  });
});

/* -----------------------------------------------------------------------------
 * ChatGPT
 * -------------------------------------------------------------------------- */

describe("truncateChatGPTChatLog", () => {
  const data = loadFixture("valid-chatgpt-conversations.json");
  assert(data.source === "chatgpt");

  it("truncates logs to last 5 days of history", () => {
    const truncated = truncateChatGPTChatLog(data, new Date("2025-12-26"));
    expect(truncated.content).toMatchSnapshot();
  });

  it("returns data unchanged given a large enough window", () => {
    const truncated = truncateChatGPTChatLog(data, new Date("2000-01-01"));
    expect(truncated.content).toStrictEqual(data.content);
  });

  it("keeps messages after the cutoff and drops messages before it", () => {
    const conversation = chatgptConversation([unix(-HOUR), unix(HOUR)]);
    const [, oldId, recentId] = Object.keys(conversation.mapping);
    const truncated = truncateChatGPTChatLog(chatgpt([conversation]), CUTOFF);

    const mapping = truncated.content[0]!.mapping;
    expect(mapping).not.toHaveProperty(oldId!);
    expect(mapping[recentId!]).toStrictEqual(conversation.mapping[recentId!]);
  });

  it("drops messages created exactly at the cutoff", () => {
    const conversation = chatgptConversation([unix(0), unix(1)]);
    const [rootId, , justAfterId] = Object.keys(conversation.mapping);
    const truncated = truncateChatGPTChatLog(chatgpt([conversation]), CUTOFF);

    expect(Object.keys(truncated.content[0]!.mapping)).toStrictEqual([rootId!, justAfterId!]);
  });

  it("keeps nodes without a message or create_time in retained conversations", () => {
    const conversation = chatgptConversation([null, unix(-HOUR), unix(HOUR)]);
    const [rootId, untimedId, oldId, recentId] = Object.keys(conversation.mapping);
    const truncated = truncateChatGPTChatLog(chatgpt([conversation]), CUTOFF);

    expect(Object.keys(truncated.content[0]!.mapping)).toStrictEqual([
      rootId!,
      untimedId!,
      recentId!,
    ]);
    expect(truncated.content[0]!.mapping).not.toHaveProperty(oldId!);
  });

  it("removes conversations with no timed messages after the cutoff", () => {
    const expired = chatgptConversation([unix(-2 * HOUR), unix(-HOUR)]);
    const untimedOnly = chatgptConversation([null, unix(-HOUR)]);
    const active = chatgptConversation([unix(HOUR)]);
    const truncated = truncateChatGPTChatLog(chatgpt([expired, untimedOnly, active]), CUTOFF);

    expect(truncated.content.map((c) => c.id)).toStrictEqual([active.id]);
  });

  it("removes conversations with no timed messages regardless of cutoff", () => {
    const truncated = truncateChatGPTChatLog(chatgpt([chatgptConversation([null])]), new Date(0));

    expect(truncated.content).toStrictEqual([]);
  });

  it("preserves conversation-level fields on partially truncated conversations", () => {
    const conversation = {
      ...chatgptConversation([unix(-HOUR), unix(HOUR)]),
    };
    const truncated = truncateChatGPTChatLog(chatgpt([conversation]), CUTOFF);

    expect(R.omit(truncated.content[0]!, ["mapping"])).toStrictEqual(
      R.omit(conversation, ["mapping"]),
    );
  });

  it("does not mutate its input", () => {
    const input = chatgpt([
      chatgptConversation([unix(-HOUR), unix(HOUR)]),
      chatgptConversation([unix(-HOUR)]),
    ]);
    const before = structuredClone(input);
    truncateChatGPTChatLog(input, CUTOFF);

    expect(input).toStrictEqual(before);
  });
});

/* -----------------------------------------------------------------------------
 * Gemini
 * -------------------------------------------------------------------------- */

describe("truncateGeminiChatLog", () => {
  const data = loadFixture("valid-gemini-activity.json");
  assert(data.source === "gemini");

  it("truncates logs to last 5 days of history", () => {
    const truncated = truncateGeminiChatLog(data, new Date("2025-12-26"));
    expect(truncated.content).toMatchSnapshot();
  });

  it("returns data unchanged given a large enough window", () => {
    const truncated = truncateGeminiChatLog(data, new Date("2000-01-01"));
    expect(truncated.content).toStrictEqual(data.content);
  });

  it("keeps prompts after the cutoff and drops prompts at or before it", () => {
    const prompts = [
      geminiPrompt(iso(2 * HOUR), "recent"),
      geminiPrompt(iso(0), "at cutoff"),
      geminiPrompt(iso(1), "just after"),
      geminiPrompt(iso(-HOUR), "old"),
    ];
    const truncated = truncateGeminiChatLog(gemini(prompts), CUTOFF);

    expect(truncated.content).toStrictEqual([prompts[0]!, prompts[2]!]);
  });

  it("does not mutate its input", () => {
    const input = gemini([geminiPrompt(iso(-HOUR)), geminiPrompt(iso(HOUR))]);
    const before = structuredClone(input);
    truncateGeminiChatLog(input, CUTOFF);

    expect(input).toStrictEqual(before);
  });
});

/* -----------------------------------------------------------------------------
 * truncateChatLog
 * -------------------------------------------------------------------------- */

describe("truncateChatLog", () => {
  // Local-time dates so start-of-day rounding is independent of the machine's time zone.
  const expiresAt = new Date(2026, 6, 27, 15, 0);
  const lateDayBefore = new Date(2026, 6, 26, 23, 59).toISOString();
  const midnight = new Date(2026, 6, 27, 0, 0).toISOString();
  const morning = new Date(2026, 6, 27, 9, 0).toISOString();

  it("returns the result untouched when expiresAt is null", () => {
    const result: ValidationSuccess = {
      type: "success",
      data: claude([claudeConversation([claudeMessage(iso(-HOUR))])]),
    };
    expect(truncateChatLog(result, null)).toBe(result);
  });

  it("truncates claude logs from the start of the expiry day", () => {
    const messages = [lateDayBefore, midnight, morning].map((t) => claudeMessage(t));
    const truncated = truncateChatLog(
      { type: "success", data: claude([claudeConversation(messages)]) },
      expiresAt,
    );

    assert(truncated.data.source === "claude");
    expect(truncated.type).toBe("success");
    expect(truncated.data.content[0]!.chat_messages).toStrictEqual([messages[2]!]);
  });

  it("truncates chatgpt logs from the start of the expiry day", () => {
    const toUnix = (t: string) => new Date(t).getTime() / 1000;
    const conversation = chatgptConversation([lateDayBefore, midnight, morning].map(toUnix));
    const [rootId, , , morningId] = Object.keys(conversation.mapping);
    const truncated = truncateChatLog(
      { type: "success", data: chatgpt([conversation]) },
      expiresAt,
    );

    assert(truncated.data.source === "chatgpt");
    expect(Object.keys(truncated.data.content[0]!.mapping)).toStrictEqual([rootId!, morningId!]);
  });

  it("truncates gemini logs from the start of the expiry day", () => {
    const prompts = [lateDayBefore, midnight, morning].map((t) => geminiPrompt(t));
    const truncated = truncateChatLog({ type: "success", data: gemini(prompts) }, expiresAt);

    assert(truncated.data.source === "gemini");
    expect(truncated.data.content).toStrictEqual([prompts[2]!]);
  });
});
