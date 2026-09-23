import type { StorybookFormat, StorybookPage } from "./storybook-model";

export const BOOK_PRESENCE_TTL_MS = 20_000;
export type BookAdvice = { id: string; pageId: string; pageNumber: number; body: string; createdAt: string; seenAt: string | null };
export type LiveBook = { id: string; title: string; revision: number; status: string; updatedAt: string; active: boolean; activePageId: string | null; format: StorybookFormat; page: StorybookPage; pageIndex: number; pageCount: number };
export type LiveBookStudent = { id: string; nickname: string; realName: string | null; seatNumber: number | null; bookId: string | null; title: string | null; status: string | null; active: boolean };
