import { requireAdmin } from "@/lib/admin";
import { jsonError, noStoreJson, sameOrigin, rateLimit } from "@/lib/security";
import { operatePrintRequest } from "@/lib/print-requests";
export const maxDuration = 300;
export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("요청 출처 오류", 403);
  const admin = await requireAdmin(); if (!admin) return jsonError("관리자 권한이 필요해요.", 403);
  if (!await rateLimit(`admin-print:${admin.id}`, 60, 60)) return jsonError("잠시 후 다시 시도해 주세요.", 429);
  try { const body = await request.json() as { id?: string; action?: string; confirmed?: boolean }; return noStoreJson(await operatePrintRequest(String(body.id), String(body.action), body.confirmed === true)); }
  catch (e) { return jsonError(e instanceof Error ? e.message : "주문을 처리하지 못했어요."); }
}
