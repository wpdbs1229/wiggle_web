// Book Print API SQUAREBOOK_HC, verified 2026-09-17:
// https://api.sweetbook.com/docs/concepts/pdf-size/
import type { PrintSize, PrintSpec } from "@/lib/book-render";
export const BOOK_PRINT_SPEC_UID = "SQUAREBOOK_HC";
export function assertBookPrintSpec(spec: PrintSpec) {
  if (spec.bookSpecUid !== BOOK_PRINT_SPEC_UID || spec.bindingType !== "PUR" || spec.innerTrimWidthMm !== 243 || spec.innerTrimHeightMm !== 248 || spec.pageMin !== 24 || spec.pageMax !== 130 || spec.pageIncrement !== 2) throw new Error("243 × 248mm 스퀘어북 하드커버 제작 규격을 확인해 주세요.");
}
export function assertBookPrintSize(size: PrintSize, pages: number) {
  const spine = pages <= 64 ? 10 : 16;
  if (!Number.isInteger(pages) || pages < 24 || pages > 130 || pages % 2 || size.innerWidthMm !== 249 || size.innerHeightMm !== 254 || size.coverWidthMm !== 534 + spine || size.coverHeightMm !== 288 || size.spineWidthMm !== spine) throw new Error("표지·내지 크기가 스퀘어북 하드커버 규격과 달라요. 제작사 규격을 확인해 주세요.");
}
