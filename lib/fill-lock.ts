// 채우기는 저장된 픽셀이 아니라 "그 자리에서 번지기"라 다시 그릴 때마다 계산된다. 그래서 채우기의 색이
// 닿아 있는 도형·스티커를 옮기면 번지는 모양이 달라진다 — 동그라미 안을 채운 뒤 동그라미를 옮기면
// 막아 주던 선이 사라져 색이 도화지 전체로 번진다. 그런 물건만 골라 잠근다.
// 확장자 포함 상대 임포트: node --test가 lib을 직접 로드한다.
import { computeFloodFillMask, sampleRgb } from "./flood-fill.ts";
import { drawObjectKey, visibleDrawOperations } from "./drawing-model.ts";
import type { DrawOp } from "./drawing-model.ts";

/** 잠금 계산이 그림을 다시 그려 보는 판. 화면에서는 캔버스, 테스트에서는 픽셀 배열이다. */
export type LockRaster = {
  width: number;
  height: number;
  /** 동작 하나를 판에 그린다(채우기 포함). */
  draw(op: DrawOp): void;
  /** 판 전체의 RGBA. */
  read(): Uint8ClampedArray;
  /** 이 물건이 칠하는 칸의 번호(y * width + x). */
  footprint(op: DrawOp): ArrayLike<number>;
};

function touches(mask: Uint8Array, width: number, cells: ArrayLike<number>) {
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    // 색이 물건 바로 옆 칸까지만 와도 닿은 것이다(물건이 그 색을 막고 있다).
    if (mask[cell] || mask[cell - 1] || mask[cell + 1] || mask[cell - width] || mask[cell + width]) return true;
  }
  return false;
}

/** 채우기의 색이 닿아 있어 옮기면 안 되는 도형·스티커의 이름들. */
export function fillLockedObjectKeys(ops: readonly DrawOp[], raster: LockRaster) {
  const locked = new Set<string>();
  const drawn: Array<{ key: string; cells: ArrayLike<number> }> = [];
  for (const op of visibleDrawOperations(ops)) {
    if (op.type === "fill") {
      const seed = op.points?.[0];
      if (seed && drawn.some((item) => !locked.has(item.key))) {
        const pixels = raster.read();
        const x = Math.max(0, Math.min(raster.width - 1, Math.round(seed.x * (raster.width - 1))));
        const y = Math.max(0, Math.min(raster.height - 1, Math.round(seed.y * (raster.height - 1))));
        const mask = computeFloodFillMask(pixels, raster.width, x, y, sampleRgb(pixels, raster.width, x, y), { height: raster.height });
        for (const item of drawn) if (!locked.has(item.key) && touches(mask, raster.width, item.cells)) locked.add(item.key);
      }
    } else if (op.type === "shape" || op.type === "sticker" || op.type === "image") {
      const key = drawObjectKey(op);
      if (key) drawn.push({ key, cells: raster.footprint(op) });
    }
    raster.draw(op);
  }
  return locked;
}
