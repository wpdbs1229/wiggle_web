import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const compactSource = (text) => text.replace(/\s+/g, " ");

const [studio, css, renderer, messageCenter, drawingHistory, inputMode] = await Promise.all([
  readFile(new URL("../app/components/DrawingStudio.tsx", import.meta.url), "utf8").then(compactSource),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../lib/draw-renderer.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/StudentMessageCenter.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/drawing-history.ts", import.meta.url), "utf8").then(compactSource),
  readFile(new URL("../lib/input-mode.ts", import.meta.url), "utf8").then(compactSource),
]);

test("draw width and eraser width are remembered separately", () => {
  // 지우개를 한 번 썼다고 아이가 고른 그리기 굵기가 리셋되면 안 된다.
  assert.match(studio, /const \[drawWidth, setDrawWidth\] = useState<StrokeWidth>\(16\)/);
  assert.match(studio, /const \[eraserWidth, setEraserWidth\] = useState<StrokeWidth>\(48\)/);
  assert.match(studio, /const width = studioTool === "eraser" \? eraserWidth : drawWidth/);
  assert.match(studio, /if \(studioTool === "eraser"\) setEraserWidth\(value\);\s*else \{ drawWidthRef\.current = value; setDrawWidth\(value\); \}/);
});

test("coloring starts broad without locking the child's width choice", () => {
  assert.match(studio, /currentLessonActivity === "color"[\s\S]*setStudioTool\("crayon"\)[\s\S]*setDrawWidth\(48\)/);
  assert.match(studio, /else \{ drawWidthRef\.current = value; setDrawWidth\(value\); \}/);
  assert.match(studio, /\}, \[currentLessonActivity\]\);/);
  assert.match(studio, /lastBrushRef\.current = colorReturnBrushRef\.current;\s*setStudioTool\(colorReturnBrushRef\.current\)/);
});

