import { DOCUMENT_SIZE, documentHeight, drawObjectBounds, type DrawDocument, type DrawOp } from "@/lib/drawing-model";
import { renderDrawOperation, resetDrawingCanvas } from "@/lib/draw-renderer";
import { fillLockedObjectKeys, type LockRaster } from "@/lib/fill-lock";

const NONE: ReadonlySet<string> = new Set();
// 같은 그림 상태에서는 한 번만 계산한다(동작 배열은 편집마다 새로 만들어진다).
const cache = new WeakMap<readonly DrawOp[], ReadonlySet<string>>();

/** 지금 그림에서 채우기 때문에 잠긴 도형·스티커. 채우기나 물건이 없으면 그리지 않고 끝낸다.
 *  ponytail: 가로 1024로 통째로 다시 그려 본다. 동작이 수천 개인 그림에서 옮기기가 굼뜨면
 *  마지막 계산 지점까지의 판을 남겨 두고 이어 그리는 쪽으로 바꾼다. */
export function lockedObjectKeys(document: DrawDocument): ReadonlySet<string> {
  const ops = document.ops;
  const cached = cache.get(ops);
  if (cached) return cached;
  let result = NONE;
  if (ops.some((op) => op.type === "fill") && ops.some((op) => op.type === "shape" || op.type === "sticker")) {
    const width = DOCUMENT_SIZE, height = documentHeight(document);
    const size = { width, height };
    const canvas = Object.assign(window.document.createElement("canvas"), size);
    const scratch = Object.assign(window.document.createElement("canvas"), size);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const scratchContext = scratch.getContext("2d", { willReadFrequently: true });
    if (context && scratchContext) {
      resetDrawingCanvas(context, size);
      const raster: LockRaster = {
        width, height,
        draw: (op) => renderDrawOperation(context, op, size),
        read: () => context.getImageData(0, 0, width, height).data,
        footprint: (op) => {
          const box = drawObjectBounds(op, height);
          if (!box) return [];
          const left = Math.max(0, Math.floor(box.x * width) - 2), top = Math.max(0, Math.floor(box.y * height) - 2);
          const right = Math.min(width, Math.ceil((box.x + box.width) * width) + 2), bottom = Math.min(height, Math.ceil((box.y + box.height) * height) + 2);
          if (right <= left || bottom <= top) return [];
          scratchContext.clearRect(left, top, right - left, bottom - top);
          renderDrawOperation(scratchContext, op, size);
          const alpha = scratchContext.getImageData(left, top, right - left, bottom - top).data;
          scratchContext.clearRect(0, 0, width, height);
          const cells: number[] = [];
          for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) if (alpha[((y - top) * (right - left) + (x - left)) * 4 + 3] > 32) cells.push(y * width + x);
          return cells;
        },
      };
      result = fillLockedObjectKeys(ops, raster);
    }
  }
  cache.set(ops, result);
  return result;
}
