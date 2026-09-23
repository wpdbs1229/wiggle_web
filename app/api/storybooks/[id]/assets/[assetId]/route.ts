import { storybookEditorActor } from "@/lib/storybook-editor-auth";
import { bindings } from "@/db/runtime";
import { cleanText, jsonError } from "@/lib/security";

type OwnedAsset = { objectKey: string; contentType: string };

export async function GET(request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  const student = await storybookEditorActor(request);
  if (!student) return jsonError("학생 로그인이 필요해요.", 401);
  const params = await context.params;
  const storybookId = cleanText(params.id, 80);
  const assetId = cleanText(params.assetId, 80);
  const asset = await bindings().DB.prepare(`SELECT a.object_key AS objectKey, a.content_type AS contentType FROM storybook_assets a JOIN storybooks b ON b.id = a.storybook_id AND b.student_id = ? WHERE a.id = ? AND a.storybook_id = ? AND a.student_id = ?`).bind(student.id, assetId, storybookId, student.id).first<OwnedAsset>();
  if (!asset) return jsonError("내 그림책 이미지를 찾을 수 없어요.", 404);
  const object = await bindings().ARTWORKS.get(asset.objectKey);
  if (!object) return jsonError("저장된 이미지 파일을 찾을 수 없어요.", 404);
  return new Response(await object.arrayBuffer(), {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? asset.contentType,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
