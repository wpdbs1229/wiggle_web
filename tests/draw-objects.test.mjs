import assert from "node:assert/strict";
import test from "node:test";
import { drawObjectBounds, drawObjectKey, movableDrawObjects, shiftDrawPoints, validateDrawDocument, visibleDrawOperations } from "../lib/drawing-model.ts";
import { mirrorOp } from "../lib/symmetry.ts";
import { fillLockedObjectKeys } from "../lib/fill-lock.ts";
import { computeFloodFillMask, paintFloodFillMask, sampleRgb } from "../lib/flood-fill.ts";

const at = "2026-10-11T01:00:00.000Z";
const ids = (name) => ({ opId: `op_${name}`.padEnd(12, "0"), clientOpId: `client_${name}`.padEnd(14, "0"), at });
const shape = (name, x = 0.2, extra = {}) => ({ ...ids(name), type: "shape", shape: "circle", color: "#E53935", width: 8, points: [{ x, y: 0.2 }, { x: x + 0.2, y: 0.4 }], ...extra });
const sticker = (name, extra = {}) => ({ ...ids(name), type: "sticker", sticker: "heart", points: [{ x: 0.5, y: 0.5 }], ...extra });
const fill = (name) => ({ ...ids(name), type: "fill", color: "#1E88E5", points: [{ x: 0.3, y: 0.3 }] });
const stroke = (name) => ({ ...ids(name), type: "stroke", tool: "pencil", color: "#1B3A57", width: 8, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] });
const documentWith = (ops) => ({ schemaVersion: 1, rendererVersion: 1, size: 1024, ops });
// 옮긴 동작은 처음 동작의 opId를 objectId로 들고 전체 상태를 새로 덧붙인다.
const moved = (original, name, dx, extra = {}) => ({ ...original, ...ids(name), objectId: original.objectId ?? original.opId, points: shiftDrawPoints(original.points, dx, 0), ...extra });

test("moving a shape or sticker shows only its latest state, and undo brings the old place back", () => {
  const circle = shape("circle");
  const heart = sticker("heart");
  const circleMoved = moved(circle, "circlemove", 0.3);
  const ops = [circle, stroke("line"), heart, circleMoved];
  const visible = visibleDrawOperations(ops);
  assert.deepEqual(visible.map((op) => op.opId), [ops[1].opId, heart.opId, circleMoved.opId]);
  assert.equal(visible.at(-1).points[0].x, 0.5);
  // 되돌리기는 마지막 동작을 떼어 낼 뿐이다 — 그러면 예전 자리가 다시 보인다.
  assert.deepEqual(visibleDrawOperations(ops.slice(0, -1)).map((op) => op.opId), [circle.opId, ops[1].opId, heart.opId]);
  // 타임랩스는 limit까지만 본다.
  assert.equal(visibleDrawOperations(ops, 1)[0].opId, circle.opId);
  // 지운 동작은 물건을 숨긴다.
  assert.equal(visibleDrawOperations([...ops, moved(heart, "heartgone", 0, { deleted: true })]).some((op) => op.type === "sticker"), false);
});

// 화면의 캔버스 대신 쓰는 40×40 판. 네모 도형은 1칸 테두리(색 채움이면 속까지), 스티커는 3×3 덩어리로 그린다.
function gridRaster(size = 40) {
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  const rgb = (hex) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  const cellsOf = (op) => {
    const cells = [];
    if (op.type === "sticker") {
      const cx = Math.round(op.points[0].x * (size - 1)), cy = Math.round(op.points[0].y * (size - 1));
      for (let y = cy - 1; y <= cy + 1; y += 1) for (let x = cx - 1; x <= cx + 1; x += 1) cells.push(y * size + x);
    }
    if (op.type === "shape") {
      const [x0, x1] = op.points.map((point) => Math.round(point.x * (size - 1))).sort((a, b) => a - b);
      const [y0, y1] = op.points.map((point) => Math.round(point.y * (size - 1))).sort((a, b) => a - b);
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if (op.filled || x === x0 || x === x1 || y === y0 || y === y1) cells.push(y * size + x);
    }
    return cells;
  };
  const paint = (cells, color) => { for (const cell of cells) pixels.set(color, cell * 4); };
  return {
    width: size, height: size, pixels,
    read: () => pixels,
    footprint: cellsOf,
    draw(op) {
      if (op.type !== "fill") { paint(cellsOf(op), rgb(op.color ?? "#E53935")); return; }
      const x = Math.round(op.points[0].x * (size - 1)), y = Math.round(op.points[0].y * (size - 1));
      const mask = computeFloodFillMask(pixels, size, x, y, sampleRgb(pixels, size, x, y), { height: size });
      paintFloodFillMask(pixels, mask, rgb(op.color));
    },
  };
}
const box = (name, x, y, extra = {}) => shape(name, x, { shape: "rectangle", points: [{ x, y }, { x: x + 0.2, y: y + 0.2 }], ...extra });
const fillAt = (name, x, y) => ({ ...fill(name), points: [{ x, y }] });
const lockedNames = (ops) => [...fillLockedObjectKeys(ops, gridRaster())].sort();

