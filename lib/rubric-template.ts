import type { Rubric } from "./book-rubric";

// Shared by the on-screen cell guide and the downloadable workbook.
export function rubricTemplateRows(rubric: Rubric): (string | number)[][] {
  return [
    ["평가명", rubric.title, ""],
    ...rubric.achievement.map((text) => {
      const split = text.indexOf(":");
      return ["성취기준", split < 0 ? "상" : text.slice(0, split), split < 0 ? text : text.slice(split + 1).trim()];
    }),
    ...rubric.criteria.flatMap((c, i) => [[`채점기준 ${i + 1}`, c.name, ""], ...c.levels.map(l => ["", l.score, l.description])]),
    ["영역만점", rubric.maximum, "각 영역 최고점의 합계"],
    ["최소점수", rubric.minimum, "각 영역 최저점의 합계"],
    ["미제출", rubric.unsubmitted, ""], ["미응시", rubric.absent, ""],
  ];
}
