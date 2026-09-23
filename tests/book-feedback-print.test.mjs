import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { defaultRubric, parseRubric, rubricVersion, validateFeedback } from "../lib/book-rubric.ts";
import { feedbackFilename, feedbackPdf, renderBookPages, printPdfs } from "../lib/book-render.ts";
import { selectedBookIds } from "../lib/book-workflow.ts";
import { validateShipping } from "../lib/book-print-workflow.ts";
import { startTestServer } from "./harness/server.mjs";
import { sha256 } from "../lib/token-crypto.ts";
import { emptyStorybookDocument } from "../lib/storybook-model.ts";

test("루브릭 원본의 10개 영역·50개 단계·100점 합계를 그대로 읽는다", async () => {
  const rubric = await defaultRubric();
  assert.equal(rubric.title, "그림책 피드백 3차");
  assert.equal(rubric.criteria.length, 10);
  assert.deepEqual(rubric.criteria.map((c) => c.levels.map((l) => l.score)), Array.from({ length: 10 }, () => [10, 8, 6, 4, 2]));
  assert.equal(rubric.maximum, 100); assert.equal(rubric.minimum, 20);
  assert.match(rubric.achievement[0], /4국03-04/);
  const changed = structuredClone(rubric); changed.criteria[0].levels[0].description += " 수정";
  assert.notEqual(rubricVersion(rubric), rubricVersion(changed));
  await assert.rejects(parseRubric(new Uint8Array(2_000_001)), /2MB/);
});
test("AI의 임의 점수·영역 누락·없는 쪽 근거는 거절한다", async () => {
  const rubric = await defaultRubric();
  const feedback = { summary: "결말에 마음을 전하는 말을 더 적어 보세요.", criteria: rubric.criteria.map((c) => ({ id: c.id, score: 8, feedback: "1쪽의 친구를 기다리는 장면에서 마음을 전하려는 시도가 나타남. 마지막 장면의 말을 더 구체적으로 다듬을 수 있음.", pages: [1] })) };
  assert.equal(validateFeedback(feedback, rubric, 2).criteria.length, 10);
  const invalid = structuredClone(feedback); invalid.criteria[0].score = 9;
  assert.throws(() => validateFeedback(invalid, rubric, 2));
  invalid.criteria[0].score = 8; invalid.criteria[0].pages = [3];
  assert.throws(() => validateFeedback(invalid, rubric, 2));
  assert.throws(() => validateFeedback({ ...feedback, criteria: [] }, rubric, 2));
});
test("파일명과 일괄 선택·배송지 검증", () => {
  assert.equal(feedbackFilename({ grade: 4, classNumber: 7, seatNumber: 1, realName: "테스트학생", title: "친구/이야기" }), "1_테스트학생_친구_이야기_피드백.pdf");
  assert.equal(feedbackFilename({ grade: null, classNumber: null, seatNumber: null, realName: null, title: "새 책" }), "학생_새 책_피드백.pdf");
  assert.throws(() => selectedBookIds(["storybook_12345678", "storybook_12345678"]));
  assert.throws(() => selectedBookIds(Array.from({ length: 51 }, (_, i) => `storybook_12345678${i}`)));
  assert.throws(() => validateShipping({ recipientName: "test" }));
});
test("한국어 피드백 PDF는 긴 문단을 여러 쪽으로 나누고 렌더러는 그림 색을 보존한다", async () => {
  const rubric = await defaultRubric();
  const feedback = { summary: "다음 이야기에서는 친구에게 건네는 말을 더 적어 보세요.", criteria: rubric.criteria.map((c) => ({ id: c.id, score: 8, feedback: "첫 장면에서 친구를 기다리는 마음이 글과 그림에 함께 나타남. 마지막 쪽에 서로의 마음을 전하는 대화를 더하면 변화가 분명해질 수 있음. ".repeat(3), pages: [1, 2] })) };
  const bytes = await feedbackPdf({ grade: 4, classNumber: 7, seatNumber: 1, realName: "테스트학생", title: "기다리는 마음" }, rubric, feedback, "test-version");
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 2);
  const doc = emptyStorybookDocument("square"); doc.pages[0].background = "#EF3344";
  doc.pages[0].elements.find((e) => e.type === "text").text = "친구야, 함께 놀자!";
  const images = await renderBookPages(doc, new Map(), 900);
  const pixel = await sharp(images[0]).extract({ left: 10, top: 10, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(pixel[0] > 210 && pixel[1] < 80);
  const print = await printPdfs(images, { bookSpecUid: "SQUAREBOOK_HC", name: "테스트", pageMin: 24, pageMax: 130, pageIncrement: 2, bindingType: "PUR", innerTrimWidthMm: 243, innerTrimHeightMm: 248, hingeGapMm: 10 }, { coverWidthMm: 544, coverHeightMm: 288, innerWidthMm: 249, innerHeightMm: 254, spineWidthMm: 10 }, "기다리는 마음");
  assert.equal((await PDFDocument.load(print.inner)).getPageCount(), 24);
  assert.equal(print.addedPages, 24 - (images.length - 1));
  const cover = await PDFDocument.load(print.cover); assert.equal(cover.getPageCount(), 1);
  assert.ok(Math.abs(cover.getPages()[0].getWidth() * 25.4 / 72 - 544) < .01);
  await mkdir("work/book-qa", { recursive: true });
  await writeFile("work/book-qa/feedback.pdf", bytes); await writeFile("work/book-qa/page.jpg", images[0]);
  await writeFile("work/book-qa/cover.pdf", print.cover); await writeFile("work/book-qa/inner.pdf", print.inner);
});

test("실제 HTTP: 타 학급 차단, 일괄 접수 중복 방지, 키 대기, 루브릭 교체와 PDF 저장", async (t) => {
  const server = await startTestServer({ env: { OPENAI_API_KEY: "", SWEETBOOK_API_KEY: "" } });
  t.after(() => server.dispose()); await server.fetch("/api/student");
  const teacherId = `teacher_${randomUUID()}`, classroomId = `class_${randomUUID().replaceAll("-", "").slice(0, 24)}`, studentId = `student_${randomUUID()}`, session = randomUUID();
  const bookId = `storybook_${randomUUID().replaceAll("-", "")}`, doc = emptyStorybookDocument("square");
  await server.DB.batch([
    server.DB.prepare("INSERT INTO teachers(id,email,display_name) VALUES (?,?,'테스트교사')").bind(teacherId, `${teacherId}@example.test`),
    server.DB.prepare("INSERT INTO classrooms(id,teacher_id,display_name,class_code,join_token) VALUES (?,?,'4학년 7반','8456',?)").bind(classroomId, teacherId, randomUUID()),
    server.DB.prepare("INSERT INTO student_profiles(id,classroom_id,nickname,animal,last_activity_at,seat_number,real_name) VALUES (?,?,'별명','cat',CURRENT_TIMESTAMP,1,'테스트학생')").bind(studentId, classroomId),
    server.DB.prepare("INSERT INTO teacher_sessions(token_hash,teacher_id,expires_at,last_used_at) VALUES (?,?,?,CURRENT_TIMESTAMP)").bind(await sha256(session), teacherId, new Date(Date.now() + 3_600_000).toISOString()),
    server.DB.prepare("INSERT INTO storybooks(id,student_id,classroom_id,title,document_json,schema_version,revision,status,completed_at) VALUES (?,?,?,'테스트 책',?,1,1,'complete',CURRENT_TIMESTAMP)").bind(bookId, studentId, classroomId, JSON.stringify(doc)),
  ]);
  const headers = { cookie: `wiggle_teacher=${session}`, "content-type": "application/json" };
  const post = (path, body) => server.fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal((await server.fetch(`/api/teacher/book-feedback?classroomId=${classroomId}`)).status, 401);
  assert.equal((await server.fetch(`/api/teacher/book-feedback?classroomId=other`, { headers })).status, 403);
  assert.equal((await post("/api/teacher/book-feedback", { classroomId, storybookIds: [bookId, "storybook_notowned123"] })).status, 400);
  assert.equal((await server.DB.prepare("SELECT COUNT(*) AS n FROM book_feedback_jobs").first()).n, 0);
  for (let i = 0; i < 2; i++) assert.equal((await post("/api/teacher/book-feedback", { classroomId, storybookIds: [bookId] })).status, 202);
  assert.equal((await server.DB.prepare("SELECT COUNT(*) AS n FROM book_feedback_jobs").first()).n, 1);
  const waiting = await (await post("/api/teacher/book-feedback/process", { classroomId })).json(); assert.equal(waiting.waitingKey, true);
  const job = await server.DB.prepare("SELECT * FROM book_feedback_jobs").first(); assert.equal(job.status, "waiting_key");
  assert.doesNotMatch(job.prompt, /테스트학생/);
  const rubric = JSON.parse(job.rubric_json), feedback = { summary: "마지막 쪽을 더 다듬어 보세요.", criteria: rubric.criteria.map((c) => ({ id: c.id, score: 8, feedback: "첫 쪽에서 등장인물의 마음이 나타남. 마지막 쪽의 대화를 더 자세하게 적으면 주제를 전달하는 데 도움이 됨.", pages: [1] })) };
  await server.DB.prepare("UPDATE book_feedback_jobs SET status='complete',feedback_json=? WHERE id=?").bind(JSON.stringify(feedback), job.id).run();
  assert.equal((await server.fetch(`/api/teacher/book-feedback/${job.id}?format=pdf`, { headers })).status, 200);
  assert.equal((await post("/api/teacher/book-feedback", { action: "identity", classroomId, grade: 4, classNumber: 7 })).status, 200);
  const download = await server.fetch(`/api/teacher/book-feedback/${job.id}?format=pdf`, { headers }); assert.equal(download.status, 200);
  assert.match(decodeURIComponent(download.headers.get("content-disposition")), /1_테스트학생_테스트 책_피드백.pdf/);
  assert.equal((await server.fetch(`/api/teacher/book-feedback/${job.id}?format=pdf&criteria=unknown`, { headers })).status, 400);
  assert.equal((await server.fetch(`/api/teacher/book-feedback/${job.id}?format=pdf&criteria=&summary=0`, { headers })).status, 400);
  assert.equal((await server.fetch(`/api/teacher/book-feedback/${job.id}?format=pdf&criteria=criterion_2&summary=0&scores=0`, { headers })).status, 200);
  assert.equal((await server.fetch(`/api/teacher/book-feedback?classroomId=other&format=xlsx`, { headers })).status, 403);
  const template = await server.fetch(`/api/teacher/book-feedback?classroomId=${classroomId}&format=xlsx`, { headers });
  assert.equal(template.status, 200);
  assert.deepEqual(await parseRubric(new Uint8Array(await template.arrayBuffer())), rubric);
  assert.ok((await PDFDocument.load(await download.arrayBuffer())).getPageCount() > 0);
  const form = new FormData(); form.append("classroomId", classroomId); form.append("file", new Blob([await readFile("config/rubrics/storybook.xlsx")]), "다시올린루브릭.xlsx");
  assert.equal((await server.fetch("/api/teacher/book-feedback", { method: "POST", headers: { cookie: headers.cookie }, body: form })).status, 200);
  await server.DB.prepare("UPDATE storybooks SET revision = 2 WHERE id = ?").bind(bookId).run();
  assert.equal((await server.fetch(`/api/teacher/book-feedback/${job.id}?format=pdf`, { headers })).status, 409);
  assert.equal((await post("/api/teacher/book-print", { action: "prepare", classroomId, storybookIds: [bookId], specUid: "SQUAREBOOK_HC" })).status, 400);
});
