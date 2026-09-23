import { bindings } from "@/db/runtime";
import { requireTeacher, sameOrigin, jsonError, noStoreJson, cleanText, rateLimit } from "@/lib/security";
import { bookClassroom } from "@/lib/book-workflow";
import { calculatedLayout, submitPrintRequest, requestListRow, type PrintRequest } from "@/lib/print-requests";
import { printEnvironment } from "@/lib/sweetbook";
export const maxDuration = 300;
export async function GET(request: Request) {
  const teacher = await requireTeacher(); if (!teacher) return jsonError("로그인이 필요해요.", 401);
  const url = new URL(request.url), classroomId = cleanText(url.searchParams.get("classroomId"), 40);
  const room = await bookClassroom(teacher.id, classroomId); if (!room) return jsonError("학급 권한이 없어요.", 403);
  try {
    if (url.searchParams.has("specUid")) return noStoreJson(await calculatedLayout(String(url.searchParams.get("specUid")), Number(url.searchParams.get("pageCount"))));
    const db = bindings().DB;
    const orders = await db.prepare(`SELECT id, status, document_json, provider_json, error, created_at FROM print_requests WHERE teacher_id = ? AND classroom_id = ? ORDER BY created_at DESC LIMIT 100`).bind(teacher.id, classroomId).all<PrintRequest>();
    const uploads = await db.prepare(`SELECT id, title, layout_json FROM print_uploads WHERE teacher_id = ? AND classroom_id = ? AND environment = ? AND status = 'ready' ORDER BY created_at DESC LIMIT 100`).bind(teacher.id, classroomId, printEnvironment()).all();
    const profile = await db.prepare(`SELECT school_name FROM classroom_profiles WHERE classroom_id = ?`).bind(classroomId).first();
    return noStoreJson({ orders: orders.results.map(requestListRow), uploads: uploads.results, room, profile });
  } catch (e) { return jsonError(e instanceof Error ? e.message : "제작 규격을 확인하지 못했어요."); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("요청 출처 오류", 403);
  const teacher = await requireTeacher(); if (!teacher) return jsonError("로그인이 필요해요.", 401);
  if (!await rateLimit(`print-request:${teacher.id}`, 10, 60)) return jsonError("잠시 후 다시 요청해 주세요.", 429);
  try { return noStoreJson(await submitPrintRequest(teacher, await request.json()), { status: 201 }); }
  catch (e) { return jsonError(e instanceof Error && /[가-힣]/.test(e.message) ? e.message : "요청서를 저장하지 못했어요. 같은 요청으로 다시 시도해 주세요."); }
}
