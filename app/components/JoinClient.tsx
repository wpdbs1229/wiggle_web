"use client";

import { useEffect, useRef, useState } from "react";
import { storeProfile } from "@/lib/client-session";
import { classifyEntryError, EntryErrorKind, readStudentEntryResponse, StudentEntryResponseError, entryDeviceKey } from "@/lib/student-entry-client";
import { Clock as ClockIcon } from "lucide-react";
import { Logo } from "./Logo";
import { WaitMongri } from "./WaitMongri";
import check from "./EntryCheck.module.css";

import { ANIMAL_CHARACTERS, withGwaWa } from "@/lib/animal-characters";
import { entryPathFor, parseEntryQr, readEntryHash } from "@/lib/qr-entry";
import { QrScanner } from "./QrScanner";

export const ENTRY_CODE_LENGTH = 4;
const PICK_PAGE_SIZE = 10;
/* 입장은 두 단계다: 반을 정하고(QR이 기본, 못 쓰면 수업 코드 4자리) 아이 참여 코드 4자리를 누른다.
 * 코드가 곧 그 아이의 자리라, 다음 시간에 같은 코드를 넣으면 같은 아이로 돌아온다.
 * 참여 코드는 2026-09-12에 네 자리로 줄였다 — 여섯 자리는 아이가 누르기 벅찼다. */
type Mode = "checking" | "code" | "animal" | "noRoster";

