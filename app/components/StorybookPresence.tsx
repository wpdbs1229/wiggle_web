"use client";
import { memo, useEffect, useRef, useState } from "react";
import { storybookEditorFetch } from "@/lib/storybook-editor-fetch";
import type { BookAdvice } from "@/lib/storybook-live";
import "./storybook-live.css";

export const StorybookPresence = memo(function StorybookPresence({ bookId, pageId, onWatching }: { bookId: string; pageId: string; onWatching: (watching: boolean) => void }) {
  const [advice, setAdvice] = useState<BookAdvice[]>([]), [watching, setWatching] = useState(false), [error, setError] = useState("");
  const page = useRef(pageId), refresh = useRef<() => void>(() => {});
  useEffect(() => { page.current = pageId; const timer = window.setTimeout(() => refresh.current(), 250); return () => clearTimeout(timer); }, [pageId]);
  useEffect(() => {
    let disposed = false, busy = false, lastSuccess = 0;
    const controller = new AbortController();
    async function poll() {
      if (busy || document.hidden || disposed) return;
      busy = true;
      try {
        const response = await storybookEditorFetch(`/api/storybooks/${bookId}/live`, { method: "POST", signal: controller.signal, body: JSON.stringify({ pageId: page.current }) });
        if (!response.ok) throw new Error("presence");
        const data = await response.json() as { watching: boolean; advice: BookAdvice[] };
        if (disposed) return;
        lastSuccess = Date.now(); setWatching(data.watching); onWatching(data.watching);
        setAdvice(current => JSON.stringify(current) === JSON.stringify(data.advice) ? current : data.advice);
      } catch {
        if (!disposed && Date.now() - lastSuccess > 15_000) { setWatching(false); onWatching(false); }
      } finally { busy = false; }
    }
    refresh.current = () => void poll();
    void poll(); const timer = window.setInterval(() => void poll(), 4000);
    const visibility = () => { if (document.hidden) { setWatching(false); onWatching(false); } else void poll(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { disposed = true; controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visibility); onWatching(false); };
  }, [bookId, onWatching]);
  async function acknowledge(id: string) {
    setError("");
    try {
      const response = await storybookEditorFetch(`/api/storybooks/${bookId}/live`, { method: "POST", body: JSON.stringify({ action: "ack", adviceId: id }) });
      if (!response.ok) throw new Error();
      setAdvice(current => current.map(note => note.id === id ? { ...note, seenAt: new Date().toISOString() } : note));
    } catch { setError("확인을 보내지 못했어요. 다시 눌러 주세요."); }
  }
  if (!watching && !advice.length) return null;
  return <section className="storybook-teacher-advice" aria-label="선생님 조언">
    {watching && <p role="status">👀 선생님이 그림책을 함께 보고 있어요.</p>}
    {!!advice.length && <details open={advice.some(note => !note.seenAt)}><summary>선생님 조언 · {advice.filter(note => !note.seenAt).length}개 새 조언</summary>{advice.map(note => <div className="storybook-advice-note" key={note.id}><b>{note.pageNumber}쪽</b><p>{note.body}</p>{note.seenAt ? <small>확인했어요</small> : <button type="button" className="small-button" onClick={() => void acknowledge(note.id)}>읽었어요</button>}</div>)}</details>}
    {error && <p role="alert">{error}</p>}
  </section>;
});
