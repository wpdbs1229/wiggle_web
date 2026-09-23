import { jsonError, noStoreJson, requireTeacher, sameOrigin, rateLimit } from "@/lib/security";
import { processPrint } from "@/lib/book-print-workflow";
export const maxDuration = 300;
export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("요청 출처를 확인할 수 없어요.", 403);
  const teacher = await requireTeacher(); if (!teacher) return jsonError("교사 로그인이 필요해요.", 401);
  if (!await rateLimit(`print-worker:${teacher.id}`, 60, 60)) return jsonError("잠시 뒤 다시 시도해 주세요.", 429);
  try { const body = await request.json() as { classroomId: string }; return noStoreJson(await processPrint(teacher.id, String(body.classroomId))); }
  catch { return jsonError("제작 준비 요청을 확인해 주세요.", 400); }
}
