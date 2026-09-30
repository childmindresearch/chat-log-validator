import { z } from "zod";
import * as R from "remeda";

const DataFileSchema = z.object({
  batch_index: z.number(),
  export_url: z.url(),
  category: z.string(),
  part: z.number(),
  filename: z.string(),
});

export const ClaudeManifestSchema = z.object({
  instructions: z.string(),
  created_at: z.string(),
  total_files: z.number(),
  data_files: z.array(DataFileSchema),
});

export type ClaudeManifest = z.infer<typeof ClaudeManifestSchema>;

export function findClaudeConversationsUrl(manifest: ClaudeManifest): string | null {
  return R.find(manifest.data_files, (v) => v.category === "conversations")?.export_url ?? null;
}