export function JoinClient({ initialEntry = "" }: { initialEntry?: string }) {
  const [mode, setMode] = useState<Mode>("checking");
  const [classroomName, setClassroomName] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [animal, setAnimal] = useState("");
  const [error, setError] = useState("");
  const [errorKind, setErrorKind] = useState<EntryErrorKind | "">("");
  // 잠기기까지 몇 번 남았는지. 갑자기 막히지 않고 미리 알 수 있게 한다(2026-09-21 사용자 요청).
  const [attemptsLeft, setAttemptsLeft] = useState(-1);
  /* 잠금 시계는 "만료 시각"에서 매번 다시 계산한다(GPT 인계 STATE-SPEC 2026-09-22).
   * 매초 1씩 빼면 탭이 뒤로 갔다 오거나 타이머가 밀릴 때 실제 시각과 어긋난다. */
  const [lockUntil, setLockUntil] = useState(0);
  const [lockTotal, setLockTotal] = useState(0);
  const [lockLeft, setLockLeft] = useState(0);
  const [lockDone, setLockDone] = useState(false);
  useEffect(() => {
    if (!lockUntil) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
      setLockLeft(left);
      if (left === 0) {
        // 끝나면 안내를 걷고 "이제 된다"고 한 번만 알린다. 자동으로 다시 보내지 않는다.
        setLockUntil(0); setLockDone(true); clearEntryError();
      }
    };
    tick();
    const timer = window.setInterval(tick, 500);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [lockUntil]);
  const [teacherCallOpen, setTeacherCallOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  // 아이별 쪽지 QR(`#entry=1234`)로 들어오면 반 확인이 끝난 뒤 이 코드로 곧바로 입장한다.
  const pendingEntryCode = useRef<string | null>(null);
  // 첫 입장이 확인된 참여 코드. 친구 고르기 뒤 다시 제출할 때 이 코드를 쓴다 — 그 사이 반 확인이
  // 다시 돌면 codeInput이 비워져 "참여 코드 네 자리를 눌러 주세요"로 막혔다(2026-09-13 실측).
  const claimCode = useRef("");
  // 친구 고르기 쪽 넘기기(2026-09-14, 20종). 쪽 번호는 가로 스크롤 위치에서 읽는다 — 손가락으로 밀어도 맞는다.
  const [pickPage, setPickPage] = useState(0);
  const pagesRef = useRef<HTMLDivElement>(null);
  const entry = initialEntry;

  useEffect(() => {
    setCodeInput(""); setAnimal(""); setError(""); setErrorKind(""); setTeacherCallOpen(false);
    // 참여 코드는 주소 조각에만 온다. 서버로는 원래 안 가지만, 주소창과 방문 기록에 남지 않도록
    // 어떤 네트워크 호출보다 먼저 지운다. replaceState라 뒤로 가기 기록에도 남지 않는다.
    const fromHash = readEntryHash(location.hash);
    if (location.hash) history.replaceState(history.state, "", location.pathname + location.search);
    // 개발 모드(StrictMode)는 이 효과를 두 번 돌린다. 두 번째에는 조각이 이미 지워져 null이므로
    // 덮어쓰면 받아 둔 코드가 사라진다(2026-09-13 실측). 코드가 있을 때만 저장한다.
    if (fromHash) pendingEntryCode.current = fromHash;
    if (!initialEntry) { location.replace("/"); return; }
    void checkEntry();
  // checkEntry only reads the stable entry prop. Keeping it outside this dependency list
  // prevents a status response from retriggering itself through mode changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEntry]);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted || !initialEntry) return;
      setCodeInput(""); setAnimal(""); setMode("checking"); void checkEntry();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEntry]);

  // 이미 이 반 화면에 있는데 태블릿 카메라로 쪽지 QR을 찍으면, 경로는 같고 조각만 바뀌어
  // 페이지가 다시 읽히지 않는다(같은 문서 이동). 그러면 위의 마운트 처리가 돌지 않으므로
  // 조각 변화를 따로 받는다. 읽자마자 지우는 규칙은 같다.
  useEffect(() => {
    const onHashChange = () => {
      if (!location.hash) return;
      const code = readEntryHash(location.hash);
      history.replaceState(history.state, "", location.pathname + location.search);
      if (!code) return;
      if (mode === "code") { setCodeInput(code); void submit("", code); }
      else pendingEntryCode.current = code;
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  // submit은 코드를 인자로 받으므로 옛 codeInput을 붙잡지 않는다. 화면 단계만 따라가면 된다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function checkEntry() {
    setBusy(true); setError(""); setErrorKind(""); setTeacherCallOpen(false);
    try {
      const response = await fetch("/api/student", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "entryStatus", entry }), cache: "no-store" });
      const data = await readStudentEntryResponse(response);
      if (!response.ok) {
        setErrorKind(classifyEntryError(response.status));
        throw new StudentEntryResponseError(data.error ?? "수업을 확인하지 못했어요.");
      }
      setClassroomName(data.classroomName ?? "우리 반");
      setCodeInput("");
      // 명단이 없으면 아이가 할 수 있는 일이 없다. 선생님을 부르도록 안내한다.
      setMode(data.hasRoster ? "code" : "noRoster");
      const scanned = pendingEntryCode.current;
      pendingEntryCode.current = null;
      if (data.hasRoster && scanned) { setCodeInput(scanned); void submit("", scanned); }
    } catch (cause) {
      setError(cause instanceof StudentEntryResponseError ? cause.message : "수업을 확인하는 중 연결이 끊겼어요. 다시 시도해 주세요.");
    } finally { setBusy(false); }
  }

  function clearEntryError() {
    setError(""); setErrorKind(""); setTeacherCallOpen(false);
  }

  function backToCode() {
    clearEntryError(); setAttemptsLeft(-1); setAnimal(""); setCodeInput(""); claimCode.current = ""; setMode("code");
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }

  // code를 따로 받는 이유: QR로 채운 직후에는 setCodeInput이 아직 반영되지 않았다.
  async function submit(chosenAnimal = "", code = codeInput) {
    if (code.length !== ENTRY_CODE_LENGTH) { setError("참여 코드 네 자리를 눌러 주세요."); setErrorKind("general"); return; }
    clearEntryError(); setLockDone(false); setBusy(true);
    let failureKind: EntryErrorKind = "general";
    try {
      const response = await fetch("/api/student", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "join", entry, entryCode: code, deviceKey: entryDeviceKey(), ...(chosenAnimal ? { animal: chosenAnimal } : {}) }), cache: "no-store" });
      const data = await readStudentEntryResponse(response);
      failureKind = classifyEntryError(response.status, data.code);
      if (data.retryAfterSeconds) { setLockUntil(Date.now() + data.retryAfterSeconds * 1000); setLockTotal(data.retryAfterSeconds); setLockDone(false); }
      setAttemptsLeft(typeof data.attemptsLeft === "number" ? data.attemptsLeft : -1);
      if (!response.ok) throw new StudentEntryResponseError(data.error ?? "입장할 수 없어요.");
      // 코드는 맞는데 처음이면 동물 하나만 고른다. 별명은 서버가 동물에 맞춰 붙인다.
      if (data.firstTime) { claimCode.current = code; setMode("animal"); requestAnimationFrame(() => window.scrollTo(0, 0)); return; }
      if (!data.student || !data.deviceToken || !data.expiresAt) throw new StudentEntryResponseError(data.error ?? "입장할 수 없어요.");
      storeProfile({ studentId: data.student.id, nickname: data.student.nickname, animal: data.student.animal, classroomName: data.student.classroomName, deviceToken: data.deviceToken, expiresAt: data.expiresAt });
      location.replace("/student");
    } catch (cause) {
      setError(cause instanceof StudentEntryResponseError ? cause.message : "입장 중 연결을 확인하지 못했어요. 잠시 뒤 다시 해 주세요.");
      setErrorKind(failureKind);
    } finally { setBusy(false); }
  }

  // 참여 코드 화면에서 찍은 QR. 아이별 쪽지 QR만 쓸모가 있다 — 반 QR에는 참여 코드가 없다.
  function handleScan(text: string) {
    setScanning(false);
    const qr = parseEntryQr(text);
    if (!qr) { setError("Wiggle 수업 QR이 아니에요. 내 쪽지의 QR을 찍어 주세요."); setErrorKind("general"); return; }
    if (!qr.entryCode) { setError("이 QR에는 내 참여 코드가 없어요. 내 쪽지의 QR을 찍어 주세요."); setErrorKind("general"); return; }
    // 지금 들어온 반의 쪽지면 바로 입장한다. 주소 조각만 바뀌는 이동은 페이지를 다시 읽지 않아
    // 조각 처리가 돌지 않으므로, 같은 반은 여기서 직접 제출한다.
    if (qr.classCode === entry) { setCodeInput(qr.entryCode); void submit("", qr.entryCode); return; }
    // 다른 반 쪽지면 그 반부터 다시 확인한다(경로가 달라 실제로 다시 읽힌다).
    location.replace(entryPathFor(qr));
  }

  function errorNotice() {
    if (!error) return null;
    return <div className="entry-error-block">
      {/* 남은 횟수와 남은 시간은 오류 상자 **안**에 둔다. 줄을 따로 띄우면 화면이 갑자기 늘어나
          아래 단추가 156px 밀린다(2026-09-21 실측). 아이에게는 그 움직임이 부담이다. */}
      <div className="error-box child-error" role="alert">
        <span className="child-error-icon" aria-hidden="true">⚠️</span>
        <p>
          {error}
          {errorKind === "code" && attemptsLeft > 0 && <small className="entry-attempts-left">앞으로 {attemptsLeft}번 더 틀리면 잠깐 쉬어요.</small>}
        </p>
      </div>
      {(errorKind === "code" || errorKind === "locked") && !teacherCallOpen && <button type="button" className="button secondary full teacher-call-button" onClick={() => setTeacherCallOpen(true)}><span aria-hidden="true">🙋</span>선생님 불러요</button>}
      {(errorKind === "code" || errorKind === "locked") && teacherCallOpen && <div className="teacher-call-note" role="status"><span className="teacher-call-emoji" aria-hidden="true">🙋</span><p>손을 들고 선생님을 불러요.<br />참여 코드를 다시 알려 주실 거예요.</p></div>}
    </div>;
  }

  // 교실 장식. 배경이 아니라 독립 요소라 화면이 늘어나도 늘어나지 않고, 좁으면 CSS가 내려놓는다.
  const scenery = (
    <>
      <img className={`${check.scenery} ${check.sceneryLeft}`} src="/entry-green/scene/left-group.webp" alt="" aria-hidden="true" width="700" height="881" />
      <img className={`${check.scenery} ${check.sceneryRight}`} src="/entry-green/scene/right-group.webp" alt="" aria-hidden="true" width="392" height="571" />
    </>
  );

  if (mode === "checking") {
    const codeError = errorKind === "code";
    // 문구는 docs/design-assets/entry-green/README-CLAUDE.md의 확정 문구. 선생님 도움 버튼은 실제 메시지를 보내지 않고 손을 드는 안내다.
    // 대기 상태는 2026-09-09 사용자 시안: 크림 배경 + 선 너머로 고개 내민 몽그리 + 문구 두 줄만.
    if (!error) return <WaitMongri line="수업실을 준비하고 있어요" titleId="entry-check-title" />;
    const guidance = codeError ? "수업 코드가 맞는지 한 번만 더 확인해 줘." : "잠깐 연결이 어려운가 봐. 한 번 더 해 보자.";
    return <main className={`entry-check ${check.shell}`}>
      {scenery}
      <div className={check.stage}>
        <div className={check.head}>
          <div className={check.logo}><Logo /></div>
        </div>
        <span className={check.sign} aria-hidden="true">우리 반</span>
        <img className={check.duck} src="/landing-gallery/duck-painter-640.webp" alt="" aria-hidden="true" width="640" height="640" />
        <section className={check.panel} aria-labelledby="entry-check-title">
          <h1 id="entry-check-title">몽그리랑 다시 찾아보자!</h1>
          <p className={check.lead}>{guidance}</p>
          <div className={check.note}>
            <div className="error-box child-error" role="alert"><span className="child-error-icon" aria-hidden="true">⚠️</span><p>{codeError ? "수업을 아직 찾지 못했어요" : error}</p></div>
          </div>
          {error && <div className={check.actions}>
            {codeError
              ? <a className={check.primary} href="/">수업 코드 다시 입력하기</a>
              : <button type="button" className={check.primary} disabled={busy} onClick={() => void checkEntry()}>{busy ? "확인 중…" : "다시 확인하기"}</button>}
            {codeError && !teacherCallOpen && <button type="button" className={`${check.help} teacher-call-button`} onClick={() => setTeacherCallOpen(true)}><span aria-hidden="true">🙋</span>선생님 불러요</button>}
            {codeError && teacherCallOpen && <div className="teacher-call-note" role="status"><span className="teacher-call-emoji" aria-hidden="true">🙋</span><p>손을 들고 선생님을 불러요.<br />수업 코드를 다시 알려 주실 거예요.</p></div>}
            {codeError
              ? <button type="button" className={check.retry} disabled={busy} onClick={() => void checkEntry()}>{busy ? "확인 중…" : "다시 확인하기"}</button>
              : <a className={check.retry} href="/">수업 코드 다시 입력하기</a>}
          </div>}
        </section>
      </div>
    </main>;
  }

  if (mode === "code") {
    const pressKey = (digit: string) => { clearEntryError(); setCodeInput((current) => (current + digit).slice(0, ENTRY_CODE_LENGTH)); };
    const waiting = errorKind === "locked" && lockLeft > 0;
    const lockText = lockLeft >= 60 ? `${Math.ceil(lockLeft / 60)}분` : `${lockLeft}초`;
    // 코드가 틀린 경우만 연초록 안내로 바꾼다. 연결 오류 등은 기존 오류 상자가 맡는다.
    const codeErrorNotice = errorKind === "code";
    const lockRatio = lockTotal > 0 ? Math.max(0, Math.min(1, lockLeft / lockTotal)) : 0;
    /* 잠긴 동안에는 숫자판을 **치우고** 기다림 카드로 바꾼다(2026-09-22 사용자 시안).
     * 안내를 숫자판 아래에 덧붙이면 화면이 갑자기 늘어나 아래 단추가 밀린다 — 아이에게 부담이다.
     * 누를 수 없는 숫자판을 남겨 두면 계속 누르게 된다. */
    return <main className={`${check.shell} ${check.seatShell}`}>
      {scenery}
      <div className={`${check.stage} ${check.seatStage}`}>
        <div className={check.head}>
          <div className={check.logo}><Logo /></div>
        </div>
        {!waiting && <img className={check.duck} src="/landing-gallery/duck-painter-640.webp" alt="" aria-hidden="true" width="640" height="640" />}
        <div className={check.seatTitle}>
          <h1>내 참여 코드를 눌러요</h1>
          <p>선생님이 준 네 자리 숫자예요.</p>
        </div>
        <span className={check.padBadge}>{classroomName}</span>
        <div className={`entry-code-layout${waiting ? " is-waiting" : ""}`}>
        <section className={`code-card ${check.pad}`} aria-label="참여 코드 입력 수첩">
          <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <label className={check.padLabel} htmlFor="entry-code">내 참여 코드</label>
            <div className={check.display}>
              <input
                id="entry-code"
                className="entry-code-input"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={ENTRY_CODE_LENGTH}
                value={codeInput}
                aria-label="내 참여 코드"
                disabled={waiting}
                onChange={(event) => { setCodeInput(event.target.value.replace(/[^0-9]/g, "").slice(0, ENTRY_CODE_LENGTH)); clearEntryError(); }}
              />
            </div>
            <div className={check.keys} role="group" aria-label="숫자판">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => <button type="button" className={check.key} key={digit} disabled={waiting} onClick={() => pressKey(digit)}>{digit}</button>)}
              <span className={check.keyBlank} aria-hidden="true" />
              <button type="button" className={check.key} disabled={waiting} onClick={() => pressKey("0")}>0</button>
              <button type="button" className={`${check.key} ${check.keyErase}`} disabled={waiting} aria-label="한 자리 지우기" onClick={() => { clearEntryError(); setCodeInput((current) => current.slice(0, -1)); }}><span aria-hidden="true">⌫</span>지우기</button>
            </div>
            {/* 틀림이 쌓이는 동안(아직 안 잠김)은 시안 1의 연초록 안내다 — 빨간 경고 상자를 쓰지 않는다.
                잠기면 넓은 화면은 옆 카드(시안 3), 좁은 화면은 같은 줄 안내에 시간 칩만 더해 보여 준다.
                2026-09-22 사용자 지시: 쌓이는 화면은 1번, 잠긴 화면은 3번. */}
            {(waiting || codeErrorNotice) && <div className={`entry-wait-inline${waiting ? " is-locked" : ""}`}>
              <img src="/entry-green/mongri-waiting-face.webp" alt="" width={160} height={160} />
              <div className="entry-wait-inline-copy">
                <b>{waiting ? "잠깐만 기다려 줘" : "참여 코드가 맞는지 다시 확인해 봐"}</b>
                <span>{waiting ? "기다리는 동안 참여 코드를 확인해 봐." : attemptsLeft > 0 ? `앞으로 ${attemptsLeft}번 더 틀리면 잠깐 쉬어요.` : "선생님이 준 네 자리 숫자를 눌러 줘."}</span>
              </div>
              {waiting && <span className="entry-wait-chip"><ClockIcon size={16} />{lockText} 뒤 다시 입력할 수 있어요.</span>}
            </div>}
            {/* 코드가 틀렸을 때 선생님을 부를 길은 그대로 남긴다 — 연초록 안내로 바꾸면서 잃을 뻔했다
                (브라우저 실측이 잡음, 2026-09-22). 잠긴 동안에는 옆 카드/줄 안내가 같은 단추를 준다. */}
            {codeErrorNotice && !waiting && (teacherCallOpen
              ? <div className="teacher-call-note" role="status"><span className="teacher-call-emoji" aria-hidden="true">🙋</span><p>손을 들고 선생님을 불러요.<br />참여 코드를 다시 알려 주실 거예요.</p></div>
              : <button type="button" className={`${check.help} teacher-call-button`} onClick={() => setTeacherCallOpen(true)}><span aria-hidden="true">🙋</span>선생님 불러요</button>)}
            {/* 코드가 틀린 것 말고(연결 끊김 등)는 기존 오류 상자를 그대로 쓴다. */}
            {!waiting && !codeErrorNotice && errorNotice()}
            <button className={`${check.enter} child-primary-action`} disabled={waiting || busy || codeInput.length !== ENTRY_CODE_LENGTH}>{waiting ? "잠시 기다리는 중" : busy ? "확인 중…" : "들어가기"}</button>
          </form>
          {/* 누르기 어려운 아이는 쪽지의 QR을 찍어 바로 들어간다. */}
          <button type="button" className={`${check.scan} child-primary-action`} disabled={busy || waiting} onClick={() => { clearEntryError(); setScanning(true); }}><span aria-hidden="true">📷</span>내 쪽지 QR로 찍기</button>
          {!waiting && <a className={check.again} href="/">수업 코드 다시 입력하기</a>}
        </section>
        {/* 잠긴 동안 옆에 서는 안내 카드(2026-09-22 사용자 시안). 숫자판은 그대로 두되 잠근다 —
            치워 버리면 아이가 무엇을 기다리는지 잃고, 안내를 아래에 덧붙이면 화면이 늘어난다. */}
        {waiting && <aside className="entry-wait-panel">
          <p className="entry-wait-bubble">잠깐 기다리는 동안<br />선생님이 준 숫자를 확인해 봐.</p>
          <img className="entry-wait-mongri" src="/entry-green/mongri-waiting-desk.webp" alt="" width={760} height={563} />
          <p className="entry-wait-after">{lockText} 후에 다시 입력할 수 있어요.</p>
          {/* 총시간을 아는 경우에만 줄어드는 막대를 보인다 — 없으면 가짜 진행률을 만들지 않는다. */}
          {lockTotal > 0 && <div className="entry-wait-bar" aria-hidden="true"><div className="entry-wait-bar-track"><span style={{ width: `${Math.round(lockRatio * 100)}%` }} /></div><small>{lockText}</small></div>}
          {/* 실제로 메시지를 보내는 기능이 아니다 — 손을 들라고 알려 줄 뿐이라 이름도 그대로 둔다. */}
          {!teacherCallOpen
            ? <button type="button" className={`${check.help} teacher-call-button`} onClick={() => setTeacherCallOpen(true)}><span aria-hidden="true">🙋</span>선생님 불러요</button>
            : <div className="teacher-call-note" role="status"><span className="teacher-call-emoji" aria-hidden="true">🙋</span><p>손을 들고 선생님을 불러요.<br />참여 코드를 다시 알려 주실 거예요.</p></div>}
        </aside>}
        </div>
        {/* 대기에 들어갈 때와 끝날 때만 한 번씩 읽어 준다 — 매초 읽으면 소음이 된다. */}
        <p className="sr-only" role="status" aria-live="polite">{waiting ? "잠깐 기다려요. 곧 다시 입력할 수 있어요." : lockDone ? "이제 다시 입력할 수 있어요." : ""}</p>
        {lockDone && !waiting && <p className="entry-wait-ready" role="status">이제 다시 입력할 수 있어요.</p>}
      </div>
      {scanning && <QrScanner onResult={handleScan} onClose={() => setScanning(false)} hint="내 쪽지의 QR을 네모 안에 보여 줘" />}
    </main>;
  }

  if (mode === "animal") {
    // 첫 입장 친구 고르기(2026-09-13 사용자 시안, docs/design-assets/animal-picker/mockup-2026-09-13.png).
    // 고른 친구의 이름이 곧 별명이 된다 — 이름은 서버 기본 별명을 읽으므로 둘이 어긋나지 않는다.
    const chosen = ANIMAL_CHARACTERS.find((character) => character.emoji === animal);
    const pickPages = Array.from({ length: Math.ceil(ANIMAL_CHARACTERS.length / PICK_PAGE_SIZE) }, (_, index) => ANIMAL_CHARACTERS.slice(index * PICK_PAGE_SIZE, (index + 1) * PICK_PAGE_SIZE));
    const goToPickPage = (page: number) => { const el = pagesRef.current; if (el) el.scrollTo({ left: page * el.clientWidth }); };
    return <main className={check.pickShell}>
      {/* 장식(코덱스 그림 2026-09-14). 카드 격자 옆 여백이 있는 큰 화면에서만 보인다. */}
      <div className={check.pickDeco} aria-hidden="true">
        <img className={check.decoWriting} src="/entry-green/picker/handwriting.webp" alt="" />
        <img className={check.decoMongri} src="/landing-gallery/duck-painter-640.webp" alt="" />
        <img className={check.decoSun} src="/entry-green/picker/crayon-sun.webp" alt="" />
        <img className={check.decoRainbow} src="/entry-green/picker/crayon-rainbow.webp" alt="" />
        <img className={check.decoFlowers} src="/entry-green/picker/crayon-flowers.webp" alt="" />
      </div>
      <header className={check.pickTop}>
        <div className={check.pickLogo}><Logo /></div>
        <span className={check.pickClass}>{classroomName}</span>
      </header>
      <form className={check.pickBody} onSubmit={(event) => { event.preventDefault(); void submit(animal, claimCode.current || codeInput); }}>
        <div className={check.pickHead}>
          <h1 id="pick-title" className={check.pickTitle}>나랑 닮은 친구를 골라요</h1>
          <p className={check.pickLead}>마음에 드는 친구 하나를 골라 줘.</p>
        </div>
        <fieldset className={check.pickFieldset} aria-labelledby="pick-title">
          <legend className={check.pickHidden}>친구 고르기</legend>
          <div className={check.pickPager}>
            <button type="button" className={`${check.pickArrow} ${check.pickPrev}`} disabled={pickPage === 0} onClick={() => goToPickPage(pickPage - 1)} aria-label={`앞 친구들 보기 (${pickPage + 1}/${pickPages.length}쪽)`}>‹</button>
            {/* 쪽마다 5×2. 가로 스크롤 + 스냅이라 태블릿에서 밀어서 넘길 수 있다. 다른 쪽 카드에 초점이 가면 브라우저가 그 쪽으로 넘겨 준다. */}
            <div ref={pagesRef} className={check.pickPages} onScroll={(event) => { const el = event.currentTarget; setPickPage(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}>
              {pickPages.map((page, pageIndex) => <div key={pageIndex} className={check.pickGrid} aria-label={`${pageIndex + 1}쪽`} role="group">
                {page.map((character) => {
                  const selected = animal === character.emoji;
                  return <button type="button" key={character.emoji} className={check.pickCard} aria-pressed={selected} aria-label={`${character.name}, ${character.species}`} onClick={() => { setAnimal(character.emoji); clearEntryError(); }}>
                    {selected && <span className={check.pickCheck} aria-hidden="true">✓</span>}
                    <img className={check.pickImage} src={character.image} alt="" aria-hidden="true" width="512" height="512" loading="eager" />
                    <b className={check.pickName}>{character.name}</b>
                    <small className={check.pickSpecies}>{character.species}</small>
                  </button>;
                })}
              </div>)}
            </div>
            <button type="button" className={`${check.pickArrow} ${check.pickNext}`} disabled={pickPage >= pickPages.length - 1} onClick={() => goToPickPage(pickPage + 1)} aria-label={`다음 친구들 보기 (${pickPage + 1}/${pickPages.length}쪽)`}>›</button>
            <div className={check.pickDots} aria-hidden="true">
              {pickPages.map((_, pageIndex) => <span key={pageIndex} className={pageIndex === pickPage ? check.pickDotOn : check.pickDot} />)}
            </div>
          </div>
        </fieldset>
        {errorNotice()}
        <button className={`${check.pickStart} child-primary-action`} disabled={busy || !chosen}>
          {busy ? "들어가는 중…" : chosen ? <>{withGwaWa(chosen.name)} 시작하기 <span aria-hidden="true">›</span></> : "친구를 골라 줘"}
        </button>
        <button type="button" className={check.pickAgain} onClick={backToCode}>참여 코드 다시 누르기</button>
      </form>
    </main>;
  }

  // 명단이 아직 없는 반(2026-09-13 사용자 시안): 카드 없이 크림 바탕 + 고개 내민 몽그리 + 문구 + 버튼.
  // 몽그리 그림(peek-mongri)은 사용자 시안에서 잘라 왔다. 불투명 그림이라 배경이 시안과 같은 #fefaea여야
  // 경계가 보이지 않는다(원본: docs/design-assets/not-ready/mockup-2026-09-13.png).
  return <main className={check.readyShell}>
    <header className={check.readyTop}>
      <div className={check.readyLogo}><Logo /></div>
      <span className={check.readyClass}>{classroomName}</span>
    </header>
    <section className={check.readyBody} aria-labelledby="ready-title">
      <img className={check.readyMongri} src="/entry-green/peek-mongri.webp" alt="" aria-hidden="true" width="384" height="368" />
      <h1 id="ready-title" className={check.readyTitle}>아직 준비 중이에요</h1>
      <p className={check.readyLead}>선생님이 우리 반 명단을 넣으면<br />내 참여 코드로 들어올 수 있어요.</p>
      {error && <p className={check.readyError} role="alert">{error}</p>}
      <button type="button" className={`${check.readyRetry} child-primary-action`} disabled={busy} onClick={() => void checkEntry()}><span aria-hidden="true">🔄</span>{busy ? "확인 중…" : "다시 확인하기"}</button>
      <a className={check.readyAgain} href="/">수업 코드 다시 입력하기</a>
    </section>
  </main>;
}
