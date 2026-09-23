"use client";

import { FormEvent, useEffect, useState } from "react";
import { useCopyFeedback } from "./useCopyFeedback";
import { Check, Copy, Download, MoreHorizontal, Plus, Printer, QrCode, RefreshCw, Search, Upload, X } from "lucide-react";
import { MAX_REAL_NAME_LENGTH, MAX_SEAT_NUMBER, parseRosterRows, RosterRow, rosterTextToRows } from "@/lib/roster";
import { readRosterFile } from "@/lib/roster-file";
import { buildRosterTemplate } from "@/lib/xlsx-write";
import { WorkspaceDialog, WorkspaceProps } from "./TeacherWorkspace";
import { TeacherRosterPrint } from "./TeacherRosterPrint";
import "./TeacherRosterSettings.css";

function blankRows(start: number, count = 5): RosterRow[] {
  return Array.from({ length: count }, (_, index) => ({ seat: String(Math.min(MAX_SEAT_NUMBER, start + index)), name: "" }));
}

/** 비어 있는 번호 칸을 앞 줄 다음 번호로 채운다. 이름만 있는 표를 붙여 넣어도 번호가 생긴다. */
function withSeats(list: RosterRow[], start: number): RosterRow[] {
  let seat = start;
  return list.map((row) => {
    const value = Number(row.seat);
    if (row.seat.trim() && Number.isInteger(value) && value > 0) { seat = value + 1; return row; }
    const filled = { ...row, seat: String(Math.min(MAX_SEAT_NUMBER, seat)) };
    seat += 1;
    return filled;
  });
}

function seatAfter(list: RosterRow[], fallback: number) {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const value = Number(list[index].seat);
    if (list[index].seat.trim() && Number.isInteger(value) && value > 0) return Math.min(MAX_SEAT_NUMBER, value + 1);
  }
  return fallback;
}

