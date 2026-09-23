import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { startTestServer } from "./harness/server.mjs";
import { sha256 } from "../lib/token-crypto.ts";
import { emptyStorybookDocument } from "../lib/storybook-model.ts";

function token(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function allCoordinates(mark) {
  if (mark.kind === "line" || mark.kind === "curve") return mark.points.flat();
  if (mark.kind === "ellipse") return [mark.x, mark.y, mark.x - mark.rx, mark.x + mark.rx, mark.y - mark.ry, mark.y + mark.ry];
  return [mark.x, mark.y, mark.x + mark.width, mark.y + mark.height];
}

async function expectStatus(response, status) {
  if (response.status !== status) assert.fail(`expected ${status}, received ${response.status}: ${await response.text()}`);
  return response;
}

test("교사는 자기 반 완성 그림책만 열고 피드백을 요청한다", async (context) => {
  const server = await startTestServer();
  context.after(() => server.dispose());
  // 첫 요청이 실제 런타임 프로비저닝을 수행한다.
  await server.fetch("/api/student");

  const teacherId = token("teacher");
  const otherTeacherId = token("teacher");
  const classroomId = token("class");
  const otherClassroomId = token("class");
  const studentId = token("student");
  const otherStudentId = token("student");
  const teacherSession = token("session");
  const studentSession = token("session");
  const now = new Date();
  const expires = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString();
  await server.DB.batch([
    server.DB.prepare("INSERT INTO teachers(id, email, display_name) VALUES (?, 'books@example.com', '책 선생님')").bind(teacherId),
    server.DB.prepare("INSERT INTO teachers(id, email, display_name) VALUES (?, 'other-books@example.com', '다른 선생님')").bind(otherTeacherId),
    server.DB.prepare("INSERT INTO classrooms(id, teacher_id, display_name, class_code, join_token) VALUES (?, ?, '책 만드는 반', '7711', 'join_books_7711')").bind(classroomId, teacherId),
    server.DB.prepare("INSERT INTO classrooms(id, teacher_id, display_name, class_code, join_token) VALUES (?, ?, '다른 반', '7712', 'join_books_7712')").bind(otherClassroomId, otherTeacherId),
    server.DB.prepare("INSERT INTO student_profiles(id, classroom_id, nickname, animal, last_activity_at) VALUES (?, ?, '반짝 화가', '🐰', ?)").bind(studentId, classroomId, now.toISOString()),
    server.DB.prepare("INSERT INTO student_profiles(id, classroom_id, nickname, animal, last_activity_at) VALUES (?, ?, '다른 화가', '🦊', ?)").bind(otherStudentId, otherClassroomId, now.toISOString()),
    server.DB.prepare("INSERT INTO teacher_sessions(token_hash, teacher_id, expires_at, last_used_at) VALUES (?, ?, ?, ?)").bind(await sha256(teacherSession), teacherId, expires, now.toISOString()),
    server.DB.prepare("INSERT INTO device_sessions(token_hash, student_id, expires_at, last_used_at) VALUES (?, ?, ?, ?)").bind(await sha256(studentSession), studentId, expires, now.toISOString()),
  ]);

  // 가이드 변형 순환은 레슨 카탈로그 은퇴(2026-08-30 제품 결정)와 함께 제거됐다 —
  // guide_variant 컬럼은 스키마에 남지만(파괴적 변경 금지, AD-2) 항상 0이다.

  const completedId = "storybook_completed_12345678";
  const draftId = "storybook_draft_123456789012";
  const otherId = "storybook_other_123456789012";
  const document = JSON.stringify(emptyStorybookDocument("landscape", "page_completed123", "element_completed123"));
  await server.DB.batch([
    server.DB.prepare("INSERT INTO storybooks(id, student_id, classroom_id, title, document_json, status, completed_at) VALUES (?, ?, ?, '나의 첫 그림책', ?, 'complete', ?)").bind(completedId, studentId, classroomId, document, now.toISOString()),
    server.DB.prepare("INSERT INTO storybooks(id, student_id, classroom_id, title, document_json, status) VALUES (?, ?, ?, '작성 중인 책', ?, 'draft')").bind(draftId, studentId, classroomId, document),
    server.DB.prepare("INSERT INTO storybooks(id, student_id, classroom_id, title, document_json, status, completed_at) VALUES (?, ?, ?, '다른 반 책', ?, 'complete', ?)").bind(otherId, otherStudentId, otherClassroomId, document, now.toISOString()),
  ]);

  const teacherHeaders = { cookie: `wiggle_teacher=${teacherSession}`, "content-type": "application/json" };
  const listResponse = await server.fetch(`/api/teacher/storybooks?classroomId=${classroomId}`, { headers: teacherHeaders });
  const list = await (await expectStatus(listResponse, 200)).json();
  assert.equal(list.storybooks.length, 1);
  assert.deepEqual({ id: list.storybooks[0].id, nickname: list.storybooks[0].nickname, animal: list.storybooks[0].animal }, { id: completedId, nickname: "반짝 화가", animal: "🐰" });
  assert.equal(JSON.stringify(list).includes("documentJson"), false);
  assert.equal(JSON.stringify(list).includes("objectKey"), false);

  const bookResponse = await server.fetch(`/api/teacher/storybooks/${completedId}`, { headers: teacherHeaders });
  assert.equal((await (await expectStatus(bookResponse, 200)).json()).storybook.document.pages.length, 1);
  const crossClassRead = await server.fetch(`/api/teacher/storybooks/${otherId}`, { headers: teacherHeaders });
  assert.equal(crossClassRead.status, 404);

  const mixedRequest = await server.fetch("/api/teacher/storybooks", {
    method: "POST", headers: teacherHeaders, body: JSON.stringify({ classroomId, storybookIds: [completedId, otherId] }),
  });
  assert.equal(mixedRequest.status, 403);
  assert.equal((await server.DB.prepare("SELECT COUNT(*) AS count FROM book_feedback_jobs").first()).count, 0);

  const feedbackRequest = await server.fetch("/api/teacher/storybooks", {
    method: "POST", headers: teacherHeaders, body: JSON.stringify({ classroomId, storybookIds: [completedId] }),
  });
  assert.deepEqual(await (await expectStatus(feedbackRequest, 202)).json(), { ok: true, requested: 1, status: "queued" });
  const stored = await server.DB.prepare("SELECT storybook_id AS storybookId, classroom_id AS classroomId, teacher_id AS teacherId, status, rubric_version AS rubricVersion, feedback_json AS feedbackJson FROM book_feedback_jobs").first();
  assert.match(stored.rubricVersion, /^[a-f0-9]{64}$/);
  assert.deepEqual(stored, { storybookId: completedId, classroomId, teacherId, status: "queued", rubricVersion: stored.rubricVersion, feedbackJson: null });
});
