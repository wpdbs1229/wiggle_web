import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { flipAnnouncement, settleIndex, stepIndex, swipeDirection } from "../app/components/ArchiveFlip.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

/* 내 그림 보관함 = 펼친 스케치북 (2026-09-20 GPT 인계 archive-sketchbook-handoff v2).
 * 학생 홈이 없어져 이 화면이 도화지 밖의 유일한 자리다. 그림책·수업 마치기로 가는 길이 여기서
 * 끊기면 아이가 갈 곳이 없어진다. 「새 그림」은 인계 지시로 **뺐다** — 되살아나지 않게 여기서 막는다. */

test("보관함에 새 그림 진입점이 없다", async () => {
  const source = await read("../app/components/Archive.tsx");
  // 주석의 설명까지 걸리지 않게, 화면에 나갈 문구와 주소만 본다.
  const markup = source.slice(source.indexOf("return <main"));
  assert.doesNotMatch(markup, /새 그림/);
  assert.doesNotMatch(markup, /draw\/new/);
  // 다른 길은 그대로 남는다.
  assert.match(source, /href="\/student\/books"/);
  assert.match(source, /수업 마치기/);
});

test("책은 장식이고 읽을 것과 누를 것은 실제 DOM이다", async () => {
  const source = await read("../app/components/Archive.tsx");
  // 시안 전체를 배경으로 깔고 투명 버튼을 얹지 않는다(인계 지시).
  assert.match(source, /className="archive-book-shell" src="\/archive-book\/book-open-blank\.webp" alt="" aria-hidden="true"/);
  assert.doesNotMatch(source, /approved-reference/);
  // 목록·제목·단추는 DOM이다.
  assert.match(source, /className="archive-book-list"/);
  assert.match(source, /className="archive-book-view"/);
});

test("여러 장일 때만 넘기기가 보이고 끝에서 멈춘다", () => {
  // 순환하지 않는다 — 끝에서 처음으로 돌아가면 아이가 몇 장인지 알 수 없다.
  assert.equal(stepIndex(0, "prev", 3), 0);
  assert.equal(stepIndex(2, "next", 3), 2);
  assert.equal(stepIndex(0, "next", 3), 1);
  assert.equal(stepIndex(2, "prev", 3), 1);
  // 한 장이면 어느 쪽으로도 움직이지 않는다.
  assert.equal(stepIndex(0, "next", 1), 0);
});

test("고른 그림이 사라져도 빈 화면이 되지 않는다", () => {
  assert.equal(settleIndex(["a", "b"], "b"), 1);
  assert.equal(settleIndex(["a", "b"], "사라진것"), 0);
  assert.equal(settleIndex([], "a"), -1);
});

test("가로 스와이프만 한 장 넘김으로 친다", () => {
  // 세로 스크롤과 두 손가락 확대를 뺏지 않으려고 가로가 세로보다 1.5배 이상일 때만 센다.
  assert.equal(swipeDirection(-80, 10), "next");
  assert.equal(swipeDirection(80, 10), "prev");
  assert.equal(swipeDirection(-30, 5), null, "48px 미만은 무시");
  assert.equal(swipeDirection(-80, 70), null, "세로가 더 크면 스크롤이다");
});

test("넘긴 뒤 한 번만 읽어 줄 문구를 만든다", () => {
  assert.equal(flipAnnouncement(1, 3, "내 마음 그림"), "3장 중 2번째 그림, 내 마음 그림");
});

test("넘김은 하나의 전환 함수로 들어가고 반드시 정착한다", async () => {
  const source = await read("../app/components/Archive.tsx");
  // 목록 클릭·이전/다음·스와이프·키보드가 모두 goTo로 들어온다.
  assert.match(source, /const goTo = useCallback/);
  assert.match(source, /if \(busy\) return;/);
  // 대상 그림을 받은 뒤에 돈다 — 준비 전에 빈 종이로 돌지 않는다.
  assert.match(source, /images\.load\(target, true\)[\s\S]{0,80}setFlip\(\(current\) => \(current \? \{ \.\.\.current, phase: "turning" \} : null\)\)/);
  // animationend만 믿지 않는다. 취소·백그라운드 탭에서도 정착해야 한다.
  assert.match(source, /window\.setTimeout\(finish, FLIP_MS \+ 60\)/);
  // 복제 레이어는 초점을 만들지 않는다.
  assert.match(source, /className="archive-leaf" aria-hidden="true" inert/);
});

test("움직임 줄이기에서는 3D 회전 없이 바로 바뀐다", async () => {
  const [source, css] = await Promise.all([read("../app/components/Archive.tsx"), read("../app/globals.css")]);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /if \(reduced\) \{ finish\(\); return; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\r?\n  \.archive-leaf \{ display:none; \}/);
});

test("책 좌표는 실제 에셋을 재서 넣었다", async () => {
  const css = await read("../app/globals.css");
  // book-open-blank.webp(1810×869)에서 잰 두 쪽 사각형이다. 눈대중으로 바꾸면 글자가 종이 밖으로 나간다.
  assert.match(css, /aspect-ratio:1810\/869/);
  assert.match(css, /\.archive-book-list \{ left:4\.86%; width:29\.17%;/);
  assert.match(css, /\.archive-book-view \{ left:34\.48%; width:60\.82%;/);
  assert.match(css, /top:6\.1%; height:86\.77%/);
});

test("760px 미만은 양면을 줄이지 않고 한 장 레이아웃으로 간다", async () => {
  const css = await read("../app/globals.css");
  // 기본(좁은 화면)에서는 책 그림을 아예 쓰지 않는다.
  assert.match(css, /\.archive-book-shell \{ display:none; \}/);
  assert.match(css, /@media \(min-width:760px\), \(orientation:landscape\) and \(max-height:560px\) and \(min-width:660px\) \{/);
  // 좁은 화면 목록은 가로로 밀어 고른다.
  assert.match(css, /\.archive-book-list>ul \{ display:flex;[^}]*overflow-x:auto;/);
  // 넘기기 단추는 권장 48px이다.
  assert.match(css, /\.archive-pager-button \{[^}]*width:48px; height:48px;/);
});
