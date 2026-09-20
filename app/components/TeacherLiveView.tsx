"use client";

import { PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { renderDrawDocument, resetDrawingCanvas } from "@/lib/draw-renderer";
import { documentHeight, documentSpan, type DrawDocument } from "@/lib/drawing-model";
import { drawMarkStrokes, MARK_ANSWER_LABEL, MARK_MAX_POINTS_PER_STROKE, MARK_MAX_STROKES, MARK_NOTE_MAX, type MarkAnswer, type MarkStroke } from "@/lib/teacher-marks";

type LiveArtwork = { id: string; title: string; status: string; revision: number; updatedAt: string; document: DrawDocument };
type LiveMark = { id: string; strokes: MarkStroke[]; note: string; answer: MarkAnswer | "replaced" | "cleared" | null; answeredAt: string | null; createdAt: string };

/**
 * 선생님 미리보기의 거의 실시간 보기 + 표시 그리기(2026-09-14).
 *
 * 아이 그림은 문서(ops)를 받아 아이 도화지와 같은 렌더러로 원본 크기로 다시 그린다 — 256px 썸네일보다 선명하다.
 * 표시는 그 위 따로 된 캔버스에 그린다. 보내면 아이 도화지의 따로 된 층에 뜨고, 아이 그림에는 섞이지 않는다.
 * 미리보기가 열린 동안에만 1초마다 부른다. 선생님이 보는 동안 아이 쪽은 멈춘 뒤 0.5초, 길어도 2초마다 저장한다
 * (2026-09-14 사용자 결정). 이미 가진 저장 번호를 함께 보내 그림이 그대로면 문서를 다시 받지 않는다.
 */
export function TeacherLiveView({ classroomId, studentId, nickname, onPost }: {
  classroomId: string;
  studentId: string;
  nickname: string;
  onPost: (payload: Record<string, unknown>) => Promise<unknown>;
}) {
  const [artwork, setArtwork] = useState<LiveArtwork | null>(null);
  const [mark, setMark] = useState<LiveMark | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<MarkStroke[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const baseRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<MarkStroke | null>(null);
  const renderedKey = useRef("");
  const knownRef = useRef<LiveArtwork | null>(null);

  const load = useCallback(async () => {
    try {
      const known = knownRef.current;
      const knownQuery = known ? `&knownArtworkId=${encodeURIComponent(known.id)}&knownRevision=${known.revision}` : "";
      const response = await fetch(`/api/teacher?classroomId=${encodeURIComponent(classroomId)}&liveStudentId=${encodeURIComponent(studentId)}${knownQuery}`, { cache: "no-store" });
      const data = await response.json() as { artwork: (Omit<LiveArtwork, "document"> & { document: DrawDocument | null; unchanged?: boolean }) | null; mark: LiveMark | null; error?: string };
      if (!response.ok) throw new Error(data.error ?? "그림을 불러오지 못했어요.");
      const incoming = data.artwork;
      // 그림이 그대로면 서버가 문서를 빼고 보낸다 — 가진 문서를 이어 쓴다.
      const next = !incoming ? null : incoming.document ? { ...incoming, document: incoming.document } : known && known.id === incoming.id ? { ...incoming, document: known.document } : null;
      if (incoming && !next) { knownRef.current = null; return; }
      if (!next || !known || next.id !== known.id || next.revision !== known.revision || next.status !== known.status) { knownRef.current = next; setArtwork(next); }
      setMark(data.mark); setLoaded(true);
    } catch { /* 다음 주기에 다시 확인한다. 마지막으로 받은 그림을 그대로 둔다. */ }
  }, [classroomId, studentId]);

  useEffect(() => {
    void load();
    let busy = false;
    const timer = window.setInterval(() => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      void load().finally(() => { busy = false; });
    }, 1000);
    return () => clearInterval(timer);
  }, [load]);

  const docHeight = artwork ? documentHeight(artwork.document) : 640;
  const markUnitScale = artwork ? documentSpan(artwork.document) : 1;

  // 아이 그림: 저장 번호가 바뀔 때만 다시 그린다(3초마다 같은 그림을 다시 그리지 않는다).
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || !artwork) return;
    const key = `${artwork.id}:${artwork.revision}:${artwork.updatedAt}`;
    if (renderedKey.current === key && canvas.height === docHeight) return;
    canvas.width = 1024; canvas.height = docHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    resetDrawingCanvas(context, { width: 1024, height: docHeight });
    renderDrawDocument(context, artwork.document.ops, { width: 1024, height: docHeight });
    renderedKey.current = key;
  }, [artwork, docHeight]);

  const openMark = mark && !mark.answer ? mark : null;
  const redrawMarks = useCallback(() => {
    const canvas = markRef.current;
    if (!canvas) return;
    if (canvas.width !== 1024) canvas.width = 1024;
    if (canvas.height !== docHeight) canvas.height = docHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    // 이미 보낸(아이가 아직 답하지 않은) 표시는 옅게, 지금 그리는 표시는 진하게.
    // 넓은 도화지(span)에서는 아이 화면과 같은 굵기로 보이도록 도화지 단위 굵기를 함께 키운다.
    if (openMark) drawMarkStrokes(context, openMark.strokes, 1024, docHeight, 0.35, markUnitScale);
    drawMarkStrokes(context, drawingRef.current ? [...draft, drawingRef.current] : draft, 1024, docHeight, 0.9, markUnitScale);
  }, [docHeight, draft, markUnitScale, openMark]);
  useEffect(() => { redrawMarks(); }, [redrawMarks]);

  const canMark = Boolean(artwork && artwork.status !== "complete");

  function pointFor(event: PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = event.currentTarget.getBoundingClientRect();
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    return [clamp((event.clientX - rect.left) / rect.width), clamp((event.clientY - rect.top) / rect.height)];
  }
  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (!canMark || draft.length >= MARK_MAX_STROKES) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = [pointFor(event)];
    setStatus(""); setError("");
    redrawMarks();
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    const stroke = drawingRef.current;
    if (!stroke || stroke.length >= MARK_MAX_POINTS_PER_STROKE) return;
    const next = pointFor(event);
    const last = stroke[stroke.length - 1];
    if (Math.hypot(next[0] - last[0], next[1] - last[1]) < 0.004) return;
    stroke.push(next);
    redrawMarks();
  }
  function up() {
    const stroke = drawingRef.current;
    drawingRef.current = null;
    if (stroke) setDraft((current) => [...current, stroke]);
  }

  async function send() {
    if (!artwork || !draft.length || sending) return;
    setSending(true); setError(""); setStatus("");
    try {
      await onPost({ action: "sendMark", classroomId, studentId, artworkId: artwork.id, strokes: draft, note });
      setDraft([]); setNote("");
      setStatus(`${nickname} 도화지에 표시를 보냈어요.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "표시를 보내지 못했어요.");
    } finally { setSending(false); }
  }
  async function clearSent() {
    try { await onPost({ action: "clearMark", classroomId, studentId }); setStatus("아이 도화지에서 표시를 거뒀어요."); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "표시를 거두지 못했어요."); }
  }

  if (!loaded) return <div className="empty-state">그림을 불러오는 중…</div>;
  if (!artwork) return <div className="empty-state">아직 저장된 그림이 없어요.</div>;
  return <section className="teacher-live" aria-label={`${nickname} 그림 실시간 보기`}>
    <div className="teacher-live-paper" style={{ aspectRatio: `1024 / ${docHeight}` }}>
      <canvas ref={baseRef} className="teacher-live-base" role="img" aria-label={`${nickname}의 ${artwork.title}`} />
      <canvas ref={markRef} className={`teacher-live-marks${canMark ? " can-mark" : ""}`} aria-hidden="true"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
    </div>
    <p className="tcw-preview-caption">{artwork.title} · {artwork.status === "complete" ? "완성" : "그리는 중"} · 1초마다 새로 봐요</p>
    {canMark ? <div className="teacher-live-tools">
      <p>그림 위에 손가락이나 마우스로 동그라미·화살표를 그려 보내요. 아이 그림에는 섞이지 않고, 아이 도화지 위에 따로 떠요.</p>
      <label className="sr-only" htmlFor="teacher-live-note">표시와 함께 보낼 짧은 말</label>
      <input id="teacher-live-note" maxLength={MARK_NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} placeholder="짧은 말 (예: 여기에 해를 그려 볼까?)" />
      <div className="teacher-live-actions">
        <button type="button" className="button secondary" disabled={!draft.length || sending} onClick={() => { setDraft([]); setStatus(""); }}>다시 그리기</button>
        <button type="button" className="button primary" disabled={!draft.length || sending} onClick={() => void send()}>{sending ? "보내는 중…" : "표시 보내기"}</button>
      </div>
    </div> : <p>완성한 그림에는 표시를 보낼 수 없어요.</p>}
    {mark && mark.answer !== "replaced" && mark.answer !== "cleared" && <p className="teacher-live-answer" role="status">
      {mark.answer ? <>아이 답: <b>{MARK_ANSWER_LABEL[mark.answer]}</b></> : <>보낸 표시 · 아이가 아직 답하기 전이에요 <button type="button" className="text-button" onClick={() => void clearSent()}>표시 거두기</button></>}
    </p>}
    {status && <p className="preview-message-status" role="status">✓ {status}</p>}
    {error && <p className="preview-message-error" role="alert">{error}</p>}
  </section>;
}
