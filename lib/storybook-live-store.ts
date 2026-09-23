import "server-only";
import { bindings } from "@/db/runtime";
import type { BookAdvice } from "./storybook-live";

export async function bookAdvice(bookId: string) {
  return (await bindings().DB.prepare(`SELECT id, page_id AS pageId, page_number AS pageNumber, body, created_at AS createdAt, seen_at AS seenAt FROM storybook_advice WHERE storybook_id = ? ORDER BY created_at DESC, id DESC LIMIT 8`).bind(bookId).all<BookAdvice>()).results;
}
