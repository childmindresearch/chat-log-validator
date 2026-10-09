import { ClaudeManifest } from "@validator/schema";
import * as R from "remeda";

export function findClaudeConversationsUrl(manifest: ClaudeManifest): string | null {
  return R.find(manifest.data_files, (v) => v.category === "conversations")?.export_url ?? null;
}