export function TeacherRosterSettings({ data, onAction, onArchive, onRestore, onQr, onDeleteClassroom, busyStudentId, deletingClassroom }: WorkspaceProps) {
  const { classroom: room, students, archivedStudents, familyLinks } = data;
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<"add" | string | null>(null);
  const [rows, setRows] = useState<RosterRow[]>(() => blankRows(1));
  const [seat, setSeat] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState("");
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 6000); return () => clearInterval(timer); }, []);
  const filtered = [...students].sort((a, b) => (a.seatNumber ?? 1000) - (b.seatNumber ?? 1000)).filter((student) => `${student.seatNumber} ${student.realName ?? ""} ${student.nickname}`.includes(search.trim()));
  const parsed = parseRosterRows(rows);
  // 이어 붙이는 학급이면 마지막 번호 다음부터 시작한다. 선생님이 번호를 다시 세지 않는다.
  const firstSeat = Math.min(MAX_SEAT_NUMBER, students.reduce((max, student) => Math.max(max, student.seatNumber ?? 0), 0) + 1);
  function openAddDialog() { setError(""); setFileNotice(""); setRows(blankRows(firstSeat)); setDialog("add"); }
  function editRow(index: number, patch: Partial<RosterRow>) {
    setRows((current) => {
      const next = current.map((row, at) => (at === index ? { ...row, ...patch } : row));
      // 마지막 줄을 쓰기 시작하면 다음 줄을 미리 연다. 25명을 넣으며 `한 명 더`를 25번 누르지 않는다.
      const last = next[next.length - 1];
      if (index === next.length - 1 && last.name.trim()) next.push(...blankRows(seatAfter(next, firstSeat), 1));
      return next;
    });
  }
  /** 엑셀에서 복사한 표를 이름 칸에 붙여 넣으면 그 줄부터 칸으로 펼친다. */
  function pasteRows(index: number, text: string) {
    const pasted = rosterTextToRows(text);
    if (pasted.length < 2) return false;
    setRows((current) => {
      const head = current.slice(0, index);
      const filled = withSeats(pasted, seatAfter(head, firstSeat));
      return [...head, ...filled, ...blankRows(seatAfter(filled, firstSeat), 1)];
    });
    return true;
  }
  /* 인쇄는 팝업 대신 화면 안의 시트 + 브라우저 인쇄다. window.open에 noopener를 주면
   * 규격상 null이 돌아와, 팝업을 허용해 둔 브라우저에서도 종전 방식은 늘 실패했다. */
  const [printOpen, setPrintOpen] = useState(false);
  const joinUrl = typeof location === "undefined" ? "" : `${location.origin}/join/${room.joinToken}`;
  /* 엑셀(.xlsx)·CSV 파일을 그 자리에서 읽어 입력칸을 채운다. 파일은 서버로 보내지 않는다 —
   * 실명이 든 파일이라 교사 브라우저 안에서만 읽고, 교사가 확인한 뒤 저장한다. */
  const [fileNotice, setFileNotice] = useState("");
  async function importFile(file: File | undefined) {
    if (!file) return;
    setError(""); setFileNotice("");
    try {
      const read = await readRosterFile(file);
      if (!read.rows) { setError(`${file.name}에서 읽을 줄을 찾지 못했어요. 번호와 이름이 있는 표인지 확인해 주세요.`); return; }
      const imported = withSeats(rosterTextToRows(read.text), firstSeat);
      setRows([...imported, ...blankRows(seatAfter(imported, firstSeat), 1)]);
      const parts = [`${file.name}에서 ${read.rows}명을 읽었어요.`];
      if (read.skippedHeader) parts.push("첫 줄은 제목으로 보고 건너뛰었어요.");
      if (!read.numbered) parts.push("번호가 없어서 1번부터 차례로 붙였어요.");
      parts.push("저장 전에 확인해 주세요.");
      setFileNotice(parts.join(" "));
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "OLD_XLS"
        ? "옛 엑셀(.xls)은 읽지 못해요. 엑셀에서 .xlsx나 CSV로 저장해 주세요."
        : `${file.name}을(를) 읽지 못했어요. 엑셀(.xlsx)이나 CSV 파일인지 확인해 주세요.`);
    }
  }
  /* 양식 내려받기: 파일도 브라우저 안에서 만든다. 서버에 정적 파일을 두면 양식과
   * 읽기 규칙이 따로 놀 수 있어, 읽는 코드와 같은 자리에서 만든다. */
  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([buildRosterTemplate() as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const link = document.createElement("a");
    link.href = url; link.download = "위글-명단-양식.xlsx";
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setFileNotice("양식을 내려받았어요. 번호와 이름을 채운 뒤 다시 불러오면 돼요.");
  }
  // 복사는 lib/copy-text 한 경로만 쓴다. 화면마다 따로 만들면 비보안 맥락 폴백이 한쪽에만 남는다.
  // 성공하면 누른 단추가 체크로 바뀌고, 실패만 안내 줄로 알린다(useCopyFeedback).
  const { copiedKey, copiedLabel, copy } = useCopyFeedback(setNotice);
  async function action(key: string, rest?: Record<string, unknown>) { if (pending) return; setPending(key); const result = await onAction(key, rest); setPending(""); if (result) setNotice("변경 사항을 저장했어요."); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setError("");
    if (dialog === "add" && (parsed.errors.length || !parsed.entries.length)) { setError(parsed.errors[0] ?? "번호와 이름을 입력해 주세요."); return; }
    setBusy(true);
    const result = dialog === "add" ? await onAction("addStudents", { roster: parsed.entries }) : await onAction("updateStudent", { studentId: dialog, seatNumber: Number(seat), realName: name.trim() });
    setBusy(false);
    if (result) { setDialog(null); setRows(blankRows(firstSeat)); setNotice("명단을 저장했어요."); } else setError("저장하지 못했어요. 번호가 중복되지 않았는지 확인해 주세요. 입력 내용은 그대로 남아 있어요.");
  }
  return <section className="trs" aria-label="명단과 설정">
    <header className="trs-intro"><h2>명단 · 설정</h2><p>우리 반 학생과 입장 정보를 관리해요.</p></header>
    <div className="trs-layout"><section className="trs-roster"><header className="trs-heading"><div><h2>우리 반 명단 <small>{students.length}명</small></h2><p>학생 이름은 선생님에게만 보여요.</p></div><div className="trs-heading-actions"><button type="button" className="tcw-secondary" onClick={() => setPrintOpen(true)} disabled={!students.length}><Printer size={18} />코드표 인쇄</button><button className="tcw-primary" onClick={openAddDialog}><Plus size={18} />학생 추가</button></div></header>
      <label className="trs-search"><Search size={18} /><span className="sr-only">번호, 이름 또는 별명으로 학생 검색</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="번호, 이름 또는 별명 검색" /></label>
      <div className="trs-table-wrap"><table className="trs-table"><thead><tr><th>번호</th><th>이름</th><th>참여 코드</th><th>별명</th><th>첫 입장</th><th>관리</th></tr></thead><tbody>{filtered.map((student) => <tr key={student.id}><td>{student.seatNumber ?? "—"}</td><td><b>{student.realName ?? "이름 미등록"}</b></td><td><span className="trs-entry-code"><code>{student.entryCode ?? "—"}</code>{student.entryCode && <button type="button" aria-label={`${student.realName ?? student.nickname} 참여 코드 복사`} onClick={() => void copy(student.entryCode ?? "", "참여 코드", `code-${student.id}`)}>{copiedKey === `code-${student.id}` ? <Check size={14} className="trs-copied" /> : <Copy size={14} />}</button>}<button type="button" aria-label={`${student.realName ?? student.nickname} 참여 코드 새로 뽑기`} disabled={Boolean(pending)} onClick={() => { if (confirm(`${student.realName ?? student.nickname}의 참여 코드를 새로 뽑을까요?\n\n지금 코드는 바로 못 쓰게 돼요. 그림과 별명은 그대로예요.`)) void action("rotateEntryCode", { studentId: student.id }); }}><RefreshCw size={14} /></button></span></td><td>{student.claimedAt ? student.nickname : "아직 미정"}</td><td><span className={`trs-entry ${student.claimedAt ? "is-claimed" : ""}`}>{student.claimedAt ? "입장 완료" : "입장 전"}</span></td><td><div className="trs-row-actions"><button type="button" aria-label={`${student.realName ?? student.nickname} 번호·이름 수정`} onClick={() => { setError(""); setSeat(String(student.seatNumber ?? "")); setName(student.realName ?? ""); setDialog(student.id); }}>수정</button><details><summary aria-label={`${student.realName ?? student.nickname} 더 보기`}><MoreHorizontal size={18} /></summary><button className="trs-danger" disabled={busyStudentId === student.id} onClick={() => onArchive(student.id)}>{busyStudentId === student.id ? "처리 중…" : "학생 삭제"}</button></details></div></td></tr>)}</tbody></table></div>
      {!filtered.length && <p className="trs-empty">{students.length ? "검색한 학생을 찾지 못했어요." : "학생을 추가해 명단을 만들어 주세요."}</p>}
      <details className="trs-disclosure"><summary>삭제한 학생 {archivedStudents.length}명</summary><p>학생을 복원하면 보관된 작품도 다시 볼 수 있어요.</p>{archivedStudents.map((student) => <div className="trs-archived" key={student.id}><span><b>{student.seatNumber} {student.realName ?? student.nickname}</b><small>작품 {student.artworkCount}개 보관</small></span><button disabled={busyStudentId === student.id} onClick={() => onRestore(student.id)}>{busyStudentId === student.id ? "처리 중…" : "복원"}</button></div>)}</details>
    </section>
    <aside className="trs-settings"><section><h2>입장 관리</h2><div className="trs-admission"><span className={`trs-entry ${room.admissionOpen ? "is-claimed" : ""}`}>{room.admissionOpen ? "입장 열림" : "입장 닫힘"}</span><button disabled={Boolean(pending)} onClick={() => void action("toggleAdmission", { open: !room.admissionOpen })}>{pending === "toggleAdmission" ? "변경 중…" : room.admissionOpen ? "입장 닫기" : "입장 열기"}</button></div><div className="trs-code"><span>수업 코드</span><strong>{room.classCode}</strong><button aria-label="수업 코드 복사" onClick={() => void copy(room.classCode, "수업 코드", "class-code")}>{copiedKey === "class-code" ? <Check size={18} className="trs-copied" /> : <Copy size={18} />}</button></div><div className="trs-entry-actions"><button aria-label="입장 주소 복사" onClick={() => void copy(`${location.origin}/join/${room.classCode}`, "입장 주소", "join-url")}>{copiedKey === "join-url" ? <><Check size={16} className="trs-copied" />복사됨</> : <><Copy size={16} />입장 주소 복사</>}</button><button onClick={(event) => onQr(event.currentTarget)}><QrCode size={17} />QR 보기</button></div><div className="trs-entry-actions"><button disabled={Boolean(pending)} onClick={() => void action("clearEntryLocks")} title="코드를 여러 번 잘못 넣어 잠긴 기기를 모두 풀어 줍니다">{pending === "clearEntryLocks" ? "푸는 중…" : "입장 잠금 풀기"}</button></div><details className="trs-disclosure"><summary>수업 코드 변경</summary><p>변경하면 기존 코드와 QR로 입장할 수 없어요.</p><button disabled={Boolean(pending)} onClick={() => { if (confirm("수업 코드를 바꿀까요? 기존 코드와 QR은 더 이상 사용할 수 없어요.")) void action("rotateCode"); }}>{pending === "rotateCode" ? "변경 중…" : "새 코드 발급"}</button></details></section>
      <details className="trs-disclosure"><summary>가족 공유 링크 <small>{familyLinks.length}개</small></summary><p>작품을 열어 보호자 동의를 확인한 뒤 링크를 만들 수 있어요.</p>{familyLinks.map((link) => { const expired = new Date(link.expiresAt).getTime() < now; const student = students.find((entry) => entry.id === link.studentId); return <div className="trs-family" key={link.id}><b>{student?.realName ?? student?.nickname ?? "삭제한 학생"} · 작품 {link.artworkCount}개</b><small>{link.revokedAt ? "취소됨" : expired ? "만료됨" : `${new Date(link.expiresAt).toLocaleDateString("ko-KR")} 만료`}</small>{!link.revokedAt && !expired && <button disabled={Boolean(pending)} onClick={() => { if (confirm("이 가족 공유 링크를 취소할까요?")) void action("revokeFamilyShare", { linkId: link.id }); }}>링크 취소</button>}</div>; })}{!familyLinks.length && <p>아직 발급한 링크가 없어요.</p>}</details>
      <section className="trs-delete"><h3>학급 삭제</h3><p>학급과 학생의 접근이 종료되며 되돌릴 수 없어요.</p><button className="trs-danger" disabled={deletingClassroom} onClick={onDeleteClassroom}>{deletingClassroom ? "삭제 중…" : "학급 삭제"}</button></section>
    </aside></div>
    {printOpen && <WorkspaceDialog title="참여 코드표 인쇄" onClose={() => setPrintOpen(false)}>
      <div className="roster-print-actions no-print">
        <p>미리 보고 인쇄해요. 첫 장은 선생님 보관용 명단, 둘째 장은 잘라서 나눠 줄 쪽지예요.</p>
        <button type="button" className="tcw-primary" onClick={() => window.print()}><Printer size={18} />인쇄하기</button>
      </div>
      <TeacherRosterPrint classroomName={room.displayName} classCode={room.classCode} joinUrl={joinUrl} students={students} />
    </WorkspaceDialog>}
    <p className="sr-only" role="status">{copiedLabel ? `${copiedLabel}를 복사했어요.` : ""}</p>
    {notice && <div className="trs-notice" role="status">{notice}<button aria-label="알림 닫기" onClick={() => setNotice("")}>닫기</button></div>}
    {dialog && <WorkspaceDialog title={dialog === "add" ? "명단에 학생 추가" : "번호·이름 수정"} onClose={() => { if (!busy) { setDialog(null); setFileNotice(""); } }}><form onSubmit={save}>{dialog === "add" ? <><div className="trs-import"><label className="trs-import-button"><Upload size={18} />엑셀·CSV 파일 불러오기<input type="file" accept=".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void importFile(file); }} /></label><small>엑셀에서 표를 복사해 이름 칸에 붙여 넣어도 돼요.</small><button type="button" className="trs-template-button" onClick={downloadTemplate}><Download size={15} />엑셀 양식 내려받기</button></div>{fileNotice && <p className="trs-import-notice" role="status">{fileNotice}</p>}
      <div className="trs-rows" role="group" aria-label="학생 번호와 이름">
        <div className="trs-rows-head" aria-hidden="true"><span>번호</span><span>이름</span><span /></div>
        {rows.map((row, index) => <div className="trs-row" key={index}>
          <input className="trs-row-seat" type="number" inputMode="numeric" min={1} max={MAX_SEAT_NUMBER} aria-label={`${index + 1}번째 학생 번호`} value={row.seat} onChange={(event) => { setFileNotice(""); editRow(index, { seat: event.target.value }); }} />
          <input className="trs-row-name" maxLength={MAX_REAL_NAME_LENGTH} aria-label={`${index + 1}번째 학생 이름`} value={row.name} spellCheck={false}
            onChange={(event) => { setFileNotice(""); editRow(index, { name: event.target.value }); }}
            onPaste={(event) => { const text = event.clipboardData.getData("text"); if (pasteRows(index, text)) { event.preventDefault(); setFileNotice(""); } }} />
          <button type="button" className="trs-row-remove" aria-label={`${index + 1}번째 줄 지우기`} disabled={rows.length < 2} onClick={() => setRows((current) => current.filter((_, at) => at !== index))}><X size={16} /></button>
        </div>)}
      </div>
      <div className="trs-rows-foot"><button type="button" className="trs-row-add" onClick={() => setRows((current) => [...current, ...blankRows(seatAfter(current, firstSeat), 1)])}><Plus size={15} />학생 한 명 더</button><small>{parsed.entries.length > 0 ? `${parsed.entries.length}명 확인` : "번호와 이름을 칸에 적어 주세요."}</small></div>{parsed.errors.length > 0 && <ul className="tcw-error">{parsed.errors.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>}</> : <><label>번호<input type="number" min={1} max={99} required value={seat} onChange={(event) => setSeat(event.target.value)} /></label><label>이름<input required maxLength={20} value={name} onChange={(event) => setName(event.target.value)} /></label></>}<p className="trs-privacy">이름은 선생님만 볼 수 있어요. 학생 화면, 가족 공유, AI에는 전달되지 않아요.</p>{error && <p className="tcw-error" role="alert">{error}</p>}<div className="trs-form-actions"><button type="button" disabled={busy} onClick={() => setDialog(null)}>취소</button><button className="tcw-primary" disabled={busy || (dialog === "add" && (!parsed.entries.length || parsed.errors.length > 0))}>{busy ? "저장 중…" : "저장"}</button></div></form></WorkspaceDialog>}
  </section>;
}