test("only the objects a fill's colour touches are locked", () => {
  const inside = box("inside", 0.1, 0.1);
  const far = box("far", 0.6, 0.6);
  const heart = sticker("heart", { points: [{ x: 0.8, y: 0.2 }] });
  // 네모 안을 채웠다. 네모를 옮기면 색이 도화지 전체로 번지므로 네모만 잠근다 — 멀리 있는 것은 그대로 옮길 수 있다.
  const ops = [inside, far, heart, fillAt("fillin", 0.2, 0.2)];
  assert.deepEqual(lockedNames(ops), [drawObjectKey(inside)]);
  assert.deepEqual(movableDrawObjects(ops, fillLockedObjectKeys(ops, gridRaster())).map((op) => op.opId), [far.opId, heart.opId]);
  // 바탕을 채우면 그 색이 닿는 것이 모두 잠긴다.
  assert.deepEqual(lockedNames([inside, far, heart, fillAt("fillbg", 0.5, 0.5)]), [drawObjectKey(far), drawObjectKey(heart), drawObjectKey(inside)].sort());
  // 채우기 뒤에 그린 것은 그 채우기와 상관없다.
  assert.deepEqual(lockedNames([inside, fillAt("fillin", 0.2, 0.2), far]), [drawObjectKey(inside)]);
  // 채우기 뒤로 옮겨 온 것도 마찬가지다 — 옮긴 동작이 채우기보다 뒤에 그려진다.
  assert.deepEqual(lockedNames([far, fillAt("fillin", 0.2, 0.2), moved(far, "farmove", 0.05)]), []);
  // 채우기를 되돌리면 잠금도 풀린다.
  assert.deepEqual(lockedNames([inside, far]), []);
  // 색으로 꽉 찬 네모 속을 다른 색으로 바꿔도 그 네모가 잠긴다(옮기면 채우기가 바탕으로 번진다).
  const solid = box("solid", 0.4, 0.1, { filled: true });
  assert.deepEqual(lockedNames([solid, far, fillAt("recolor", 0.5, 0.2)]), [drawObjectKey(solid)]);
});

test("a mirrored pair is two separate objects, and old shapes without an objectId can still be picked", () => {
  const original = shape("pair");
  const mirror = mirrorOp(original);
  assert.notEqual(drawObjectKey(original), drawObjectKey(mirror));
  assert.equal(visibleDrawOperations([original, mirror, moved(original, "pairmove", 0.1)]).length, 2);
  assert.equal(drawObjectKey(moved(original, "again", 0.1)), drawObjectKey(original));
});

test("a moved object never leaves the paper", () => {
  assert.deepEqual(shiftDrawPoints([{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }], 5, -5), [{ x: 0.8, y: 0 }, { x: 1, y: 0.2 }]);
  const box = drawObjectBounds(sticker("box", { fontSize: 102.4 }), 1024);
  assert.ok(Math.abs(box.width - 0.1) < 1e-9 && Math.abs(box.x - 0.45) < 1e-9);
});

test("the server keeps move and delete records for shapes and stickers, and rejects malformed ones", () => {
  const circle = shape("circle");
  const saved = validateDrawDocument(documentWith([circle, moved(circle, "move", 0.1), moved(sticker("heart"), "gone", 0, { deleted: true })]));
  assert.equal(saved?.ops[1].objectId, circle.opId);
  assert.equal(saved?.ops[2].deleted, true);
  assert.equal(validateDrawDocument(documentWith([shape("bad", 0.2, { objectId: "x" })])), null);
  assert.equal(validateDrawDocument(documentWith([shape("bad", 0.2, { objectId: { blob: "z".repeat(5000) } })])), null);
  assert.equal(validateDrawDocument(documentWith([sticker("bad", { deleted: "yes" })])), null);
  // 획에 실린 objectId는 남지 않는다.
  assert.equal(validateDrawDocument(documentWith([{ ...stroke("line"), objectId: circle.opId }]))?.ops[0].objectId, undefined);
});

test("resizing keeps the centre, the paper edge, and a size a finger can still hit", async () => {
  const { scaleDrawObject, STICKER_SCREEN_MAX, STICKER_SCREEN_MIN, toDocumentUnits } = await import("../lib/drawing-model.ts");
  // 도형: 가운데는 그대로, 두 점이 배율만큼 벌어진다.
  assert.deepEqual(scaleDrawObject(shape("circle", 0.4), 1.5, 3).points, [{ x: 0.35, y: 0.15 }, { x: 0.65, y: 0.45 }]);
  // 도화지 가장자리에 닿으면 거기서 멈춘다(위쪽 0.2가 먼저 닿는다 — 가운데 y 0.3, 반높이 0.1 → 최대 3배).
  const huge = scaleDrawObject(shape("circle", 0.4), 50, 3).points;
  assert.ok(huge.every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1));
  assert.equal(huge[0].y, 0);
  // 아주 작게 줄여도 다시 누를 수 있는 크기는 남는다.
  const tiny = scaleDrawObject(shape("circle", 0.4), 0.0001, 3).points;
  assert.ok(Math.hypot(tiny[0].x - tiny[1].x, tiny[0].y - tiny[1].y) >= 0.029);
  // 스티커: 화면 기준 범위 안에서만 바뀌고, 그 값은 서버 검증을 통과한다.
  for (const span of [1, 2, 3]) {
    const start = sticker("heart", { fontSize: toDocumentUnits(140, span) });
    // 저장 값은 소수 둘째 자리로 반올림돼 있어 두 배가 0.01만큼 어긋날 수 있다.
    assert.ok(Math.abs(scaleDrawObject(start, 2, span).fontSize - toDocumentUnits(280, span)) <= 0.011);
    for (const factor of [0.001, 1000]) {
      const size = scaleDrawObject(start, factor, span).fontSize;
      assert.equal(size, toDocumentUnits(factor < 1 ? STICKER_SCREEN_MIN : STICKER_SCREEN_MAX, span));
      assert.ok(validateDrawDocument({ ...documentWith([{ ...start, fontSize: size }]), span }), `span ${span} size ${size}`);
    }
  }
  assert.deepEqual(scaleDrawObject(shape("circle"), Number.NaN, 1), {});
});
