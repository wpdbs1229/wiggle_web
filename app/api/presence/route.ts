import { bindings } from "@/db/runtime";
import { jsonError, noStoreJson, sameOrigin, studentFromRequest, requireTeacher, rateLimit } from "@/lib/security";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("요청 출처 오류", 403);
  const student = request.headers.has("authorization") ? await studentFromRequest(request) : null;
  const teacher = student ? null : await requireTeacher();
  if (!student && !teacher) return jsonError("로그인이 필요해요.", 401);
  const role = student ? "student" : "teacher", actorId = (student ?? teacher)!.id;
  if (!await rateLimit(`presence:${role}:${actorId}`, 8, 60)) return noStoreJson({ ok: true });
  await bindings().DB.prepare(`INSERT INTO participant_presence(actor_key, role, actor_id, classroom_id, seen_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(actor_key) DO UPDATE SET classroom_id = excluded.classroom_id, seen_at = excluded.seen_at`).bind(`${role}:${actorId}`, role, actorId, student?.classroomId ?? null, Date.now()).run();
  return noStoreJson({ ok: true });
}
