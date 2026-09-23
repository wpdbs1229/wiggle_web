import type { BookFeedback, Rubric } from "./book-rubric";

export type FeedbackExportOptions = { criteria: string[]; scores: boolean; summary: boolean; pages: boolean };
export function defaultFeedbackExport(rubric: Rubric): FeedbackExportOptions {
  return { criteria: rubric.criteria.map(c => c.id), scores: true, summary: true, pages: false };
}
export function parseFeedbackExport(params: URLSearchParams, rubric: Rubric): FeedbackExportOptions {
  const options = defaultFeedbackExport(rubric);
  if (params.has("criteria")) options.criteria = params.get("criteria")!.split(",").filter(Boolean);
  if (new Set(options.criteria).size !== options.criteria.length || options.criteria.some(id => !rubric.criteria.some(c => c.id === id))) throw new Error("선택한 평가 영역을 확인해 주세요.");
  for (const key of ["scores", "summary", "pages"] as const) {
    if (params.has(key)) {
      if (!["0", "1"].includes(params.get(key)!)) throw new Error("PDF 표시 옵션을 확인해 주세요.");
      options[key] = params.get(key) === "1";
    }
  }
  if (!options.criteria.length && !options.summary) throw new Error("평가 영역 또는 종합 의견을 하나 이상 선택해 주세요.");
  return options;
}
export function feedbackExportQuery(options: FeedbackExportOptions) {
  return new URLSearchParams({ criteria: options.criteria.join(","), scores: options.scores ? "1" : "0", summary: options.summary ? "1" : "0", pages: options.pages ? "1" : "0" });
}
export function feedbackExportContent(rubric: Rubric, feedback: BookFeedback, options: FeedbackExportOptions) {
  const criteria = rubric.criteria.filter(c => options.criteria.includes(c.id)).map(c => ({ ...c, result: feedback.criteria.find(item => item.id === c.id)! }));
  return { criteria, total: criteria.reduce((sum, c) => sum + c.result.score, 0), maximum: criteria.reduce((sum, c) => sum + Math.max(...c.levels.map(l => l.score)), 0), partial: criteria.length !== rubric.criteria.length };
}
