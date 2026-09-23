import { emptyStorybookDocument, DEFAULT_STORYBOOK_FORMAT, storybookAspectRatio } from "@/lib/storybook-model";
import { postJson } from "@/app/components/book-workflow-client";

async function importRequest<T>(url: string, init: RequestInit): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { cache: "no-store", ...init });
    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      continue;
    }
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "PDF를 가져오지 못했어요.");
    return data;
  }
}

export async function importBookPdf(file: File, classroomId: string, studentId: string, title: string, progress: (text: string) => void) {
  if (!file.name.toLowerCase().endsWith(".pdf") || file.size < 5 || file.size > 30_000_000) throw new Error("30MB 이하의 PDF를 선택해 주세요.");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: await file.arrayBuffer(), cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/" });
  let bookId = "";
  try {
    const pdf = await task.promise;
    if (!Number.isSafeInteger(pdf.numPages) || pdf.numPages < 1) throw new Error("PDF에 가져올 쪽이 없어요.");
    const format = DEFAULT_STORYBOOK_FORMAT;
    const targetRatio = storybookAspectRatio(format);
    const doc = emptyStorybookDocument(format); doc.pages = [];
    bookId = `storybook_${crypto.randomUUID().replaceAll("-", "")}`;
    await importRequest("/api/teacher/book-import", postJson({ classroomId, studentId, title, format, pageCount: pdf.numPages, bookId }));
    let revision = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      progress(`${file.name} · ${n}/${pdf.numPages}쪽 가져오는 중`);
      const page = await pdf.getPage(n), native = page.getViewport({ scale: 1 });
      const width = Math.round(2400 * Math.min(1, targetRatio)), height = Math.round(width / targetRatio);
      const scale = Math.min(width / native.width, height / native.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d"); if (!context) throw new Error("PDF 그림을 준비할 수 없어요.");
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height);
      await page.render({ canvas, canvasContext: context, viewport, transform: [1, 0, 0, 1, (width - viewport.width) / 2, (height - viewport.height) / 2], background: "rgba(0,0,0,0)" }).promise;
      let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      // Bound each request below Vercel's body limit. Very detailed scans are downsampled, never cropped.
      while (blob && blob.size > 3_500_000 && canvas.width > 1000) {
        const small = document.createElement("canvas"); small.width = Math.round(canvas.width * .8); small.height = Math.round(canvas.height * .8);
        small.getContext("2d")!.drawImage(canvas, 0, 0, small.width, small.height);
        canvas.width = small.width; canvas.height = small.height; context.drawImage(small, 0, 0);
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      }
      if (!blob || blob.size > 3_500_000) throw new Error("한 쪽의 이미지가 너무 커요. PDF 해상도를 줄여 다시 올려 주세요.");
      const { asset } = await importRequest<{ asset: { id: string } }>(`/api/teacher/book-editor/${bookId}/assets`, { method: "POST", headers: { "content-type": "image/png" }, body: blob });
      const imported = emptyStorybookDocument(format, `page_${crypto.randomUUID().replaceAll("-", "")}`, `element_${crypto.randomUUID().replaceAll("-", "")}`).pages[0];
      imported.backgroundAssetId = asset.id; imported.elements[0].text = ""; doc.pages.push(imported);
      // Save each successful page as a recoverable draft, but expose feedback/order only after all pages exist.
      const saved = await importRequest<{ revision: number }>(`/api/teacher/book-editor/${bookId}`, postJson({ requestId: `import_${crypto.randomUUID().replaceAll("-", "")}`, expectedRevision: revision, title, document: doc, complete: n === pdf.numPages }, "PUT"));
      revision = saved.revision; page.cleanup(); canvas.width = canvas.height = 1;
    }
    return bookId;
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF를 읽지 못했어요.";
    throw new Error(`${message}${bookId ? " 가져온 쪽은 아래 ‘편집 중인 책’에 보관됩니다." : " 암호·손상 여부를 확인해 주세요."}`);
  } finally { await task.destroy(); }
}
