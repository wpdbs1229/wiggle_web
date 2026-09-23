"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { zipSync } from "fflate";
import { Check, Download, FileText, Search, SlidersHorizontal } from "lucide-react";
import type { Rubric, BookFeedback } from "@/lib/book-rubric";
import { defaultFeedbackExport, feedbackExportContent, type FeedbackExportOptions } from "@/lib/feedback-export";
import { teacherRequest, downloadFeedback, saveBlob, jobLabel, type CompletedBook } from "./book-workflow-client";
import { Logo } from "./Logo";
import { TeacherFeedbackGeneration } from "./TeacherFeedbackGeneration";
import "./book-workflow.css";
import "./feedback-manager.css";

type Job = { id: string; storybookId: string; revision: number; rubricVersion: string; status: string; createdAt: string };
type Result = { rubric: Rubric; feedback: BookFeedback; title: string; version: string };
const studentName = (book: CompletedBook) => `${book.seatNumber ? book.seatNumber + "번 " : ""}${book.realName || book.nickname}`;
export function TeacherFeedbackManager({ classroomId }: { classroomId: string }) {
  const [data, setData] = useState<{ name: string; books: CompletedBook[]; jobs: Job[]; version: string } | null>(null);
  const [active, setActive] = useState("");
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, Result>>({});
  const [options, setOptions] = useState<Record<string, FeedbackExportOptions>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState(""), [filter, setFilter] = useState("all");
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState("");
  const operation = useRef(false);
  const [retry, setRetry] = useState(0);
  const load = useCallback(async () => {
    setError("");
    try {
      const [library, settings] = await Promise.all([
        teacherRequest<{ classroom: { displayName: string }; storybooks: CompletedBook[] }>(`/api/teacher/storybooks?classroomId=${classroomId}`),
        teacherRequest<{ jobs: Job[]; version: string }>(`/api/teacher/book-feedback?classroomId=${classroomId}`),
      ]);
      setData({ name: library.classroom.displayName, books: library.storybooks, jobs: settings.jobs, version: settings.version });
      setActive(current => {
        const preferred = current || new URLSearchParams(location.search).get("book");
        return library.storybooks.find(b => b.id === preferred)?.id ?? library.storybooks[0]?.id ?? "";
      });
      setSelected(current => current.filter(id => library.storybooks.some(b => b.id === id)));
    } catch (e) { setError(e instanceof Error ? e.message : "목록을 불러오지 못했어요."); }
  }, [classroomId]);
  useEffect(() => { void load(); }, [load]);
  function jobsFor(book: CompletedBook) { return data?.jobs.filter(j => j.storybookId === book.id && j.revision === book.revision && j.status === "complete") ?? []; }
  function jobFor(book: CompletedBook) { const jobs = jobsFor(book); return jobs.find(j => j.id === versions[book.id]) ?? jobs[0]; }
  const book = data?.books.find(b => b.id === active);
  const job = book ? jobFor(book) : undefined;
  const result = job ? results[job.id] : undefined;
  const choice = result && job ? options[job.id] ?? defaultFeedbackExport(result.rubric) : undefined;
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId || result) return;
    let cancelled = false;
    setError("");
    void teacherRequest<Result>(`/api/teacher/book-feedback/${jobId}`).then(value => {
      if (!cancelled) setResults(current => ({ ...current, [jobId]: value }));
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [jobId, result, retry]);
  function update(patch: Partial<FeedbackExportOptions>) {
    if (job && choice) setOptions(current => ({ ...current, [job.id]: { ...choice, ...patch } }));
  }
  const visible = (data?.books ?? []).filter(b => `${studentName(b)} ${b.title}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (filter === "all" || (filter === "ready" ? !!jobFor(b) : !jobFor(b))));
  const groups = [...visible.reduce((map, b) => { const list = map.get(b.studentId) ?? []; list.push(b); map.set(b.studentId, list); return map; }, new Map<string, CompletedBook[]>()).values()].sort((a, b) => (a[0].seatNumber ?? Infinity) - (b[0].seatNumber ?? Infinity));
  const readyVisible = visible.filter(b => jobFor(b));
  const content = result && choice ? feedbackExportContent(result.rubric, result.feedback, choice) : null;
  const valid = (o: FeedbackExportOptions) => o.criteria.length > 0 || o.summary;

  async function download(books: CompletedBook[]) {
    if (operation.current || !books.length) return;
    operation.current = true; setBusy(true); setError(""); setNotice("");
    const files: Record<string, Uint8Array> = {}, failed: string[] = [];
    try {
      for (const [i, b] of books.entries()) {
        const j = jobFor(b); if (!j) { failed.push(`${studentName(b)} · ${b.title}: 피드백 미완료`); continue; }
        setProgress(`${i + 1} / ${books.length}권 · ${studentName(b)} · ${b.title}`);
        try {
          const r = results[j.id] ?? await teacherRequest<Result>(`/api/teacher/book-feedback/${j.id}`);
          const o = options[j.id] ?? defaultFeedbackExport(r.rubric);
          if (!valid(o)) throw new Error("포함할 영역 또는 종합 의견을 선택해 주세요.");
          const file = await downloadFeedback(j.id, o);
          let filename = file.filename, suffix = 2;
          while (files[filename]) filename = file.filename.replace(/\.pdf$/, `_${suffix++}.pdf`);
          files[filename] = file.bytes;
        } catch (e) { failed.push(`${studentName(b)} · ${b.title}: ${e instanceof Error ? e.message : "다운로드 실패"}`); }
      }
      const entries = Object.entries(files);
      if (entries.length) {
        if (entries.length === 1) saveBlob(new Blob([new Uint8Array(entries[0][1])], { type: "application/pdf" }), entries[0][0]);
        else saveBlob(new Blob([new Uint8Array(zipSync(files))], { type: "application/zip" }), "학생별_선택피드백.zip");
        setNotice(`${entries.length}권 다운로드를 시작했어요. 책마다 선택한 항목을 적용했습니다.`);
      }
      if (failed.length) setError(`받지 못한 파일 ${failed.length}개\n${failed.join("\n")}`);
    } finally { operation.current = false; setBusy(false); setProgress(""); }
  }
  function applyToSelected() {
    if (!choice || !job) return;
    const matching = (data?.books ?? []).filter(b => selected.includes(b.id) && jobFor(b)?.rubricVersion === job.rubricVersion);
    setOptions(current => ({ ...current, ...Object.fromEntries(matching.map(b => [jobFor(b)!.id, { ...choice, criteria: [...choice.criteria] }])) }));
    setNotice(`${matching.length}권에 현재 구성을 적용했어요.${matching.length < selected.length ? " 평가 기준이 다른 책은 개별 설정을 유지합니다." : ""}`);
  }
  return <main className="book-desk feedback-manager">
    <header className="book-desk-header"><Logo /><a className="small-button" href={`/teacher/class/${classroomId}/books`}>← 완성 그림책</a><button className="small-button" disabled={busy} onClick={() => { setResults({}); setRetry(n => n + 1); void load(); }}>새로 확인</button></header>
    <div className="fm-heading"><div><p className="eyebrow">{data?.name ?? "우리 반"} · 선생님의 책상</p><h1>피드백 관리</h1><p>학생마다 필요한 피드백만 골라, 한 번에 PDF로 모아 보세요.</p></div><span className="fm-count"><FileText size={20} /> {data?.books.filter(b => jobFor(b)).length ?? 0}권 준비 완료</span></div>
    <TeacherFeedbackGeneration classroomId={classroomId} onChanged={load}>
    {error && <div className="error-box" role="alert" style={{ whiteSpace: "pre-wrap" }}>{error}<button className="small-button" disabled={busy} onClick={() => { setRetry(n => n + 1); void load(); }}>다시 시도</button></div>}
    {notice && <p className="book-notice" role="status">{notice}</p>}
    <div className="fm-batch"><div><b>{selected.length}권 선택</b><span>한 권은 PDF, 여러 권은 ZIP으로 받아요.</span></div><div><button className="fm-clear" disabled={busy || !selected.length} onClick={() => setSelected([])}>선택 해제</button><button className="button primary" disabled={busy || !selected.length} onClick={() => void download((data?.books ?? []).filter(b => selected.includes(b.id)))}><Download size={18} />{busy ? "PDF 준비 중…" : "선택한 PDF 받기"}</button></div></div>
    {progress && <div className="feedback-progress" role="status"><span className="feedback-spinner" /><div><strong>선택한 피드백 PDF를 준비하고 있어요</strong><p>{progress}</p></div></div>}
    {!data ? <p className="book-empty">{error ? "목록을 불러오지 못했어요. 다시 시도해 주세요." : "피드백을 불러오고 있어요…"}</p> : <div className="fm-layout">
      <aside className="fm-list book-panel" aria-label="학생별 피드백 목록"><h2>학생 · 그림책</h2><label className="fm-search"><Search size={18} /><span className="sr-only">학생 이름·번호·책 제목 검색</span><input placeholder="이름, 번호, 책 제목 검색" value={query} onChange={e => setQuery(e.target.value)} /></label><label className="book-field">피드백 상태<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">모든 책</option><option value="ready">PDF 준비 완료</option><option value="waiting">피드백 미완료</option></select></label>
        <label className="book-check"><input type="checkbox" disabled={busy || !readyVisible.length} checked={!!readyVisible.length && readyVisible.every(b => selected.includes(b.id))} onChange={e => setSelected(current => e.target.checked ? [...new Set([...current, ...readyVisible.map(b => b.id)])] : current.filter(id => !readyVisible.some(b => b.id === id)))} />검색 결과의 완료 책 선택</label>
        {groups.map(group => <section className="fm-student" key={group[0].studentId}><div><h3>{studentName(group[0])}</h3><button className="fm-text-button" disabled={busy || !group.some(b => jobFor(b))} onClick={() => setSelected(current => [...new Set([...current, ...group.filter(b => jobFor(b)).map(b => b.id)])])}>학생 전체 선택</button></div>{group.map(b => {
          const j = jobFor(b), status = data.jobs.find(item => item.storybookId === b.id && item.revision === b.revision)?.status;
          return <div className={`fm-book ${active === b.id ? "active" : ""}`} key={b.id}><label className="fm-checkbox"><input type="checkbox" aria-label={`${studentName(b)} ${b.title} PDF 선택`} disabled={busy || !j} checked={selected.includes(b.id)} onChange={e => setSelected(current => e.target.checked ? [...new Set([...current, b.id])] : current.filter(id => id !== b.id))} /></label><button className="fm-book-button" disabled={busy} aria-pressed={active === b.id} onClick={() => { setActive(b.id); setError(""); }}><strong>{b.title}</strong><span>{j ? <><Check size={13} /> 준비 완료{j.rubricVersion !== data.version ? " · 이전 기준" : ""}{options[j.id] ? " · 구성 변경" : ""}</> : jobLabel(status)}</span></button></div>;
        })}</section>)}
        {!visible.length && <p className="book-empty">{data.books.length ? "검색 결과가 없어요." : "완성된 그림책이 아직 없어요."}</p>}
      </aside>
      <section className="fm-detail" aria-label="피드백 구성과 미리보기">
        {!book ? <div className="book-panel book-empty">그림책을 완성하면 여기서 피드백을 관리할 수 있어요.</div> : <>
          <div className="book-panel fm-config"><div className="book-section-heading"><div><p className="eyebrow">{studentName(book)}</p><h2>{book.title}</h2><p className="book-muted">책 {book.pageCount}쪽 · 이 책에 담을 피드백을 선택하세요.</p></div><a className="small-button" href={`/teacher/class/${classroomId}/books/${book.id}`}>그림책 보기</a></div>
            {!job ? <div className="book-empty"><p>아직 완성된 피드백이 없어요.</p><a className="button secondary" href="#feedback-generation" onClick={() => { const panel = document.getElementById("feedback-generation") as HTMLDetailsElement | null; if (panel) panel.open = true; }}>위에서 피드백 만들기</a></div> : !result || !choice ? <p role="status">{error ? "피드백을 열지 못했어요." : "피드백 내용을 불러오는 중…"}</p> : <fieldset disabled={busy} className="fm-fieldset">
              {jobsFor(book).length > 1 && <label className="book-field">평가 결과 버전<select value={job.id} onChange={e => setVersions(current => ({ ...current, [book.id]: e.target.value }))}>{jobsFor(book).map((j, i) => <option key={j.id} value={j.id}>{i === 0 ? "최근 결과" : "이전 결과"} · 기준 {j.rubricVersion.slice(0, 8)} · {j.createdAt?.slice(0, 10)}</option>)}</select></label>}
              <div className="fm-option-title"><h3><SlidersHorizontal size={17} />PDF에 넣을 평가 영역</h3><div><button className="fm-text-button" onClick={() => update({ criteria: result.rubric.criteria.map(c => c.id) })}>모두 선택</button><button className="fm-text-button" onClick={() => update({ criteria: [] })}>모두 해제</button></div></div>
              <div className="fm-criteria">{result.rubric.criteria.map(c => <label className={choice.criteria.includes(c.id) ? "checked" : ""} key={c.id}><input type="checkbox" checked={choice.criteria.includes(c.id)} onChange={e => update({ criteria: e.target.checked ? [...choice.criteria, c.id] : choice.criteria.filter(id => id !== c.id) })} />{c.name}</label>)}</div>
              <div className="fm-extras">{([ ["summary", "종합 의견 · 다음에 해 볼 일"], ["scores", "영역별 점수 · 합계"], ["pages", "근거 쪽 번호"] ] as const).map(([key, label]) => <label className="book-check" key={key}><input type="checkbox" checked={choice[key]} onChange={e => update({ [key]: e.target.checked })} />{label}</label>)}</div>
              <div className="book-section-heading"><button className="small-button" disabled={!selected.length || !valid(choice)} onClick={applyToSelected}>이 구성을 선택한 책에 적용</button><span className="book-muted">같은 평가 기준의 책에만 적용돼요.</span></div><p className="book-muted">선택은 이 화면에 머무는 동안 유지됩니다. 기존 피드백 원문은 바뀌지 않아요.</p>
            </fieldset>}
          </div>
          {content && result && choice && <div className="book-panel fm-preview"><div className="book-section-heading"><div><p className="eyebrow">내용 미리보기</p><h2>선택한 {content.criteria.length}개 영역{choice.summary ? " + 종합 의견" : ""}</h2></div><button className="button primary" disabled={busy || !valid(choice)} onClick={() => void download([book])}><Download size={17} />이 책 PDF 받기</button></div>
            <p className="book-muted">AI 초안 · 학생에게 전달하기 전 내용을 확인해 주세요. 실제 PDF는 분량에 따라 쪽이 나뉩니다.</p>
            {!valid(choice) && <p className="book-notice">평가 영역 또는 종합 의견을 하나 이상 선택해 주세요.</p>}
            {content.criteria.map(c => <article key={c.id}><h3>{c.name}{choice.scores && <span>{c.result.score} / {Math.max(...c.levels.map(l => l.score))}점</span>}</h3><p>{c.result.feedback}</p>{choice.pages && <small>근거: {c.result.pages.join(", ")}쪽</small>}</article>)}
            {choice.scores && !!content.criteria.length && <p className="fm-total">{content.partial ? "선택 영역 합계" : "총점"} <b>{content.total} / {content.maximum}점</b></p>}
            {choice.summary && <article><h3>종합 의견 · 다음에 해 볼 일</h3><p>{result.feedback.summary}</p></article>}
          </div>}
        </>}
      </section>
    </div>}
    </TeacherFeedbackGeneration>
  </main>;
}
