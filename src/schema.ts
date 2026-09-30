import { z } from "zod";

/* -----------------------------------------------------------------------------
 * Claude Conversation Parsing
 * -------------------------------------------------------------------------- */

export const ClaudeTextContentSchema = z.looseObject({
  type: z.literal("text"),
  text: z.string(),
  citations: z.array(z.any()),
  flags: z.array(z.any()).nullable(),
  start_timestamp: z.string().nullable(),
  stop_timestamp: z.string().nullable(),
});

export const ClaudeOtherContentSchema = z.looseObject({
  type: z.string(),
});

export const ClaudeChatMessageContentSchema = z.union([
  ClaudeTextContentSchema,
  ClaudeOtherContentSchema,
]);

export const ClaudeChatMessageSchema = z.looseObject({
  attachments: z.array(z.any()),
  content: z.array(ClaudeChatMessageContentSchema),
  created_at: z.string(),
  files: z.array(z.any()),
  parent_message_uuid: z.uuid(),
  sender: z.enum(["human", "assistant"]).or(z.string()),
  text: z.string(),
  updated_at: z.string(),
  uuid: z.uuid(),
});

export type ClaudeChatMessage = z.infer<typeof ClaudeChatMessageSchema>;

export const ClaudeConversationSchema = z.looseObject({
  account: z.looseObject({
    uuid: z.uuid(),
  }),
  chat_messages: z.array(ClaudeChatMessageSchema),
  created_at: z.string(),
  name: z.string(),
  summary: z.string(),
  updated_at: z.string(),
  uuid: z.uuid(),
});

export type ClaudeConversation = z.infer<typeof ClaudeConversationSchema>;

export const ClaudeConversationArraySchema = z.array(ClaudeConversationSchema);

export type ClaudeConversationArray = z.infer<typeof ClaudeConversationArraySchema>;

/* -----------------------------------------------------------------------------
 * ChatGPT Conversation Parsing
 * -------------------------------------------------------------------------- */

// See: https://github.com/xuy/docs-for-agents/blob/main/ChatGPT_export_schema.md

export const ChatGPTMessageSchema = z.looseObject({
  id: z.uuid(),
  author: z.looseObject({
    role: z.enum(["user", "assistant", "system", "tool"]),
  }),
  create_time: z.number().nullable(),
  content: z.looseObject({
    content_type: z.string(),
    parts: z.array(z.any()).optional(),
  }),
});

export type ChatGPTMessage = z.infer<typeof ChatGPTMessageSchema>;

export const ChatGPTMappingSchema = z.record(
  z.string(),
  z.looseObject({
    id: z.string(),
    parent: z.string().nullable(),
    children: z.array(z.uuid()).nullish(),
    message: ChatGPTMessageSchema.nullable(),
  }),
);

export type ChatGPTMapping = z.infer<typeof ChatGPTMappingSchema>;

export const ChatGPTConversationSchema = z.looseObject({
  id: z.uuid(),
  title: z.string().nullish(),
  create_time: z.number(),
  update_time: z.number(),
  mapping: ChatGPTMappingSchema,
});

export type ChatGPTConversation = z.infer<typeof ChatGPTConversationSchema>;

export const ChatGPTConversationArraySchema = z.array(ChatGPTConversationSchema);

export type ChatGPTConversationArray = z.infer<typeof ChatGPTConversationArraySchema>;

/* -----------------------------------------------------------------------------
 * Gemini Prompt Parsing
 * -------------------------------------------------------------------------- */

export const GeminiSafeHtmlItemSchema = z.looseObject({
  html: z.string(),
});

export const GeminiDetailsSchema = z.looseObject({
  name: z.string().optional(),
  url: z.string().optional(),
});

export const GeminiSubtitlesSchema = z.looseObject({
  name: z.string().optional(),
  url: z.string().optional(),
});

export const BaseGeminiPromptSchema = z.looseObject({
  header: z.string(),
  title: z.string(),
  time: z.iso.datetime(),
});

export type BaseGeminiPrompt = z.infer<typeof BaseGeminiPromptSchema>;

export const GeminiPromptSchema = z.looseObject({
  header: z.string(),
  title: z.string(),
  time: z.iso.datetime(),
  products: z.array(z.string()),
  activityControls: z.array(z.string()),
  safeHtmlItem: z.array(GeminiSafeHtmlItemSchema).optional(),
  details: z.array(GeminiDetailsSchema).optional(),
  subtitles: z.array(GeminiSubtitlesSchema).optional(),
  attachedFiles: z.array(z.string()).optional(),
});

export type GeminiPrompt = z.infer<typeof GeminiPromptSchema>;

export const GeminiPromptArraySchema = z.array(GeminiPromptSchema);

export type GeminiPromptArray = z.infer<typeof GeminiPromptArraySchema>;

/* -----------------------------------------------------------------------------
 * Valid Data Sources
 * -------------------------------------------------------------------------- */

export const validSources = ["claude", "chatgpt", "gemini"] as const;

export type ValidSource = (typeof validSources)[number];

export const ValidSourceSchema = z.enum(validSources);

export interface ValidSourceDataMap extends Record<ValidSource, unknown> {
  claude: ClaudeConversationArray;
  chatgpt: ChatGPTConversationArray;
  gemini: GeminiPromptArray;
}

export type ValidDataT<S extends ValidSource> = {
  source: S;
  content: ValidSourceDataMap[S];
};

export type ValidData = { [S in ValidSource]: ValidDataT<S> }[ValidSource];

export function formatSource(source: ValidSource) {
  switch (source) {
    case "claude":
      return "Claude";
    case "chatgpt":
      return "ChatGPT";
    case "gemini":
      return "Gemini";
  }
}
