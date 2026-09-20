/**
 * 선생님 표시와 손들기 (2026-09-14 사용자 결정, product-decisions 교사와 메시지 5항).
 *
 * 선생님은 그리는 중인 아이 그림 위에 손으로 동그라미·화살표를 그리고 짧은 말을 붙여 보낸다.
 * 표시는 점선·시범처럼 아이 원본과 **따로 된 층**이다 — 작품 ops에 넣지 않고 저장 그림에 합성하지 않는다.
 * 아이는 큰 버튼("알겠어요"/"잘 모르겠어요")으로만 답한다. 글자를 치게 하지 않는다.
 *
 * 좌표는 그림 문서 기준 0~1이다(가로는 1024, 세로는 문서 높이에 곱한다). 그래서 선생님 화면 크기와
 * 아이 화면 크기·확대 상태가 달라도 같은 자리에 겹친다.
 */

export const MARK_MAX_STROKES = 30;
export const MARK_MAX_POINTS_PER_STROKE = 400;
export const MARK_MAX_POINTS = 3000;
export const MARK_NOTE_MAX = 40;
/** 아이가 든 손은 이 시간이 지나면 선생님 화면에서 내려간다(자리를 떠났거나 잊은 손). */
export const HAND_RAISE_TTL_MS = 10 * 60 * 1000;

export type MarkPoint = [number, number];
export type MarkStroke = MarkPoint[];
export type MarkAnswer = "ok" | "unsure";

const round = (value: number) => Math.round(value * 10000) / 10000;

/** 선생님이 보낸 획을 검사한다. 형식이 하나라도 어긋나면 고치지 않고 null(추측해서 받지 않는다). */
export function validateMarkStrokes(value: unknown): MarkStroke[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MARK_MAX_STROKES) return null;
  let total = 0;
  const strokes: MarkStroke[] = [];
  for (const rawStroke of value) {
    if (!Array.isArray(rawStroke) || rawStroke.length < 1 || rawStroke.length > MARK_MAX_POINTS_PER_STROKE) return null;
    total += rawStroke.length;
    if (total > MARK_MAX_POINTS) return null;
    const stroke: MarkStroke = [];
    for (const rawPoint of rawStroke) {
      if (!Array.isArray(rawPoint) || rawPoint.length !== 2) return null;
      const [x, y] = rawPoint;
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
      stroke.push([round(x), round(y)]);
    }
    strokes.push(stroke);
  }
  return strokes;
}

export function isMarkAnswer(value: unknown): value is MarkAnswer {
  return value === "ok" || value === "unsure";
}

export const MARK_ANSWER_LABEL: Record<MarkAnswer | "replaced" | "cleared", string> = {
  ok: "👍 알겠어요",
  unsure: "🤔 잘 모르겠어요",
  replaced: "새 표시로 바뀜",
  cleared: "선생님이 거둠",
};

/** 표시 획 색·굵기. 아이 그림 색과 헷갈리지 않게 한 가지 주황만 쓴다(문서 1024 기준 굵기). */
export const MARK_COLOR = "#ff6a2b";
export const MARK_WIDTH = 10;

/** 선생님·아이 화면이 같은 모양으로 그리도록 한곳에 둔다. 캔버스 크기는 문서 크기(1024×높이)다. */
/* unitScale: 넓은 도화지(DrawDocument.span)에서는 화면에 같은 굵기로 보이도록 도화지 단위 굵기를 span배로 그린다. */
export function drawMarkStrokes(context: CanvasRenderingContext2D, strokes: readonly MarkStroke[], width: number, height: number, alpha = 0.9, unitScale = 1) {
  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = MARK_COLOR;
  context.fillStyle = MARK_COLOR;
  context.lineWidth = MARK_WIDTH * unitScale * width / 1024;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of strokes) {
    if (stroke.length === 1) {
      context.beginPath();
      context.arc(stroke[0][0] * width, stroke[0][1] * height, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    context.beginPath();
    context.moveTo(stroke[0][0] * width, stroke[0][1] * height);
    for (const [x, y] of stroke.slice(1)) context.lineTo(x * width, y * height);
    context.stroke();
  }
  context.restore();
}
