import { bindings } from "@/db/runtime";
import { cleanText, id, jsonError, noStoreJson, rateLimit, requireTeacher, sameOrigin } from "@/lib/security";
import { BOOK_PRESENCE_TTL_MS } from "@/lib/storybook-live";
import { bookAdvice } from "@/lib/storybook-live-store";
import type { StorybookDocument } from "@/lib/storybook-model";
import { upsertTeacherView } from "@/lib/teacher-classroom-mutations";

const accessible = `FROM storybooks b JOIN student_profiles s ON s.id = b.student_id AND s.classroom_id = b.classroom_id JOIN classrooms c ON c.id = b.classroom_id WHERE b.id = ? AND c.teacher_id = ? AND c.active = 1 AND s.archived_at IS NULL`;
export async function GET(request: Request) {
  const teacher = await requireTeacher();
  if (!teacher) return jsonError("교사 로그인이 필요해요.", 401);
  const url = new URL(request.url), db = bindings().DB;
  const classroomId = cleanText(url.searchParams.get("classroomId"), 40);
  const classroom = await db.prepare(`SELECT id, display_name AS name FROM classrooms WHERE id = ? AND teacher_id = ? AND active = 1`).bind(classroomId, teacher.id).first();
  if (!classroom) return jsonError("이 학급을 볼 권한이 없어요.", 403);
  const studentId = cleanText(url.searchParams.get("studentId"), 40);
  const since = new Date(Date.now() - BOOK_PRESENCE_TTL_MS).toISOString();
  // Only metadata for the class list: no book JSON, assets or thumbnail fan-out.
  const from = `FROM student_profiles s LEFT JOIN storybook_presence p ON p.student_id = s.id LEFT JOIN storybooks b ON b.id = COALESCE((SELECT active.id FROM storybooks active WHERE active.id = p.storybook_id AND active.student_id = s.id AND active.classroom_id = s.classroom_id AND p.updated_at > ?), (SELECT recent.id FROM storybooks recent WHERE recent.student_id = s.id AND recent.classroom_id = s.classroom_id ORDER BY recent.updated_at DESC, recent.id DESC LIMIT 1)) WHERE s.classroom_id = ? AND s.archived_at IS NULL`;
  if (!studentId) {
    const rows = await db.prepare(`SELECT s.id, s.nickname, s.real_name AS realName, s.seat_number AS seatNumber, b.id AS bookId, b.title, b.status, CASE WHEN p.updated_at > ? AND p.storybook_id = b.id THEN 1 ELSE 0 END AS active ${from} ORDER BY s.seat_number IS NULL, s.seat_number, s.id`).bind(since, since, classroomId).all<{ active: number }>();
    return noStoreJson({ classroom, students: rows.results.map(s => ({ ...s, active: Boolean(s.active) })) });
  }
  const row = await db.prepare(`SELECT s.id AS studentId, b.id, b.title, b.revision, b.status, b.updated_at AS updatedAt, CASE WHEN p.updated_at > ? AND p.storybook_id = b.id THEN p.page_id ELSE NULL END AS activePageId ${from} AND s.id = ?`).bind(since, since, classroomId, studentId).first<{ id: string | null; title: string; revision: number; status: string; updatedAt: string; activePageId: string | null }>();
  if (!row) return jsonError("이 학급의 학생을 찾을 수 없어요.", 404);
  if (!row.id) return noStoreJson({ book: null, advice: [] });
  const requestedPage = url.searchParams.get("pageId") || row.activePageId;
  const knownPage = url.searchParams.get("knownPageId");
  const unchanged = url.searchParams.get("knownBookId") === row.id && url.searchParams.get("knownRevision") === String(row.revision) && !!knownPage && (!requestedPage || knownPage === requestedPage);
  const advice = await bookAdvice(row.id);
  if (unchanged) return noStoreJson({ book: { ...row, active: !!row.activePageId, unchanged: true }, advice });
  // Read the document only after a revision/page change; send just the displayed page.
  // Select the revision with the JSON so a concurrent save cannot label new content with an old revision.
  const full = await db.prepare(`SELECT b.document_json AS documentJson, b.title, b.revision, b.status, b.updated_at AS updatedAt ${accessible}`).bind(row.id, teacher.id).first<{ documentJson: string; title: string; revision: number; status: string; updatedAt: string }>();
  if (!full) return jsonError("그림책을 찾을 수 없어요.", 404);
  const document = JSON.parse(full.documentJson) as StorybookDocument;
  const pageIndex = Math.max(0, document.pages.findIndex(p => p.id === requestedPage));
  const { documentJson: _, ...metadata } = full; void _;
  return noStoreJson({ book: { ...row, ...metadata, active: !!row.activePageId, format: document.format, page: document.pages[pageIndex], pageIndex, pageCount: document.pages.length, pageIds: document.pages.map(p => p.id) }, advice });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("요청 출처를 확인할 수 없어요.", 403);
  const teacher = await requireTeacher();
  if (!teacher) return jsonError("교사 로그인이 필요해요.", 401);
  const input = await request.json().catch(() => ({})) as Record<string, unknown>, db = bindings().DB;
  if (input.action === "watch") {
    if (!(await rateLimit(`book-watch:${teacher.id}`, 60, 60))) return jsonError("잠시 후 다시 확인해 주세요.", 429);
    const ok = await upsertTeacherView(db, { teacherId: teacher.id, classroomId: cleanText(input.classroomId, 40), studentId: cleanText(input.studentId, 40), expiresAt: new Date(Date.now() + 15_000).toISOString() });
    return ok ? noStoreJson({ ok: true }) : jsonError("이 학생을 볼 권한이 없어요.", 403);
  }
  if (input.action !== "advice") return jsonError("요청을 확인해 주세요.");
  if (!(await rateLimit(`book-advice:${teacher.id}`, 30, 60))) return jsonError("조언을 너무 빠르게 보내고 있어요.", 429);
  const bookId = cleanText(input.bookId, 80), pageId = cleanText(input.pageId, 80), body = cleanText(input.body, 300);
  if (!body) return jsonError("학생에게 보낼 조언을 적어 주세요.");
  const book = await db.prepare(`SELECT b.document_json AS documentJson ${accessible}`).bind(bookId, teacher.id).first<{ documentJson: string }>();
  if (!book) return jsonError("이 그림책에 조언할 권한이 없어요.", 404);
  const document = JSON.parse(book.documentJson) as StorybookDocument;
  const index = document.pages.findIndex(p => p.id === pageId);
  if (index < 0) return jsonError("쪽이 바뀌었어요. 현재 쪽을 다시 확인해 주세요.", 409);
  await db.prepare(`INSERT INTO storybook_advice(id, storybook_id, teacher_id, page_id, page_number, body, created_at) SELECT ?, b.id, ?, ?, ?, ?, ? ${accessible}`).bind(id("bookadvice"), teacher.id, pageId, index + 1, body, new Date().toISOString(), bookId, teacher.id).run();
  return noStoreJson({ ok: true, advice: await bookAdvice(bookId) });
}
