"use client";
import { useEffect, useRef, useState } from "react";
import type { BookAdvice, LiveBook, LiveBookStudent } from "@/lib/storybook-live";
import { AuthenticatedImageCache } from "./AuthenticatedImage";
import { BookPage } from "./TeacherStorybookPreview";
import { Logo } from "./Logo";
import { teacherRequest } from "./book-workflow-client";
import "./book-workflow.css";
import "./storybook-live.css";

type DisplayBook = LiveBook & { pageIds: string[] };
const studentName = (s: LiveBookStudent) => `${s.seatNumber ? `${s.seatNumber}번 ` : ""}${s.realName || s.nickname}`;
export function TeacherStorybookLive({ classroomId }: { classroomId: string }) {
  const [students, setStudents] = useState<LiveBookStudent[]>([]), [selected, setSelected] = useState("");
  const [name, setName] = useState("우리 반"), [error, setError] = useState("");
  useEffect(() => {
    let disposed = false, busy = false; const controller = new AbortController();
    async function load() {
      if (busy || disposed || document.hidden) return;
      busy = true;
      try {
        const data = await teacherRequest<{ classroom: { name: string }; students: LiveBookStudent[] }>(`/api/teacher/book-live?classroomId=${classroomId}`, { signal: controller.signal });
        if (disposed) return;
        setStudents(current => JSON.stringify(current) === JSON.stringify(data.students) ? current : data.students); setName(data.classroom.name); setError("");
        setSelected(current => data.students.some(s => s.id === current) ? current : data.students.find(s => s.id === new URLSearchParams(location.search).get("student"))?.id || data.students.find(s => s.active)?.id || data.students[0]?.id || "");
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : "학생 목록을 불러오지 못했어요."); }
      finally { busy = false; }
    }
    void load(); const timer = window.setInterval(() => void load(), 6000);
    const visibility = () => { if (!document.hidden) void load(); }; document.addEventListener("visibilitychange", visibility);
    return () => { disposed = true; controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [classroomId]);
  const student = students.find(s => s.id === selected);
  return <main className="book-desk book-live-desk"><header className="book-desk-header"><Logo /><a className="small-button" href={`/teacher/class/${classroomId}`}>← 수업실</a><a className="small-button" href={`/teacher/class/${classroomId}/books`}>그림책 목록</a></header>
    <section className="book-desk-hero"><div><p className="eyebrow">{name} · 함께 만들어요</p><h1>그림책 실시간 보기</h1><p>학생이 펼친 쪽과 저장한 내용이 자동으로 보여요. 함께 읽으며 조언을 보내 주세요.</p></div></section>
    {error && <p className="error-box" role="alert">{error}</p>}
    <div className="book-live-layout"><aside className="book-panel book-live-students" aria-label="학생 선택"><h2>학생 · 그림책</h2>{students.map(s => <button className="book-live-student" type="button" aria-pressed={s.id === selected} key={s.id} onClick={() => setSelected(s.id)}><b>{studentName(s)}</b><span>{s.title || (s.bookId ? "제목 짓는 중" : "아직 그림책이 없어요")}</span><small>{s.active ? "● 작업 화면 열림" : s.bookId ? "최근 저장한 책" : "시작 전"}</small></button>)}{!students.length && !error && <p>학생 목록을 확인하고 있어요.</p>}</aside>
      {student && <AuthenticatedImageCache key={student.id}><LiveReader classroomId={classroomId} student={student} /></AuthenticatedImageCache>}
    </div></main>;
}

function LiveReader({ classroomId, student }: { classroomId: string; student: LiveBookStudent }) {
  const [book, setBook] = useState<DisplayBook | null>(null), [advice, setAdvice] = useState<BookAdvice[]>([]);
  const [loaded, setLoaded] = useState(false), [paused, setPaused] = useState(false), [pageId, setPageId] = useState("");
  const [error, setError] = useState(""), [note, setNote] = useState(""), [sending, setSending] = useState(false), [notice, setNotice] = useState("");
  const known = useRef<DisplayBook | null>(null);
  const [draftTarget, setDraftTarget] = useState<{ bookId: string; pageId: string; pageNumber: number } | null>(null);
  useEffect(() => {
    if (paused) return;
    let disposed = false, busy = false, lastWatch = 0;
    const controller = new AbortController();
    async function poll() {
      if (disposed || busy || document.hidden) return;
      busy = true;
      try {
        if (Date.now() - lastWatch >= 8000) {
          await teacherRequest("/api/teacher/book-live", { method: "POST", signal: controller.signal, body: JSON.stringify({ action: "watch", classroomId, studentId: student.id }) }); lastWatch = Date.now();
        }
        const previous = known.current;
        const query = new URLSearchParams({ classroomId, studentId: student.id });
        if (previous) { query.set("knownBookId", previous.id); query.set("knownRevision", String(previous.revision)); query.set("knownPageId", previous.page.id); }
        if (pageId) query.set("pageId", pageId);
        const data = await teacherRequest<{ book: (Partial<DisplayBook> & { unchanged?: boolean }) | null; advice: BookAdvice[] }>(`/api/teacher/book-live?${query}`, { signal: controller.signal });
        if (disposed) return;
        const next = data.book ? (data.book.unchanged && previous && previous.id === data.book.id ? { ...previous, ...data.book } : data.book) as DisplayBook : null;
        if (next && !next.page) throw new Error("쪽을 다시 불러오고 있어요.");
        if (!next || !previous || next.id !== previous.id || next.revision !== previous.revision || next.page.id !== previous.page.id || next.active !== previous.active || next.activePageId !== previous.activePageId) { known.current = next; setBook(next); }
        if (previous && next?.id !== previous.id) setPageId("");
        setAdvice(current => JSON.stringify(current) === JSON.stringify(data.advice) ? current : data.advice); setLoaded(true); setError("");
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : "연결을 다시 확인하고 있어요."); }
      finally { busy = false; }
    }
    void poll(); const timer = window.setInterval(() => void poll(), 1000);
    const visibility = () => { if (!document.hidden) void poll(); }; document.addEventListener("visibilitychange", visibility);
    return () => { disposed = true; controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [classroomId, student.id, pageId, paused]);
  async function send() {
    const target = draftTarget;
    if (!target || !note.trim() || sending) return;
    setSending(true); setNotice("");
    try {
      const data = await teacherRequest<{ advice: BookAdvice[] }>("/api/teacher/book-live", { method: "POST", body: JSON.stringify({ action: "advice", ...target, body: note }) });
      if (known.current?.id === target.bookId) setAdvice(data.advice);
      setNote(""); setDraftTarget(null); setNotice(`${target.pageNumber}쪽 조언을 보냈어요.`);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "조언을 보내지 못했어요."); }
    finally { setSending(false); }
  }
  return <section className="book-panel book-live-reader" aria-label={`${studentName(student)} 그림책 작업 화면`}><div className="book-section-heading"><div><p className="eyebrow">{studentName(student)}</p><h2>{book?.title || "그림책 작업 화면"}</h2></div><button className="small-button" type="button" onClick={() => setPaused(v => !v)}>{paused ? "실시간 다시 보기" : "실시간 잠시 멈춤"}</button></div>
    <p className="book-live-status" role="status">{paused ? "갱신을 잠시 멈췄어요." : error ? "연결이 지연되어 마지막으로 받은 화면을 보여요." : !loaded ? "학생의 그림책을 펼치는 중…" : book?.active ? "● 학생 화면을 함께 보는 중 · 저장 후 자동 반영" : "현재 작업 화면이 닫혀 있어 최근 저장 내용을 보여요."}</p>
    {error && <p className="error-box" role="alert">{error}</p>}
    {!book && loaded && <p>아직 만든 그림책이 없어요. 학생이 책을 만들면 자동으로 보여요.</p>}
    {book && <><div className="book-live-navigation"><button className="small-button" aria-label="이전 쪽" disabled={paused || book.pageIndex === 0} onClick={() => setPageId(book.pageIds[book.pageIndex - 1])}>←</button><b>{book.pageIndex + 1} / {book.pageCount}쪽</b><button className="small-button" aria-label="다음 쪽" disabled={paused || book.pageIndex >= book.pageCount - 1} onClick={() => setPageId(book.pageIds[book.pageIndex + 1])}>→</button><button className="small-button" aria-pressed={!pageId} disabled={paused} onClick={() => setPageId("")}>{pageId ? "학생이 보는 쪽 따라가기" : "학생이 보는 쪽을 따라가요"}</button></div>
      <BookPage bookId={book.id} format={book.format} page={book.page} assetBase="/api/teacher/book-editor" />
      <form className="book-live-advice" onSubmit={e => { e.preventDefault(); void send(); }}><label htmlFor="book-advice">{note && draftTarget ? draftTarget.pageNumber : book.pageIndex + 1}쪽에 조언 보내기</label><textarea id="book-advice" maxLength={300} value={note} disabled={sending} placeholder="예: 이 장면에서 주인공이 어떤 마음인지 한 문장 더 써 볼까?" onChange={e => { if (!note) setDraftTarget({ bookId: book.id, pageId: book.page.id, pageNumber: book.pageIndex + 1 }); setNote(e.target.value); setNotice(""); }} /><p>학생의 책 내용은 그대로 두고, 학생 화면에 조언이 표시돼요.</p><button className="button primary" disabled={sending || !note.trim()}>{sending ? "보내는 중…" : "조언 보내기"}</button>{notice && <p role="status">{notice}</p>}</form>
      {!!advice.length && <section aria-label="보낸 조언"><h3>보낸 조언</h3>{advice.map(item => <div className="storybook-advice-note" key={item.id}><b>{item.pageNumber}쪽 · {item.seenAt ? "학생이 읽었어요" : "아직 읽기 전"}</b><p>{item.body}</p></div>)}</section>}
    </>}
  </section>;
}
