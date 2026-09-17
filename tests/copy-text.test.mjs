import assert from "node:assert/strict";
import test from "node:test";
import { copyNoticeText, copyText } from "../lib/copy-text.ts";

/** navigator·document를 갈아 끼워 각 맥락을 실제로 태워 본다. */
function withEnv({ clipboard, execCommand }, run) {
  const originalNavigator = globalThis.navigator;
  const originalDocument = globalThis.document;
  const appended = [];
  const doc = {
    createElement: () => ({
      style: {}, value: "", readOnly: false,
      setAttribute() {}, select() {}, setSelectionRange() {},
      remove() { appended.pop(); },
    }),
    body: { appendChild: (node) => appended.push(node) },
    execCommand: execCommand ?? (() => false),
  };
  Object.defineProperty(globalThis, "navigator", { value: clipboard ? { clipboard } : {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true, writable: true });
  return Promise.resolve(run()).finally(() => {
    Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", { value: originalDocument, configurable: true, writable: true });
    assert.equal(appended.length, 0, "폴백이 textarea를 화면에 남기면 안 된다");
  });
}

test("보안 맥락에서는 클립보드로 복사한다", async () => {
  let written = "";
  await withEnv({ clipboard: { writeText: async (text) => { written = text; } } }, async () => {
    assert.equal(await copyText("1234"), true);
  });
  assert.equal(written, "1234");
});

test("클립보드가 없는 비보안 맥락에서도 폴백으로 복사한다", async () => {
  // 교실 태블릿이 http://10.0.0.5:3000으로 열면 navigator.clipboard가 아예 없다.
  await withEnv({ clipboard: null, execCommand: () => true }, async () => {
    assert.equal(await copyText("1234"), true);
  });
});

test("클립보드가 거부해도 폴백을 한 번 더 시도한다", async () => {
  let tried = false;
  await withEnv({
    clipboard: { writeText: async () => { throw new Error("NotAllowedError"); } },
    execCommand: () => { tried = true; return true; },
  }, async () => {
    assert.equal(await copyText("1234"), true);
  });
  assert.equal(tried, true);
});

test("둘 다 실패하면 false를 돌려준다 — 부르는 쪽이 반드시 알리게", async () => {
  await withEnv({ clipboard: null, execCommand: () => false }, async () => {
    assert.equal(await copyText("1234"), false);
  });
});

test("빈 문자열은 복사하지 않는다", async () => {
  await withEnv({ clipboard: { writeText: async () => {} } }, async () => {
    assert.equal(await copyText(""), false);
  });
});

test("결과 문구는 성공과 실패를 구분해 알린다", () => {
  assert.equal(copyNoticeText(true, "수업 코드"), "수업 코드를 복사했어요.");
  assert.match(copyNoticeText(false, "수업 코드"), /직접 선택해 복사/);
});

test("복사 성공은 누른 단추의 체크로 알리고, 실패만 안내 줄로 알린다", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
  const [hook, teacher, roster, css] = await Promise.all([
    read("../app/components/useCopyFeedback.ts"),
    read("../app/components/TeacherApp.tsx"),
    read("../app/components/TeacherRosterSettings.tsx"),
    read("../app/globals.css"),
  ]);
  // 훅: 성공하면 지난 실패 안내를 지우고 체크 상태만 켠다. 실패는 반드시 글로 알린다.
  assert.match(hook, /if \(!ok\) \{\s*setCopied\(null\);\s*onFailure\(copyNoticeText\(false, label\)\);/);
  assert.match(hook, /onFailure\(""\);\s*setCopied\(\{ key, label \}\)/);
  assert.match(hook, /setTimeout\(\(\) => setCopied\(null\), resetMs\)/);
  // 두 교사 화면 모두 한 훅만 쓰고, 성공 문구(copyNoticeText(true))를 직접 띄우지 않는다.
  for (const [name, source] of [["TeacherApp", teacher], ["TeacherRosterSettings", roster]]) {
    assert.match(source, /useCopyFeedback\(/, `${name}은 복사 표시 훅을 써야 한다`);
    assert.doesNotMatch(source, /copyNoticeText\(await copyText/, `${name}에 옛 성공 안내 경로가 남아 있으면 안 된다`);
    assert.match(source, /copiedKey === /, `${name}은 누른 단추에서 체크를 보여야 한다`);
    // 읽어 주는 화면은 체크를 볼 수 없으므로 들리는 안내를 함께 둔다.
    assert.match(source, /className="sr-only" role="status">\{copiedLabel \? `\$\{copiedLabel\}를 복사했어요\.`/, `${name}에 들리는 복사 안내가 있어야 한다`);
  }
  // .sr-only는 규칙이 있어야 실제로 숨는다. 없으면 안내가 화면에 그대로 보인다.
  assert.match(css, /\.sr-only \{[^}]*clip-path:inset\(50%\)/);
});
