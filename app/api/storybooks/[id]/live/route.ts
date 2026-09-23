import { bindings } from "@/db/runtime";
import { cleanText, jsonError, noStoreJson, rateLimit, sameOrigin, studentFromRequest } from "@/lib/security";
import { bookAdvice } from "@/lib/storybook-live-store";

// A small presence/advice exchange. No document upload, image encoding or book revision change.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return jsonError("요청 출처를 확인할 수 없어요.", 403);
  const student = await studentFromRequest(request);
  if (!student) return jsonError("학생 로그인이 필요해요.", 401);
  const bookId = cleanText((await context.params).id, 80);
  const db = bindings().DB;
  const book = await db.prepare(`SELECT id FROM storybooks WHERE id = ? AND student_id = ? AND classroom_id = ?`).bind(bookId, student.id, student.classroomId).first();
  if (!book) return jsonError("내 그림책을 찾을 수 없어요.", 404);
  if (!(await rateLimit(`book-presence:${student.id}`, 90, 60))) return jsonError("잠시 후 다시 확인해 주세요.", 429);
  const input = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (input.action === "ack") {
    await db.prepare(`UPDATE storybook_advice SET seen_at = COALESCE(seen_at, ?) WHERE id = ? AND storybook_id = ?`).bind(new Date().toISOString(), cleanText(input.adviceId, 80), bookId).run();
    return noStoreJson({ ok: true });
  }
  const pageId = cleanText(input.pageId, 80);
  if (!/^page_[a-zA-Z0-9_-]+$/.test(pageId)) return jsonError("보고 있는 쪽을 확인해 주세요.");
  const now = new Date().toISOString();
  const [, watching, advice] = await Promise.all([
    db.prepare(`INSERT INTO storybook_presence(student_id, storybook_id, page_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(student_id) DO UPDATE SET storybook_id = excluded.storybook_id, page_id = excluded.page_id, updated_at = excluded.updated_at`).bind(student.id, bookId, pageId, now).run(),
    db.prepare(`SELECT 1 FROM teacher_views WHERE student_id = ? AND classroom_id = ? AND expires_at > ? LIMIT 1`).bind(student.id, student.classroomId, now).first(),
    bookAdvice(bookId),
  ]);
  return noStoreJson({ watching: Boolean(watching), advice });
}