test("every studio tool is reachable from the panel", () => {
  // 2026-09-14 도구 막대(B안): 붓 4종·지우개는 DOCK_TOOLS 한 목록에서 그리고, 채우기·도형은 ⋯ 더보기 안에 있다.
  for (const tool of ["pencil", "crayon", "marker", "watercolor", "eraser"]) assert.match(studio, new RegExp(`\\{ id: "${tool}", label: "`));
  assert.match(studio, /DOCK_TOOLS\.map\(\(tool\) => \([\s\S]*?onClick=\{\(\) => chooseStudioTool\(tool\.id\)\}/);
  for (const tool of ["fill", "shape"]) assert.match(studio, new RegExp(`onClick=\\{\\(\\) => chooseStudioTool\\("${tool}"\\)\\}`));
  assert.match(studio, /aria-pressed=\{mirror\}/);
  assert.match(studio, /SHAPE_KINDS\.slice/);
});

test("new pencil strokes get pressure widths while legacy pen strokes render unchanged", () => {
  // 기존 작품(pen)에는 실필압이 이미 기록돼 있다. pen에 배율을 적용하면 저장 이미지와 어긋난다.
  assert.match(renderer, /op\.tool === "pencil" && points\.length > 1/);
  assert.doesNotMatch(renderer, /op\.tool === "pen" && points\.length > 1/);
  assert.match(studio, /type BrushTool = "pencil" \| "crayon" \| "marker" \| "watercolor"/);
});

test("all tools have recognizable visual icons and child-readable size labels", () => {
  // 세워진 도구 그림(public/drawing-tools/dock/)과 붓 끝·띠 칠하기 틀. 뜻은 aria-label·title로 전한다.
  assert.match(studio, /\{ id: "pencil", label: "연필", tint: true \}/);
  assert.match(studio, /\{ id: "crayon", label: "크레용", tint: true \}/);
  assert.match(studio, /\{ id: "marker", label: "마커", tint: true \}/);
  assert.match(studio, /\{ id: "watercolor", label: "수채붓", tint: true \}/);
  assert.match(studio, /\{ id: "eraser", label: "지우개", tint: false \}/);
  assert.match(studio, /aria-label=\{tool\.label\} title=\{tool\.label\}/);
  assert.match(studio, /src=\{`\/drawing-tools\/dock\/\$\{tool\.id\}\.webp`\}/);
  assert.match(studio, /maskImage: `url\(\/drawing-tools\/dock\/\$\{tool\.id\}-tint\.webp\)`/);
  assert.match(studio, /aria-label="좌우 대칭" title="좌우 대칭"/);
  // 굵기는 5단 버튼이 아니라 1픽셀 단위로 끄는 슬라이더다.
  // 화면에서 고르는 값은 1~60픽셀이고, 저장은 도화지 단위다(넓은 도화지는 span배).
  assert.match(studio, /<input type="range" min=\{STROKE_WIDTH_MIN\} max=\{STROKE_WIDTH_SCREEN_MAX\} step=\{1\} value=\{width\} aria-label="선 굵기"/);
  assert.match(studio, /const documentWidthUnits = \(screenWidth: number\) => toDocumentUnits\(screenWidth, documentSpan\(documentStateRef\.current\)\);/);
  assert.match(studio, /aria-label="1픽셀 얇게"[\s\S]*aria-label="1픽셀 굵게"/);
  assert.doesNotMatch(studio, /STROKE_WIDTH_LABELS|STROKE_WIDTHS/);
  assert.match(css, /\.dock-tool-tint \{[^}]*var\(--dock-color/);
  assert.match(css, /\.dock-tool\[aria-pressed="true"\] \{ background:#184028; \}/);
  assert.match(studio, /"#E53935": "빨간색"/);
  assert.match(studio, /"#F8A9A4": "밝은 빨간색"/);
  assert.match(studio, /aria-label=\{COLOR_NAMES\[value\]\}/);
});

test("palette shows every basic color without scrolling and the rainbow button opens a detailed picker", async () => {
  assert.doesNotMatch(studio, /colorsExpanded|MORE_PALETTE/);
  assert.match(studio, /import \{ ColorPickerDialog \} from "\.\/ColorPickerDialog"/);
  // 막대에는 자주 쓰는 8색 + 무지개. 무지개는 12색 창(스크롤 없음)을 열고, 거기서 색 더보기가 상세 고르기 대화상자를 연다.
  assert.match(studio, /const DOCK_QUICK_COLORS = 8;/);
  assert.match(studio, /className="dock-more-colors"[^>]*aria-haspopup="true"/);
  assert.match(studio, /<div className="dock-palette" role="group" aria-label="모든 색">\s*\{PALETTE\.map/);
  assert.match(studio, /className="dock-palette-wheel" aria-haspopup="dialog"[\s\S]*?setColorPickerOpen\(true\)/);
  assert.match(studio, /<ColorPickerDialog color=\{selectedColor\} names=\{COLOR_NAMES\}/);
  assert.match(css, /\.dock-color,\.dock-current-color,\.dock-more-colors \{[^}]*min-width:44px; min-height:44px;/);
  assert.match(css, /\.dock-palette \{[^}]*grid-template-columns:repeat\(4,48px\)/);
  const { hexToHsv, hsvToHex } = await import("../lib/color.ts");
  for (const hex of ["#1B3A57", "#E53935", "#FFFFFF", "#000000", "#43A047", "#F8BBD0"]) assert.equal(hsvToHex(...hexToHsv(hex)), hex);
  assert.deepEqual(hexToHsv("#FF0000"), [0, 1, 1]);
  assert.equal(hsvToHex(120, 1, 1), "#00FF00");
});

test("strokes render during pointer input instead of waiting for pointer up", () => {
  assert.match(studio, /function renderLiveStroke\(/);
  // 획 도중 다른 손이 도구를 바꿔도 그리던 획은 시작 시점(meta)의 도구·색·굵기를 유지한다.
  // 일반 그리기는 first, 점선 연습은 자석으로 맞춘 strokeStart를 즉시 미리보기 한다.
  assert.match(studio, /function pointerDown[\s\S]*let strokeStart = first;[\s\S]*renderLiveStroke\(event\.currentTarget, meta\.tool, meta\.color, meta\.width, \[strokeStart\]\)/);
  assert.match(studio, /function pointerMove[\s\S]*points\.push\(next\);[\s\S]*const livePoints = points\.slice\(-3\);[\s\S]*renderLiveStroke\(event\.currentTarget, meta\.tool, meta\.color, meta\.width, livePoints\)/);
  assert.ok(studio.indexOf("renderLiveStroke(event.currentTarget, meta.tool, meta.color, meta.width, livePoints)") < studio.indexOf("function pointerUp"));
  // 반투명 브러시(크레용·수채)는 스냅숏 복원 후 전체를 한 번에 그린다 — 세그먼트 알파 중첩 방지.
  assert.match(studio, /meta\.tool === "crayon" \|\| meta\.tool === "watercolor"/);
  assert.match(studio, /context\.putImageData\(strokeSnapshotRef\.current, 0, 0\)/);
});

test("mirror mode commits the pair together and undo removes it together", () => {
  assert.match(studio, /commitOps\(mirror \? \[op, mirrorOp\(op\)\] : \[op\]\)/);
  // 대칭이 켜지면 같은 획이 두 벌 저장되므로 스트로크 예산을 벌 수로 나눈다.
  assert.match(studio, /fitStrokePoints\(points, mirror \? 2 : 1\)/);
  assert.match(drawingHistory, /undoGroupSize\(history\.document\.ops\)/);
  assert.match(studio, /undoDrawing\(\{\s*document: documentStateRef\.current,\s*redo: redoRef\.current,\s*clearedOps: clearedOpsRef\.current,\s*clearRedoReady: clearRedoReadyRef\.current,\s*\}\)/);
  assert.match(studio, /const \[redo, setRedo\] = useState<DrawOp\[\]\[\]>\(\[\]\)/);
  // 채우기도 대칭 쌍으로 커밋된다 — commitFill 본문이 mirror를 분기해야 한다.
  assert.match(studio, /function commitFill[\s\S]{0,400}commitOps\(mirror \? \[op, mirrorOp\(op\)\] : \[op\]\)/);
});

test("shape tool supports drag and the two-tap fallback without touching canvas pixels", () => {
  assert.match(studio, /shapeStartRef\.current = drag\.origin; setShapeStartPoint\(drag\.origin\)/);
  assert.match(studio, /🟢 끝나는 곳을 콕 눌러 줘!/);
  // 시작점 표식은 캔버스 픽셀이 아니라 DOM 점이다 — 픽셀에 그리면 썸네일·완성 PNG에 섞인다.
  assert.match(studio, /className="shape-start-dot"/);
  assert.doesNotMatch(studio, /drawShapeStartDot/);
  // 점 하나 크기의 실수 탭은 도형으로 커밋하지 않는다.
  assert.match(studio, /Math\.hypot\(end\.x - start\.x, end\.y - start\.y\)\s*<\s*0\.012/);
  // 문서가 바뀌면(undo/redo) 대기 중인 시작점을 지운다.
  assert.match(studio, /function undo\(\)[\s\S]{0,900}clearShapeStart\(\)/);
  assert.match(studio, /function redoLast\(\)[\s\S]{0,700}clearShapeStart\(\)/);
});

test("saved images render from the document, never from live canvas pixels", () => {
  assert.match(studio, /function documentImage\(/);
  assert.match(studio, /thumbnailDataUrl: documentImage\(/);
  assert.doesNotMatch(studio, /thumbnailDataUrl: imageData\(/);
});

test("pen mode keeps touch from drawing, is reversible, and two fingers zoom", () => {
  assert.match(studio, /if \(event\.pointerType === "pen"\) enablePenMode\(\)/);
  assert.match(studio, /if \(penModeRef\.current\) \{ startGestureTouch\(event\); return; \}/);
  // 펜 없는 기기: 두 번째 손가락이 오면 기존 손가락을 제스처로 승격해야 핀치가 실제로 시작된다.
  assert.match(studio, /promoteEngagedToGesture\(event\.currentTarget\); startGestureTouch\(event\); return;/);
  assert.match(studio, /gestureTouches\.current\.set\(pointerId, last\)/);
  assert.match(studio, /pinchView\(viewRef\.current/);
  // 손가락 모드는 현재 작품에서만 명시적으로 켜고, 다음 학생·작품은 다시 펜으로 시작한다.
  assert.match(studio, /penModeRef\.current = true;\s*setInputMode\("pen"\)/);
  assert.match(studio, /onClick=\{disablePenMode\}/);
  assert.doesNotMatch(studio, /setItem\(INPUT_MODE_STORAGE_KEY, "finger"\)/);
  assert.match(inputMode, /if \(pointerType === "touch"\) return mode === "finger"/);
  assert.match(inputMode, /return "pen"/);
  assert.match(css, /\.canvas-stack \{ position:absolute; inset:0; transform-origin:0 0; \}/);
});

test("teacher message banner can be dismissed but every message remains in history", () => {
  assert.match(studio, /<StudentMessageCenter messages=\{teacherMessages\} floating/);
  assert.match(messageCenter, /className="canvas-message-close"/);
  assert.match(messageCenter, /action: "ackTeacherMessages"/);
  assert.match(messageCenter, /unread\.map\(\(message\) => message\.id\)/);
  assert.match(messageCenter, /aria-label="새 선생님 말씀 모두 닫기"/);
  assert.match(messageCenter, /닫아도 여기에서 다시 볼 수 있어요/);
  assert.match(messageCenter, /\[\.\.\.messages\]\.reverse\(\)\.map/);
  assert.doesNotMatch(messageCenter, /sessionStorage/);
  assert.match(css, /\.canvas-message-close \{ width:44px; min-width:44px; height:44px;/);
});

test("marker and watercolor render distinctly from pencil", () => {
  // 마커는 가장 넓고 불투명, 수채붓은 옅고 넓게 + 번짐 패스. (기존 크레용·pen 값은 불변)
  assert.match(renderer, /op\.tool === "marker" \? 1\.6 : op\.tool === "watercolor" \? 2 : 1/);
  assert.match(renderer, /op\.tool === "crayon" \? 0\.62 : op\.tool === "watercolor" \? 0\.3 : 1/);
  assert.match(renderer, /if \(op\.tool === "watercolor"\) \{[\s\S]{0,300}globalAlpha = 0\.12/);
});

test("eraser footprint matches the square area removed from the document", () => {
  assert.match(studio, /className="eraser-footprint"/);
  assert.match(studio, /footprint\.style\.width = `\$\{eraserWidth \/ 10\.24\}%`/);
  assert.match(studio, /footprint\.style\.height = "auto"/);
  assert.match(css, /\.eraser-footprint \{ aspect-ratio:1; \}/);
  assert.match(renderer, /function eraseWithSquareFootprint/);
  assert.match(renderer, /globalCompositeOperation = "destination-out"/);
  assert.match(renderer, /fillRect\(x \* size - half, y \* docH - half, footprint, footprint\)/);
  assert.match(css, /\.eraser-footprint \{[^}]*border:2px solid #264c2e/);
});

test("도화지 비율은 문서가 정하고, 화면·래스터·저장 이미지가 같은 비율을 쓴다", () => {
  // 화면 상자의 비율이 곧 그림의 비율이다 — 좌표가 x·y 모두 0~1로 정규화돼 있기 때문이다.
  assert.match(studio, /"--paper-aspect": `\$\{DOCUMENT_SIZE\} \/ \$\{documentHeight\(documentState\)\}`/);
  assert.match(css, /\.canvas-wrap \{[^}]*aspect-ratio:var\(--paper-aspect,1\);/);
  // 래스터도 문서 비율을 따른다. 정사각으로 고정하면 저장 PNG와 화면이 어긋난다.
  assert.match(studio, /function documentPixels\(document: Pick<DrawDocument, "height">, width: number\)/);
  assert.match(studio, /height: Math\.round\(width \* documentHeight\(document\) \/ DOCUMENT_SIZE\)/);
  // 저장 이미지는 화면 캔버스 비율을 그대로 쓴다.
  assert.match(studio, /const height = Math\.max\(1, Math\.round\(size \* canvas\.height \/ Math\.max\(1, canvas\.width\)\)\)/);
  // 점선 안내 좌표는 정사각 기준이라, 가운데 정사각 영역에 넣어 동그라미가 타원이 되지 않게 한다.
  assert.match(studio, /function guideSquare\(canvas: HTMLCanvasElement\)/);
  assert.match(studio, /context\.scale\(square\.side \/ 1024, square\.side \/ 1024\)/);
  // 도화지는 화면을 채우되, 비율은 문서가 정한다. width·height를 둘 다 100%로 주면
  // aspect-ratio가 무시돼 기존 정사각 작품이 늘어난다.
  assert.match(css, /width:min\(100cqw,calc\(100cqh \* var\(--paper-ratio,1\)\)\)/);
  assert.match(css, /\.canvas-zone \{ container-type:size; \}/);
  // 좁은 화면 규칙도 정사각을 가정하면 안 된다 — cq로 폭을 잡는 곳은 모두 비율을 곱한다.
  const cqWidths = css.match(/width:min\(100cqw,[^;]*/g) ?? [];
  assert.ok(cqWidths.length >= 3, `cq 기반 도화지 폭 규칙이 있어야 한다: ${cqWidths.length}`);
  for (const rule of cqWidths) assert.match(rule, /--paper-ratio/, `정사각을 가정한 규칙이 남아 있다: ${rule}`);
  // 새 작품은 화면 비율에 맞춘다. 이미 그린 그림은 화면이 세로로 길 때만 가운데 둔 채 늘리고(줄이지 않음),
  // 옆으로 넓은 화면에서는 종이가 틀을 덮고 넘친 만큼 옮겨 본다(2026-09-15 "도화지 크기는 화면을 꽉채우지 안 잖아").
  assert.match(studio, /if \(next < from \|\| activePoints\.current\.size \|\| artworkRef\.current\?\.status === "complete" \|\| conflictDraftRef\.current\) return;/);
  assert.match(studio, /growDrawOps\(current\.ops, from, next\)/);
  // 도화지는 100%에서 화면 span장 너비다(2026-09-20 큰 도화지). 끝까지 축소하면 1/span에서 전체가 보인다.
  assert.match(studio, /const screenPaper = coverPaper\(frame\.width, frame\.height, documentHeight\(documentState\)\);/);
  assert.match(studio, /const paper = \{ width: screenPaper\.width \* span, height: screenPaper\.height \* span \};/);
  assert.match(studio, /min: 1 \/ span, max: MAX_SCALE/);
  assert.match(studio, /clampDocumentHeight\(DOCUMENT_SIZE \* height \/ width\)/);
});

test("shape tool offers ten child-friendly shapes and outline or filled drawing", () => {
  for (const shape of ["line", "circle", "triangle", "rectangle", "rounded-rectangle", "star", "heart", "arrow", "curve", "cloud"]) assert.match(studio, new RegExp(`kind: "${shape}"`));
  assert.match(studio, /moreShapes \? "도형 접기" : "더 많은 도형"/);
  assert.match(studio, /className="shape-fill-row"/);
  assert.match(studio, /aria-pressed=\{!shapeFilled\}[\s\S]{0,180}테두리/);
  assert.match(studio, /aria-pressed=\{shapeFilled\}[\s\S]{0,260}색 채움/);
  assert.match(renderer, /op\.filled && op\.shape !== "line" && op\.shape !== "curve"/);
});

test("pointer cancel discards shapes and pending fills instead of committing them", () => {
  assert.match(studio, /onPointerCancel=\{pointerCancel\}/);
  assert.match(studio, /function pointerCancel[\s\S]*shapeDragRef\.current\?\.pointerId === event\.pointerId/);
  // 취소 이벤트의 좌표로 도형을 커밋하면 (0,0) 꼭짓점 도형이 생긴다.
  assert.doesNotMatch(studio, /function pointerCancel[\s\S]{0,900}commitShape/);
});

test("an empty free canvas tells a first-time child what to do", () => {
  assert.match(studio, /!lesson && !documentState\.ops\.length/);
  assert.match(studio, /✏️ 하얀 종이에 그어 봐!/);
  assert.match(css, /\.guide-notice,\.canvas-start-hint \{[^}]*pointer-events:none/);
  // tool-options-open: 도형·글씨 옵션이 열리면 태블릿 세로에서 패널이 커지고 캔버스가
  // 양보한다 — 빌드가 :has() 조합을 떨어뜨려 React가 클래스로 알린다 (2026-08-20).
  assert.match(studio, /className=\{`studio-body \$\{grimiOpen \|\| lesson \? "" : "without-step-panel"\}\$\{grimiOpen \? " grimi-open" : ""\}\$\{grimiOpen && grimiCollapsed \? " grimi-collapsed" : ""\}\$\{studioTool === "shape" \|\| studioTool === "text" \? " tool-options-open" : ""\}`\}/);
  // 도구는 격자 칸이 아니라 아래 도구 막대라 오른쪽 도구 칸이 없다(2026-09-14).
  assert.match(css, /\.studio-body\.without-step-panel \{ grid-template-columns:minmax\(0,1fr\); \}/);
  assert.match(css, /@media \(max-width:720px\)[\s\S]*\.studio-body\.without-step-panel \{ display:flex; \}/);
  assert.match(css, /@media \(max-width:900px\) and \(max-height:500px\) and \(orientation:landscape\)[\s\S]*\.studio-body\.without-step-panel \{ grid-template-columns:minmax\(0,1fr\); \}/);
});

test("lesson choices visibly select, persist and can be chosen again after navigation", () => {
  assert.match(studio, /function chooseChildChoice\(choice: string\)/);
  assert.match(studio, /localStorage\.setItem\(`wiggle:lesson-choice:v1:\$\{artwork\.id\}:\$\{artwork\.currentStep\}`/);
  assert.match(studio, /localStorage\.getItem\(key\)/);
  assert.match(studio, /aria-pressed=\{childChoice === choice\}/);
  assert.match(css, /\.choice-chips button\[aria-pressed=true\],\.grimi-chips button\[aria-pressed=true\]/);
});

test("lesson guides use a pencil demo before dotted practice without leaving the canvas", () => {
  assert.match(studio, /type GuidePhase = "independent" \| "demo" \| "practice"/);
  assert.match(studio, /function drawPencil\(/);
  assert.match(studio, /✏️ 먼저 보여줘/);
  assert.match(studio, /이제 네 차례야\. 아무 점선이나 골라서 시작해 봐\./);
  assert.match(studio, /점선만 보기/);
  assert.match(studio, /className=\{guidePhase !== "independent" && lessonGuideAvailable \? "guide-canvas" : "guide-canvas hidden"\}/);
});
