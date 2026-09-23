import { jsonError, noStoreJson, requireTeacher, sameOrigin, rateLimit } from "@/lib/security";
import { processFeedback } from "@/lib/book-workflow";
export const maxDuration = 180;
export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("요청 출처를 확인할 수 없어요.", 403);
  const teacher = await requireTeacher(); if (!teacher) return jsonError("교사 로그인이 필요해요.", 401);
  if (!await rateLimit(`book-worker:${teacher.id}`, 60, 60)) return jsonError("잠시 뒤 다시 시작해 주세요.", 429);
  try { const { classroomId } = await request.json() as { classroomId: string }; return noStoreJson(await processFeedback(teacher.id, String(classroomId))); }
  catch { return jsonError("피드백 처리 권한 또는 요청을 확인해 주세요.", 400); }
}
