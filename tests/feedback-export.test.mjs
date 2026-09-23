import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRubric, parseRubric, rubricWorkbook } from '../lib/book-rubric.ts';
import { feedbackPdf } from '../lib/book-render.ts';
import { defaultFeedbackExport, parseFeedbackExport, feedbackExportContent } from '../lib/feedback-export.ts';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import ExcelJS from 'exceljs';

test('current rubric workbook survives download, editing a criterion and reupload', async () => {
  const rubric = await defaultRubric();
  const bytes = await rubricWorkbook(rubric);
  assert.deepEqual(await parseRubric(bytes), rubric);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet('평가');
  sheet.eachRow(row => { if (row.getCell(1).text === '채점기준 1') row.getCell(2).value = '내 수업에 맞춘 영역'; });
  const edited = await parseRubric(new Uint8Array(await workbook.xlsx.writeBuffer()));
  assert.equal(edited.criteria[0].name, '내 수업에 맞춘 영역');
  assert.deepEqual(edited.criteria.slice(1), rubric.criteria.slice(1));
});
test('selected feedback PDF excludes unselected prose, scores and summary; partial score denominator matches selection', async () => {
  const rubric = await defaultRubric();
  const feedback = { criteria: rubric.criteria.map((c, i) => ({ id: c.id, score: 8, feedback: `고유피드백${i} 책에서 발견한 마음을 구체적으로 표현했습니다.`, pages: [i + 1] })), summary: '고유종합의견 다음 이야기를 이어 보세요.' };
  const options = parseFeedbackExport(new URLSearchParams('criteria=criterion_2&summary=0&scores=0&pages=1'), rubric);
  const content = feedbackExportContent(rubric, feedback, options);
  assert.equal(content.total, 8); assert.equal(content.maximum, 10); assert.equal(content.partial, true);
  const bytes = await feedbackPdf({ grade: null, classNumber: null, seatNumber: 3, realName: '예시학생', title: '우리들의 이야기' }, rubric, feedback, 'version', options);
  const task = getDocument({ data: bytes, useSystemFonts: true });
  const pdf = await task.promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) text += (await (await pdf.getPage(i)).getTextContent()).items.map(item => item.str).join(' ');
  assert.match(text, /고유피드백1/); assert.doesNotMatch(text, /고유피드백0|고유피드백2|고유종합의견|총점|8 \/ 10|학년|null/);
  assert.match(text, /근거: 2쪽/);
  await task.destroy();
  assert.equal(defaultFeedbackExport(rubric).criteria.length, 10);
  assert.throws(() => parseFeedbackExport(new URLSearchParams('criteria=criterion_1,criterion_1'), rubric));
  assert.throws(() => parseFeedbackExport(new URLSearchParams('criteria=invalid'), rubric));
  assert.throws(() => parseFeedbackExport(new URLSearchParams('criteria=&summary=0'), rubric));
  assert.deepEqual(parseFeedbackExport(new URLSearchParams('criteria=&summary=1'), rubric).criteria, []);
});
