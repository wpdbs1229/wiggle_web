import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const FACES = ["curious", "thinking", "suggesting", "delighted", "listening", "reassuring"];

/* 몽그리 표정 (2026-09-12 사용자 요청, 2026-09-09 사용 제안서의 매핑을 따름).
 * 핵심 규칙: 얼굴은 **UI 상태로만** 고른다. AI가 쓴 문장에서 감정을 읽어 고르지 않는다 —
 * 그렇게 하면 모델이 "대단"처럼 금지된 평가어를 쓰도록 유도하는 통로가 된다. */

test("표정 여섯 장이 모두 있고 투명 배경 PNG다", async () => {
  for (const name of FACES) {
    const bytes = await readFile(new URL(`../public/brand/mongri/${name}.png`, import.meta.url));
    assert.equal(bytes.subarray(1, 4).toString(), "PNG", name);
    // IHDR의 색 타입 6 = RGBA. 투명 배경이 살아 있어야 어느 패널 위에도 얹힌다.
    assert.equal(bytes[25], 6, `${name}은 알파 채널을 가져야 한다`);
    assert.equal(bytes.readUInt32BE(16), 224, `${name} 너비`);
  }
});

test("얼굴은 UI 상태로만 고르고, AI 문장을 읽지 않는다", async () => {
  const studio = await read("../app/components/DrawingStudio.tsx");
  const picker = studio.slice(studio.indexOf("const grimiFace ="), studio.indexOf('    : "listening";') + 20);
  assert.match(picker, /grimiError \? "reassuring"/);
  assert.match(picker, /grimiLoading \? "thinking"/);
  assert.match(picker, /grimiCollapsed && coaching \? "suggesting"/);
  // 2026-09-23: 답 고르기를 없애 읽기 전용이 되면서 "듣는 중" 얼굴이 설 자리가 사라졌다.
  // 접힌 제안 → 질문 두 상태만 남는다.
  assert.doesNotMatch(picker, /answer/);
  assert.match(picker, /coaching \? "curious"/);
  // 코칭 문장이나 짐작 글자를 훑어 표정을 고르는 코드가 없어야 한다.
  assert.doesNotMatch(picker, /question|guess|nextAction|includes\(/);
});

test("짐작을 기다릴 때와 내놓을 때 얼굴이 다르다", async () => {
  const studio = await read("../app/components/DrawingStudio.tsx");
  assert.match(studio, /\$\{interpretation \? "delighted" : "thinking"\}/);
});

test("가로로 눕힌 폰에서 얼굴이 도화지를 먹지 않는다", async () => {
  // 96px 얼굴이 접힌 패널을 키워 844x390에서 그릴 칸이 140px 아래로 떨어졌다(실측 103px).
  const css = await read("../app/globals.css");
  assert.match(css, /@media \(max-height:480px\) \{ \.grimi-face \{ width:44px; height:44px; \} \}/);
});

test("여섯 장 모두 출처·해시와 함께 등록되어 있다", async () => {
  const manifest = JSON.parse(await read("../public/brand/asset-manifest.json"));
  for (const name of FACES) {
    const entry = manifest.assets.find((asset) => asset.path === `/brand/mongri/${name}.png`);
    assert.ok(entry, `${name} 등록 누락`);
    assert.match(entry.sha256, /^[0-9A-F]{64}$/);
    assert.ok(entry.approvedFor.length > 0);
  }
});
