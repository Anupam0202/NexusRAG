import type { SourceChunk } from "@/types";

export const DELETED_PASSAGE = "This passage was removed when its document was deleted.";

/** The text to show for a cited passage. A deleted document leaves the citation but not its text. */
export function passageText(source: Pick<SourceChunk, "content" | "deleted">): string {
  return source.deleted ? DELETED_PASSAGE : source.content;
}
