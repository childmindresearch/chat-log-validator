import * as R from "remeda";
import { isAfter, startOfDay } from "date-fns";

import { ValidDataT } from "@validator/schema";
import { ValidationSuccess } from "@validator/stages/validateChatLog";

export function truncateClaudeChatLog(
  data: ValidDataT<"claude">,
  expiresAt: Date,
): ValidDataT<"claude"> {
  const content = R.pipe(
    data.content,
    R.map((conversation) => ({
      ...conversation,
      chat_messages: R.filter(conversation.chat_messages, (message) => {
        const createdAt = new Date(message.created_at);
        return isAfter(createdAt, expiresAt);
      }),
    })),
    R.filter((conversation) => conversation.chat_messages.length > 0),
  );

  return { ...data, content };
}

export function truncateChatGPTChatLog(
  data: ValidDataT<"chatgpt">,
  expiresAt: Date,
): ValidDataT<"chatgpt"> {
  const content = R.pipe(
    data.content,
    R.map((conversation) => {
      const mapping = Object.fromEntries(
        Object.entries(conversation.mapping).filter(([_, entry]) => {
          if (!entry.message?.create_time) {
            return true;
          }

          return isAfter(new Date(entry.message.create_time * 1000), expiresAt);
        }),
      );

      return { ...conversation, mapping };
    }),
    R.filter((conversation) =>
      Object.values(conversation.mapping).some(
        (entry) =>
          entry.message?.create_time &&
          isAfter(new Date(entry.message.create_time * 1000), expiresAt),
      ),
    ),
  );

  return { ...data, content };
}

export function truncateGeminiChatLog(
  data: ValidDataT<"gemini">,
  expiresAt: Date,
): ValidDataT<"gemini"> {
  const content = R.pipe(
    data.content,
    R.filter((prompt) => isAfter(new Date(prompt.time), expiresAt)),
  );

  return { ...data, content };
}

export function truncateChatLog(
  result: ValidationSuccess,
  expiresAt: Date | null,
): ValidationSuccess {
  if (expiresAt === null) {
    return result;
  }

  const truncateDate = startOfDay(expiresAt);

  switch (result.data.source) {
    case "claude":
      return { ...result, data: truncateClaudeChatLog(result.data, truncateDate) };
    case "chatgpt":
      return { ...result, data: truncateChatGPTChatLog(result.data, truncateDate) };
    case "gemini":
      return { ...result, data: truncateGeminiChatLog(result.data, truncateDate) };
  }
}
