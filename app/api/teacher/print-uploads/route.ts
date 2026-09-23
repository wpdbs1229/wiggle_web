import { randomUUID } from "node:crypto";
import { bindings } from "@/db/runtime";
import { requireTeacher, sameOrigin, jsonError, noStoreJson, cleanText, rateLimit } from "@/lib/security";
import { bookClassroom } from "@/lib/book-workflow";
import { calculatedLayout, readPrintFile, uploadKey } from "@/lib/print-requests";
import { validatePrintPdf, type PrintLayout } from "@/lib/print-validation";
import { printEnvironment } from "@/lib/sweetbook";
export const maxDuration = 120;
const CHUNK = 3_000_000;
type Upload = { id: string; status: string; layout_json: string };
type UploadLayout = PrintLayout & { fileSizes: { cover: number; inner: number } };
export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("요청 출처 오류", 403);
  const teacher = await requireTeacher(); if (!teacher) return jsonError("로그인이 필요해요.", 401);
  if (!await rateLimit(`print-upload:${teacher.id}`, 60, 60)) return jsonError("잠시 후 다시 시도해 주세요.", 429);
  const db = bindings().DB;
  try {
    const body = await request.json() as { action: string; classroomId: string; title: string; specUid: string; pageCount: number; coverBytes: number; innerBytes: number; id: string };
    if (!await bookClassroom(teacher.id, cleanText(body.classroomId, 40))) return jsonError("학급 권한이 없어요.", 403);
    if (body.action === "start") {
      const title = cleanText(body.title, 100);
      if (!title || ![body.coverBytes, body.innerBytes].every((n) => Number.isInteger(n) && n > 0 && n <= 30_000_000)) throw new Error("책 이름과 표지·내지 PDF를 선택해 주세요. 파일당 최대 30MB입니다.");
      const layout: UploadLayout = { ...await calculatedLayout(String(body.specUid), Number(body.pageCount)), fileSizes: { cover: body.coverBytes, inner: body.innerBytes } };
      const id = randomUUID();
      await db.prepare(`INSERT INTO print_uploads(id, teacher_id, classroom_id, environment, title, layout_json) VALUES (?, ?, ?, ?, ?, ?)`).bind(id, teacher.id, body.classroomId, printEnvironment(), title, JSON.stringify(layout)).run();
      return noStoreJson({ id, layout });
    }
    const upload = await db.prepare(`SELECT * FROM print_uploads WHERE id = ? AND teacher_id = ? AND classroom_id = ? AND environment = ?`).bind(String(body.id), teacher.id, body.classroomId, printEnvironment()).first<Upload>();
    if (!upload) return jsonError("업로드를 찾을 수 없어요.", 404);
    if (upload.status === "ready") return noStoreJson({ id: upload.id });
    const claim = await db.prepare(`UPDATE print_uploads SET status = 'validating' WHERE id = ? AND status = 'uploading'`).bind(upload.id).run();
    if (!claim.meta.changes) return jsonError("파일 검사 중입니다.", 409);
    try {
      const layout: UploadLayout = JSON.parse(upload.layout_json), measurements = {} as Record<string, unknown>;
      for (const kind of ["cover", "inner"] as const) {
        const chunks: Uint8Array[] = [];
        for (let i = 0; i < Math.ceil(layout.fileSizes[kind] / CHUNK); i++) chunks.push(await readPrintFile(`print-uploads/${upload.id}/${kind}-${i}`));
        const bytes = Buffer.concat(chunks);
        if (bytes.length !== layout.fileSizes[kind]) throw new Error("파일 전송이 완료되지 않았어요. 다시 업로드해 주세요.");
        measurements[kind] = await validatePrintPdf(bytes, kind, layout);
        await bindings().ARTWORKS.put(uploadKey(upload.id, kind), bytes, { httpMetadata: { contentType: "application/pdf" } });
      }
      await db.prepare(`UPDATE print_uploads SET status = 'ready' WHERE id = ?`).bind(upload.id).run();
      // Staging chunks are no longer needed after immutable validated PDFs exist.
      for (const kind of ["cover", "inner"] as const) for (let i = 0; i < Math.ceil(layout.fileSizes[kind] / CHUNK); i++) await bindings().ARTWORKS.delete(`print-uploads/${upload.id}/${kind}-${i}`);
      return noStoreJson({ id: upload.id, measurements });
    } catch (e) { await db.prepare(`UPDATE print_uploads SET status = 'uploading' WHERE id = ? AND status = 'validating'`).bind(upload.id).run(); throw e; }
  } catch (e) { return jsonError(e instanceof Error && /[가-힣]/.test(e.message) ? e.message : "PDF 업로드를 처리하지 못했어요."); }
}
export async function PUT(request: Request) {
  if (!sameOrigin(request)) return jsonError("요청 출처 오류", 403);
  const teacher = await requireTeacher(); if (!teacher) return jsonError("로그인이 필요해요.", 401);
  const url = new URL(request.url), id = url.searchParams.get("id"), kind = url.searchParams.get("kind"), part = Number(url.searchParams.get("part"));
  if ((kind !== "cover" && kind !== "inner") || !Number.isInteger(part) || part < 0 || part > 9) return jsonError("파일 조각 오류");
  const upload = await bindings().DB.prepare(`SELECT * FROM print_uploads WHERE id = ? AND teacher_id = ? AND environment = ? AND status = 'uploading'`).bind(id, teacher.id, printEnvironment()).first<Upload>();
  if (!upload) return jsonError("업로드 권한이 없어요.", 403);
  const layout: UploadLayout = JSON.parse(upload.layout_json), expected = Math.min(CHUNK, layout.fileSizes[kind] - part * CHUNK);
  if (expected <= 0 || !request.body) return jsonError("파일 조각 오류");
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > expected) { await reader.cancel(); return jsonError("파일 조각 용량 초과", 413); } chunks.push(next.value); }
  if (size !== expected) return jsonError("파일 전송 용량이 맞지 않아요.");
  await bindings().ARTWORKS.put(`print-uploads/${upload.id}/${kind}-${part}`, Buffer.concat(chunks));
  return noStoreJson({ ok: true });
}
