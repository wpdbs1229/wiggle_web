import { bindings } from "@/db/runtime";
import { cleanText, jsonError, noStoreJson, requireTeacher, sameOrigin, rateLimit } from "@/lib/security";
import { activeRubric, enqueueFeedback, feedbackConfigured, selectedBookIds } from "@/lib/book-workflow";
import { parseRubric, rubricVersion, rubricWorkbook } from "@/lib/book-rubric";

export async function GET(request: Request) {
  const teacher = await requireTeacher(); if (!teacher) return jsonError("교사 로그인이 필요해요.", 401);
  const classroomId = cleanText(new URL(request.url).searchParams.get("classroomId"), 40);
  try {
    const { room, rubric, prompt, version } = await activeRubric(teacher.id, classroomId);
    if (new URL(request.url).searchParams.get("format") === "xlsx") return new Response(await rubricWorkbook(rubric), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent("평가기준_수정양식.xlsx")}`, "cache-control": "private, no-store" } });
    const jobs = await bindings().DB.prepare(`SELECT id, storybook_id AS storybookId, revision, rubric_version AS rubricVersion, status, error, title, created_at AS createdAt FROM book_feedback_jobs WHERE teacher_id = ? AND classroom_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1000`).bind(teacher.id, classroomId).all();
    return noStoreJson({ rubric, prompt, version, grade: room.grade, classNumber: room.classNumber, filename: room.rubricFilename ?? "storybook.xlsx", configured: feedbackConfigured(), jobs: jobs.results });
  } catch { return jsonError("이 학급의 평가 설정을 불러올 수 없어요.", 403); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("요청 출처를 확인할 수 없어요.", 403);
  const teacher = await requireTeacher(); if (!teacher) return jsonError("교사 로그인이 필요해요.", 401);
  if (!await rateLimit(`book-feedback:${teacher.id}`, 120, 60)) return jsonError("잠시 뒤 다시 요청해 주세요.", 429);
  try {
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      if (Number(request.headers.get("content-length")) > 2_100_000) return jsonError("루브릭 파일은 2MB 이하여야 해요.", 413);
      const form = await request.formData(); const classroomId = cleanText(form.get("classroomId"), 40);
      await activeRubric(teacher.id, classroomId);
      const file = form.get("file"); if (!(file instanceof File) || !file.name.endsWith(".xlsx") || file.size > 2_000_000) return jsonError("2MB 이하 .xlsx 파일을 선택해 주세요.");
      const rubric = await parseRubric(new Uint8Array(await file.arrayBuffer()));
      await bindings().DB.prepare(`INSERT INTO classroom_book_settings(classroom_id, rubric_json, rubric_version, rubric_filename) VALUES (?, ?, ?, ?) ON CONFLICT(classroom_id) DO UPDATE SET rubric_json = excluded.rubric_json, rubric_version = excluded.rubric_version, rubric_filename = excluded.rubric_filename, updated_at = CURRENT_TIMESTAMP`).bind(classroomId, JSON.stringify(rubric), rubricVersion(rubric), file.name.slice(0, 160)).run();
      return noStoreJson({ ok: true });
    }
    const body = await request.json() as { classroomId?: string; action?: string; grade: number; classNumber: number; storybookIds?: unknown };
    const classroomId = cleanText(body.classroomId, 40);
    await activeRubric(teacher.id, classroomId);
    if (body.action === "identity") {
      if (!Number.isInteger(body.grade) || body.grade < 1 || body.grade > 12 || !Number.isInteger(body.classNumber) || body.classNumber < 1 || body.classNumber > 99) return jsonError("학년(1~12)과 반(1~99)을 확인해 주세요.");
      await bindings().DB.prepare(`INSERT INTO classroom_book_settings(classroom_id, grade, class_number) VALUES (?, ?, ?) ON CONFLICT(classroom_id) DO UPDATE SET grade = excluded.grade, class_number = excluded.class_number, updated_at = CURRENT_TIMESTAMP`).bind(classroomId, body.grade, body.classNumber).run();
      return noStoreJson({ ok: true });
    }
    const requested = await enqueueFeedback(teacher.id, classroomId, selectedBookIds(body.storybookIds));
    return noStoreJson({ requested }, { status: 202 });
  } catch (error) { return jsonError(error instanceof Error ? error.message : "요청을 확인해 주세요.", 400); }
}
