"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Rubric } from "@/lib/book-rubric";
import { teacherRequest, postJson, jobLabel, type CompletedBook } from "./book-workflow-client";
import { RubricGuide } from "./RubricGuide";
type Job = { id: string; storybookId: string; title: string; revision: number; rubricVersion: string; status: string; error: string | null };
type Settings = { rubric: Rubric; version: string; prompt: string; filename: string; configured: boolean; jobs: Job[] };
export function TeacherFeedbackGeneration({ classroomId, onChanged, children }: { classroomId: string; onChanged: () => Promise<void>; children: ReactNode }) {
  const [books, setBooks] = useState<CompletedBook[]>([]), [settings, setSettings] = useState<Settings | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState(""), [progress, setProgress] = useState(""), [stopRequested, setStopRequested] = useState(false);
  const [rubricError, setRubricError] = useState(""), [rubricNotice, setRubricNotice] = useState("");
  const stop = useRef(false), working = useRef(false);
  const load = useCallback(async () => {
    const [library, config] = await Promise.all([teacherRequest<{ storybooks: CompletedBook[] }>(`/api/teacher/storybooks?classroomId=${classroomId}`), teacherRequest<Settings>(`/api/teacher/book-feedback?classroomId=${classroomId}`)]);
    setBooks(library.storybooks); setSettings(config); return config;
  }, [classroomId]);
  useEffect(() => { void load().catch(e => setError(e.message)); return () => { stop.current = true; }; }, [load]);
  const processing = settings?.jobs.find(j => j.status === "processing");
  useEffect(() => {
    if (!busy && !processing) return;
    const timer = setInterval(() => { void load().then(onChanged).catch(() => {}); }, 2000);
    return () => clearInterval(timer);
  }, [busy, processing, load, onChanged]);
  async function run(ids?: string[]) {
    if (working.current) return;
    working.current = true; stop.current = false; setStopRequested(false); setBusy(true); setError(""); setNotice("");
    let completed = 0, failed = 0;
    try {
      if (ids?.length) {
        setProgress(`${ids.length}권의 피드백 요청을 접수하고 있어요`);
        await teacherRequest("/api/teacher/book-feedback", postJson({ classroomId, storybookIds: ids }));
      }
      const config = await load(), total = config.jobs.filter(j => ["queued", "waiting_key", "processing"].includes(j.status)).length;
      while (!stop.current) {
        setProgress(`${completed + failed} / ${total}권 처리 · 피드백 작성 중`);
        const result = await teacherRequest<{ done: boolean; waitingKey?: boolean; status?: string }>("/api/teacher/book-feedback/process", postJson({ classroomId }));
        await load(); await onChanged();
        if (result.done) { setNotice(result.waitingKey ? "요청을 보관했어요. AI 연결이 준비되면 이어서 처리해 주세요." : `피드백 처리 완료: 성공 ${completed}권, 실패 ${failed}권`); break; }
        if (result.status === "complete") completed++; else if (result.status === "failed") failed++;
      }
      if (stop.current) setNotice(`처리를 멈췄어요. 성공 ${completed}권, 실패 ${failed}권. 남은 요청은 이어서 처리할 수 있어요.`);
    } catch (e) { setError(e instanceof Error ? e.message : "피드백을 만들지 못했어요. 다시 시도해 주세요."); }
    finally { working.current = false; setBusy(false); setProgress(""); }
  }
  async function replaceRubric(file: File) {
    if (working.current) return;
    working.current = true; setBusy(true); setRubricError(""); setRubricNotice("");
    try {
      const form = new FormData(); form.append("classroomId", classroomId); form.append("file", file);
      await teacherRequest("/api/teacher/book-feedback", { method: "POST", body: form });
      await load(); await onChanged(); setRubricNotice("새 평가 기준을 적용했어요. 기존 결과는 그대로 보관됩니다.");
    } catch (e) { setRubricError(e instanceof Error ? e.message : "엑셀을 확인해 주세요."); }
    finally { working.current = false; setBusy(false); }
  }
  return <><details id="feedback-generation" className="book-panel fm-generation" open><summary>피드백 만들기</summary>
    {error && <p className="error-box" role="alert">{error}</p>}{notice && <p className="book-notice" role="status">{notice}</p>}
    {!settings && !error && <p role="status">평가 기준과 그림책을 불러오고 있어요…</p>}
    <p>한 번에 최대 50권. 요청한 결과는 아래 학생별 목록에 모입니다.</p>
    <label className="book-check"><input type="checkbox" disabled={busy || !books.length} checked={!!books.length && selected.length === books.length} onChange={e => setSelected(e.target.checked ? books.map(b => b.id) : [])} />전체 선택</label>
    <div className="fm-generation-books">{books.map(b => { const job = settings?.jobs.find(j => j.storybookId === b.id && j.revision === b.revision && j.rubricVersion === settings.version); return <label className="book-check" key={b.id}><input aria-label={`${b.seatNumber ?? ""}번 ${b.realName ?? b.nickname} ${b.title} 피드백 만들기 선택`} type="checkbox" disabled={busy} checked={selected.includes(b.id)} onChange={e => setSelected(current => e.target.checked ? [...current, b.id] : current.filter(id => id !== b.id))} /><span><b>{b.seatNumber ? `${b.seatNumber}번 ` : ""}{b.realName || b.nickname} · {b.title}</b><small>{jobLabel(job?.status)}{job?.error ? ` · ${job.error}` : ""}</small></span></label>; })}</div>
    <div className="book-bulk-bar"><button className="button primary" disabled={busy || !selected.length || selected.length > 50} onClick={() => void run(selected)}>{busy ? "피드백 만드는 중…" : "선택한 책 피드백 만들기"}</button>{busy ? <button className="small-button" disabled={stopRequested} onClick={() => { stop.current = true; setStopRequested(true); }}>현재 책까지 처리</button> : <button className="small-button" onClick={() => void run()}>대기 작업 이어서 처리</button>}</div>
    {(progress || processing) && <div className="feedback-progress" role="status"><span className="feedback-spinner" /><div><strong>{progress || "서버에서 피드백 작성 중"}</strong><p>{processing?.title}{stopRequested ? " · 이 책을 마친 뒤 멈춰요." : " · 이 화면을 열어 두세요."}</p></div></div>}
  </details>
  {children}
  <section className="book-panel fm-rubric" aria-label="평가 기준">
    <h2>평가 기준</h2>
    {rubricError && <p className="error-box" role="alert">{rubricError}</p>}{rubricNotice && <p className="book-notice" role="status">{rubricNotice}</p>}
    {settings && <><div className="book-section-heading"><h3>{settings.rubric.title}</h3><label className="button secondary">엑셀 파일 교체<input className="sr-only" type="file" accept=".xlsx" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void replaceRubric(file); e.target.value = ""; }} /></label></div><RubricGuide rubric={settings.rubric} classroomId={classroomId} /><details><summary>전체 배점 기준과 AI 프롬프트 확인</summary><pre className="rubric-prompt">{settings.prompt}</pre></details></>}
  </section></>;
}
