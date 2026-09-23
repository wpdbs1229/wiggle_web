import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { rubricTemplateRows } from "@/lib/rubric-template";

export type Rubric = { title: string; achievement: string[]; criteria: { id: string; name: string; levels: { score: number; description: string }[] }[]; maximum: number; minimum: number; absent: number; unsubmitted: number };
export const rubricVersion = (rubric: Rubric) => createHash("sha256").update(JSON.stringify(rubric)).digest("hex");

// Same three-column layout as the supplied workbook. Row numbers are not hardcoded.
export async function parseRubric(bytes: Uint8Array): Promise<Rubric> {
  if (bytes.byteLength > 2_000_000) throw new Error("루브릭은 2MB 이하의 .xlsx 파일로 올려 주세요.");
  let expandedBytes = 0;
  // Inspect advertised ZIP sizes before ExcelJS decompresses XML (zip-bomb guard).
  unzipSync(bytes, { filter: (entry) => {
    expandedBytes += entry.originalSize;
    if (expandedBytes > 12_000_000 || entry.originalSize > 5_000_000) throw new Error("압축 해제된 루브릭이 너무 커요. 사용하지 않는 시트와 이미지를 제거해 주세요.");
    return false;
  } });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  const sheet = workbook.getWorksheet("평가");
  if (!sheet || sheet.rowCount > 500) throw new Error("‘평가’ 시트와 A·B·C열 형식을 확인해 주세요.");
  const rubric: Rubric = { title: "", achievement: [], criteria: [], maximum: 0, minimum: 0, absent: 0, unsubmitted: 0 };
  let current: Rubric["criteria"][number] | undefined;
  sheet.eachRow((row) => {
    const [a, b, c] = [1, 2, 3].map((n) => row.getCell(n).text.trim());
    if ([a, b, c].some((v) => v.length > 1500)) throw new Error("루브릭 셀은 1,500자 이하로 적어 주세요.");
    if (a === "평가명") rubric.title = b;
    if (a.startsWith("성취기준") || (!current && c && ["상", "중", "하"].includes(b))) rubric.achievement.push(`${b}: ${c}`);
    if (/^채점기준\s*\d+$/.test(a)) {
      current = { id: `criterion_${rubric.criteria.length + 1}`, name: b, levels: [] };
      rubric.criteria.push(current);
    } else if (current && !a && c && b !== "" && Number.isFinite(Number(b))) {
      current.levels.push({ score: Number(b), description: c });
    }
    if (a === "영역만점") rubric.maximum = Number(b);
    if (a === "최소점수") rubric.minimum = Number(b);
    if (a === "미제출") rubric.unsubmitted = Number(b);
    if (a === "미응시") rubric.absent = Number(b);
  });
  if (!rubric.title || !rubric.achievement.length || !rubric.criteria.length || rubric.criteria.length > 20) throw new Error("평가명·성취기준·채점기준(1~20개)을 확인해 주세요.");
  for (const criterion of rubric.criteria) {
    if (!criterion.name || !criterion.levels.length || criterion.levels.length > 10 || criterion.levels.some((l) => l.score < 0 || l.score > 100) || new Set(criterion.levels.map((l) => l.score)).size !== criterion.levels.length) throw new Error(`${criterion.name}: 배점과 단계 설명을 확인해 주세요.`);
  }
  const maximum = rubric.criteria.reduce((sum, c) => sum + Math.max(...c.levels.map((l) => l.score)), 0);
  const minimum = rubric.criteria.reduce((sum, c) => sum + Math.min(...c.levels.map((l) => l.score)), 0);
  if (maximum !== rubric.maximum || minimum !== rubric.minimum) throw new Error(`배점 합계와 영역만점(${maximum})·최소점수(${minimum})가 일치해야 해요.`);
  return rubric;
}

export async function defaultRubric() {
  return parseRubric(await readFile(`${process.cwd()}/config/rubrics/storybook.xlsx`));
}

export async function rubricWorkbook(rubric: Rubric) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("평가", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [{ width: 20 }, { width: 48 }, { width: 100 }];
  for (const values of rubricTemplateRows(rubric)) {
    const row = sheet.addRow(values);
    row.height = Math.max(32, Math.ceil(String(values[2]).length / 65) * 18 + 12);
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.font = { name: "맑은 고딕", size: 11, color: { argb: column === 1 ? "FF536359" : "FF244D39" } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: column === 1 ? "FFF0F2EF" : "FFFFFFE5" } };
    });
    if (String(values[0]).startsWith("채점기준") || values[0] === "평가명") row.font = { name: "맑은 고딕", size: 12, bold: true };
  }
  const guide = workbook.addWorksheet("수정 안내");
  guide.columns = [{ width: 26 }, { width: 110 }];
  [
    ["현재 평가 기준 수정 양식", "‘평가’ 시트의 연노랑 B·C열을 수정한 뒤 .xlsx로 저장해 올려 주세요."],
    ["평가 이름", "평가명 행 B열을 수정합니다."],
    ["영역 이름", "채점기준 N 행 B열을 수정합니다. A열의 채점기준 N 표시는 유지합니다."],
    ["점수와 판단 기준", "영역 바로 아래 행 B열은 점수, C열은 그 점수를 주는 기준입니다. 단계 행의 A열은 비워 둡니다."],
    ["영역 추가·삭제", "채점기준 행과 그 아래 단계 행들을 한 묶음으로 복사하거나 삭제합니다. 영역은 1~20개, 단계는 영역당 1~10개입니다."],
    ["점수를 바꿨다면", "맨 아래 영역만점(B열)은 각 영역 최고점의 합, 최소점수(B열)는 각 영역 최저점의 합으로 수정합니다."],
    ["유지할 것", "‘평가’ 시트 이름, A열 항목명, A·B·C열 순서를 유지합니다. 같은 영역 안에서 점수는 중복할 수 없습니다."],
    ["적용 범위", "업로드 후 새로 요청하는 피드백에 적용합니다. 이미 만들어진 피드백은 당시 기준을 유지합니다."],
  ].forEach(values => { const row = guide.addRow(values); row.height = 48; row.alignment = { wrapText: true, vertical: "middle" }; row.font = { name: "맑은 고딕", size: 11 }; });
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function feedbackPrompt(rubric: Rubric) {
  return `${await readFile(`${process.cwd()}/config/rubrics/feedback-prompt.md`, "utf8")}\n\n<rubric_data>\n${JSON.stringify(rubric, null, 2)}\n</rubric_data>`;
}

export type BookFeedback = { criteria: { id: string; score: number; feedback: string; pages: number[] }[]; summary: string };
export function validateFeedback(value: unknown, rubric: Rubric, pageCount: number): BookFeedback {
  const data = value as BookFeedback;
  if (!data || !Array.isArray(data.criteria) || data.criteria.length !== rubric.criteria.length || typeof data.summary !== "string" || !data.summary.trim() || data.summary.length > 1500) throw new Error("AI 응답 형식이 올바르지 않아요. 다시 요청해 주세요.");
  for (let i = 0; i < rubric.criteria.length; i++) {
    const item = data.criteria[i];
    if (item.id !== rubric.criteria[i].id || !rubric.criteria[i].levels.some((l) => l.score === item.score) || typeof item.feedback !== "string" || item.feedback.trim().length < 20 || item.feedback.length > 1500 || !Array.isArray(item.pages) || !item.pages.length || item.pages.some((p) => !Number.isInteger(p) || p < 1 || p > pageCount)) throw new Error("AI의 배점·근거 쪽 번호가 기준과 맞지 않아요. 다시 요청해 주세요.");
  }
  return data;
}
