import assert from "node:assert/strict";
import test from "node:test";
import { contentBounds, drawObjectBounds, estimateDocumentBytes, IMAGE_DATA_PREFIX, IMAGE_MAX_CHARS, MAX_IMAGE_PAYLOADS, movableDrawObjects, scaleDrawObject, toDocumentUnits, validateDrawDocument, visibleDrawOperations } from "../lib/drawing-model.ts";

const at = "2026-10-11T01:00:00.000Z";
const ids = (name) => ({ opId: `op_${name}`.padEnd(12, "0"), clientOpId: `client_${name}`.padEnd(14, "0"), at });
const jpeg = (fill = "A", length = 40) => `${IMAGE_DATA_PREFIX}/9j/${fill.repeat(length)}`;
const photo = (name, extra = {}) => ({ ...ids(name), type: "image", image: jpeg(), aspect: 0.75, width: 100, points: [{ x: 0.5, y: 0.5 }], ...extra });
const movedPhoto = (original, name, extra = {}) => ({ ...original, ...ids(name), image: undefined, objectId: original.opId, points: [{ x: 0.3, y: 0.3 }], ...extra });
const documentWith = (ops, span) => ({ schemaVersion: 1, rendererVersion: 1, size: 1024, ...(span ? { span } : {}), ops });

test("a photo is stored once, and moving it never copies the picture again", () => {
  const first = photo("first");
  const moved = movedPhoto(first, "moved");
  const saved = validateDrawDocument(documentWith([first, moved]));
  assert.equal(saved?.ops[0].image, first.image);
  assert.equal("image" in saved.ops[1], false, "옮긴 동작에는 사진 글자가 실리지 않는다");
  // 그릴 때는 마지막 자리에, 처음 넣은 사진으로 그린다.
  const visible = visibleDrawOperations(saved.ops);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].image, first.image);
  assert.deepEqual(visible[0].points, [{ x: 0.3, y: 0.3 }]);
  assert.equal(movableDrawObjects(saved.ops).length, 1);
  // 옮긴 동작에 사진을 다시 실으면 저장을 거부한다(옮길 때마다 수백 KB가 쌓인다).
  assert.equal(validateDrawDocument(documentWith([first, { ...moved, image: first.image }])), null);
  // 처음 넣는 동작에는 사진이 꼭 있어야 한다.
  assert.equal(validateDrawDocument(documentWith([photo("empty", { image: undefined })])), null);
});

test("only small JPEG data URLs are accepted as photos", () => {
  const bad = [
    "data:image/png;base64,iVBORw0KGgo=",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "https://example.com/a.jpg",
    `${IMAGE_DATA_PREFIX}AAAA`,
    `${jpeg()}"><script>`,
    `${jpeg()} `,
    jpeg("A", IMAGE_MAX_CHARS),
    { blob: "z" },
    42,
  ];
  for (const image of bad) assert.equal(validateDrawDocument(documentWith([photo("bad", { image })])), null, String(image).slice(0, 40));
  assert.ok(validateDrawDocument(documentWith([photo("ok", { image: `${jpeg()}==` })])));
  // 너비·비율·점도 범위를 본다.
  for (const extra of [{ width: 5 }, { width: 2000 }, { width: "100" }, { aspect: 0 }, { aspect: 50 }, { aspect: undefined }, { points: [] }, { points: [{ x: 2, y: 0 }] }]) {
    assert.equal(validateDrawDocument(documentWith([photo("bad", extra)])), null, JSON.stringify(extra));
  }
  // 한 그림에 넣을 수 있는 사진 수.
  const many = Array.from({ length: MAX_IMAGE_PAYLOADS + 1 }, (_, index) => photo(`many${index}`));
  assert.ok(validateDrawDocument(documentWith(many.slice(0, MAX_IMAGE_PAYLOADS))));
  assert.equal(validateDrawDocument(documentWith(many)), null);
  // 다른 종류의 동작에 실린 사진은 남지 않는다.
  const stroke = { ...ids("line"), type: "stroke", tool: "pencil", color: "#1B3A57", width: 8, points: [{ x: 0.1, y: 0.1 }], image: jpeg() };
  assert.equal(validateDrawDocument(documentWith([stroke]))?.ops[0].image, undefined);
});

test("photo size, crop box and byte estimate follow the stored width and ratio", () => {
  const box = drawObjectBounds(photo("box", { width: 204.8, aspect: 0.5 }), 1024);
  assert.ok(Math.abs(box.width - 0.2) < 1e-9 && Math.abs(box.height - 0.1) < 1e-9 && Math.abs(box.x - 0.4) < 1e-9 && Math.abs(box.y - 0.45) < 1e-9);
  // 잘라 낼 칸은 사진 상자에 작은 여백만 붙는다 — 사진 너비만큼 사방을 넓히지 않는다.
  const crop = contentBounds(documentWith([photo("crop", { width: 204.8, aspect: 0.5 })]));
  assert.ok(crop.width < 0.25 && crop.height < 0.15, JSON.stringify(crop));
  for (const span of [1, 3]) {
    const start = photo("size", { width: toDocumentUnits(320, span) });
    assert.equal(scaleDrawObject(start, 0.001, span).width, toDocumentUnits(80, span));
    assert.ok(scaleDrawObject(start, 1000, span).width <= 1024);
    assert.ok(validateDrawDocument({ ...documentWith([{ ...start, ...scaleDrawObject(start, 1000, span) }]), span }));
    assert.ok(validateDrawDocument({ ...documentWith([{ ...start, ...scaleDrawObject(start, 0.001, span) }]), span }));
  }
  const big = documentWith([photo("big", { image: jpeg("A", 150_000) })]);
  assert.ok(estimateDocumentBytes(big) >= JSON.stringify(big).length);
});
