import assert from "node:assert/strict";
import test from "node:test";
import {
  createStorybookTextElement,
  emptyStorybookDocument,
  MAX_STORYBOOK_ELEMENTS_PER_PAGE,
  MAX_STORYBOOK_TEXT_GRAPHEMES,
  STORYBOOK_IMAGE_AREA,
  STORYBOOK_TEXT_BOX,
  validateStorybookDocument,
} from "../lib/storybook-model.ts";

const textElement = (overrides = {}) => ({
  id: "element_storytext001",
  type: "text",
  text: "숲속에서 작은 별을 만났어요.",
  ...STORYBOOK_TEXT_BOX,
  rotation: 0, zIndex: 0, opacity: 1, locked: true,
  fontSize: 0.045, color: "#24324a", align: "center",
  ...overrides,
});

const imageElement = (overrides = {}) => ({
  id: "element_storyimage01",
  type: "image",
  assetId: "asset_storyasset01",
  x: 0.05, y: 0.25, width: 0.9, height: 0.62,
  rotation: 0, zIndex: 1, opacity: 1, locked: false,
  ...overrides,
});

test("빈 그림책과 글·그림을 분리한 페이지를 검증하고 색을 정규화한다", () => {
  assert.ok(validateStorybookDocument(emptyStorybookDocument()));
  const document = emptyStorybookDocument("portrait", "page_storypage001");
  document.pages[0].background = "#fff5db";
  document.pages[0].backgroundAssetId = "asset_background01";
  document.pages[0].elements = [imageElement(), textElement()];
  const result = validateStorybookDocument(document);
  assert.ok(result);
  assert.equal(result.pages[0].background, "#FFF5DB");
  assert.equal(result.pages[0].backgroundAssetId, "asset_background01");
  assert.equal(result.pages[0].elements[1].color, "#24324A");
});

test("그림의 실제 내용 경계는 원본 안의 유효한 자르기 영역으로 저장한다", () => {
  const document = emptyStorybookDocument();
  document.pages[0].elements.push(imageElement({
    aspectRatio: 0.75,
    crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.8 },
  }));
  const result = validateStorybookDocument(document);
  assert.deepEqual(result.pages[0].elements[1].crop, { x: 0.25, y: 0.1, width: 0.5, height: 0.8 });

  document.pages[0].elements[1].crop = { x: 0.8, y: 0.1, width: 0.3, height: 0.8 };
  assert.equal(validateStorybookDocument(document), null);
});

test("각 쪽은 위쪽 가운데 고정 글 하나와 그 아래 그림 영역만 허용한다", () => {
  const missingText = emptyStorybookDocument();
  missingText.pages[0].elements = [imageElement()];
  assert.equal(validateStorybookDocument(missingText), null);

  const movingText = emptyStorybookDocument();
  movingText.pages[0].elements = [textElement({ y: STORYBOOK_TEXT_BOX.y + 0.1 })];
  assert.equal(validateStorybookDocument(movingText), null);

  const imageAboveText = emptyStorybookDocument();
  imageAboveText.pages[0].elements.push(imageElement({ y: STORYBOOK_IMAGE_AREA.y - 0.01 }));
  assert.equal(validateStorybookDocument(imageAboveText), null);
});

test("요소는 페이지 밖으로 나가거나 다른 형식의 자산 ID를 참조할 수 없다", () => {
  const document = emptyStorybookDocument();
  document.pages[0].elements = [imageElement({ x: 0.8, width: 0.4 })];
  assert.equal(validateStorybookDocument(document), null);
  document.pages[0].elements = [imageElement({ assetId: "artwork_not_an_asset" })];
  assert.equal(validateStorybookDocument(document), null);
  document.pages[0].elements = [imageElement({ opacity: 0 })];
  assert.equal(validateStorybookDocument(document), null);
});

test("가져온 책은 24쪽·인쇄 상한을 넘어도 모든 쪽을 보존한다", () => {
  for (const count of [25, 131, 1000]) {
    const document = emptyStorybookDocument();
    document.pages = Array.from({ length: count }, (_, i) => emptyStorybookDocument("squarebook-hc", `page_import${i.toString().padStart(8, "0")}`, `element_import${i.toString().padStart(8, "0")}`).pages[0]);
    const saved = validateStorybookDocument(document);
    assert.equal(saved.pages.length, count);
    assert.deepEqual(saved.pages.map(p => p.id), document.pages.map(p => p.id));
  }
});

test("빈 책·요소·글자 수 상한과 중복 ID를 거부한다", () => {
  const empty = emptyStorybookDocument(); empty.pages = [];
  assert.equal(validateStorybookDocument(empty), null);

  const tooManyElements = emptyStorybookDocument();
  tooManyElements.pages[0].elements = Array.from({ length: MAX_STORYBOOK_ELEMENTS_PER_PAGE + 1 }, (_, index) => textElement({ id: `element_${String(index).padStart(8, "0")}` }));
  assert.equal(validateStorybookDocument(tooManyElements), null);

  const longText = emptyStorybookDocument();
  longText.pages[0].elements = [textElement({ text: "가".repeat(MAX_STORYBOOK_TEXT_GRAPHEMES + 1) })];
  assert.equal(validateStorybookDocument(longText), null);

  const duplicate = emptyStorybookDocument();
  duplicate.pages[0].elements = [textElement(), textElement()];
  assert.equal(validateStorybookDocument(duplicate), null);
});

test("저장 문서에 제어문자와 비정상 숫자를 허용하지 않는다", () => {
  const control = emptyStorybookDocument();
  control.pages[0].elements = [textElement({ text: "안녕\u0000친구" })];
  assert.equal(validateStorybookDocument(control), null);
  const infinite = emptyStorybookDocument();
  infinite.pages[0].elements = [textElement({ rotation: Number.POSITIVE_INFINITY })];
  assert.equal(validateStorybookDocument(infinite), null);
});

test("문서 한도는 UTF-16 글자 수가 아니라 실제 UTF-8 바이트로 계산한다", () => {
  const document = emptyStorybookDocument();
  document.pages = Array.from({ length: 400 }, (_, pageIndex) => ({
    id: `page_${String(pageIndex).padStart(8, "0")}`,
    background: "#FFFFFF",
    elements: [
      createStorybookTextElement(`element_text${String(pageIndex).padStart(8, "0")}`),
      ...Array.from({ length: MAX_STORYBOOK_ELEMENTS_PER_PAGE - 1 }, (_, elementIndex) => imageElement({ id: `element_${String(pageIndex * 100 + elementIndex).padStart(8, "0")}` })),
    ],
  }));
  for (const page of document.pages) page.elements[0].text = "한".repeat(MAX_STORYBOOK_TEXT_GRAPHEMES);
  assert.equal(validateStorybookDocument(document), null);
});
