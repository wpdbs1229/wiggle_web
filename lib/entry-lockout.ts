/* 입장 코드를 거듭 틀렸을 때 그 **기기만** 잠깐 쉬게 한다 (2026-09-21 사용자 결정).
 *
 * 왜 IP가 아니라 기기인가: 학교는 반 전체가 공인 IP 하나를 함께 쓴다. IP로 잠그면
 * 한 아이가 다섯 번 틀렸을 때 같은 교실 스물아홉 명이 함께 못 들어간다. 수업 시작 직후처럼
 * 모두가 동시에 코드를 넣는 순간에 가장 잘 터진다. 그래서 잠금 단위는 기기다.
 *
 * 기기 식별자는 브라우저가 만들어 보내는 임의 문자열이다. 지우면 초기화되므로 완벽하지 않다.
 * 그 빈틈은 기존 IP·학급 상한(180회/10분, 학급+IP 60회/10분)이 뒤에서 받친다.
 * 이 잠금은 "찍어 맞추기를 느리게" 하는 장치이지 단독 방벽이 아니다.
 *
 * 수업 코드와 아이 참여 코드 **둘 다** 여기로 들어온다. 둘을 따로 세면 공격자가
 * 번갈아 찍어 두 배로 시도할 수 있다.
 */

/* 잠기기까지 필요한 실패 횟수. 세 번 잠긴 뒤부터는 세 번만 틀려도 잠근다 —
 * 거기까지 갔으면 실수가 아니라 찍고 있을 가능성이 크다(2026-09-22 사용자 결정). */
export const ENTRY_FAIL_LIMIT = 5;
export const ENTRY_FAIL_LIMIT_LATE = 3;
export function failLimitFor(strikes: number) {
  return strikes >= 3 ? ENTRY_FAIL_LIMIT_LATE : ENTRY_FAIL_LIMIT;
}
/* 첫 잠금은 짧게, 되풀이되면 길게. 실수한 아이는 금방 다시 하고, 찍는 쪽은 비용이 커진다.
 * 3분 고정은 교실에서 너무 길다는 판단(2026-09-21). 첫 칸은 시안대로 20초다(2026-09-22 사용자 결정).
 * 5번 → 20초, 5번 → 1분, 5번 → 3분, 그 뒤로는 3번 → 10분. */
export const ENTRY_LOCK_STEPS_SECONDS = [20, 60, 180, 600] as const;
/* 한참 뒤에 다시 틀린 것은 새 실수다 — 이 시간 동안 아무 일이 없으면 단계를 처음으로 되돌린다.
 * 없으면 아침에 한 번 잠긴 아이가 오후에 첫 실수로 3분을 기다린다(2026-09-22 사용자 보고).
 * 5분으로 잡았다(2026-09-22 사용자 결정) — 실수하는 아이는 거의 20초만 겪고,
 * 쉬지 않고 찍는 쪽에는 단계가 그대로 쌓인다. */
export const ENTRY_STRIKE_RESET_SECONDS = 5 * 60;
/** 기기 식별자는 이 길이 범위의 안전한 글자만 받는다. 키 자체가 저장소 키가 되므로 좁게 잡는다. */
const DEVICE_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function normalizeDeviceKey(value: unknown) {
  return typeof value === "string" && DEVICE_KEY_PATTERN.test(value) ? value : "";
}

/** 몇 번째 잠금인지에 따라 쉬는 시간을 고른다. 마지막 칸을 넘으면 그 값에서 멈춘다. */
export function lockSecondsFor(strikes: number) {
  const at = Math.min(Math.max(strikes, 1), ENTRY_LOCK_STEPS_SECONDS.length) - 1;
  return ENTRY_LOCK_STEPS_SECONDS[at];
}

/** 마지막 기록이 오래됐으면 단계를 처음으로 되돌린다. */
export function decayedStrikes(strikes: number, updatedAt: string | null, now = Date.now()) {
  if (!updatedAt) return strikes;
  const idleSeconds = (now - Date.parse(updatedAt)) / 1000;
  return idleSeconds >= ENTRY_STRIKE_RESET_SECONDS ? 0 : strikes;
}

export function lockRemainingSeconds(lockedUntil: string | null, now = Date.now()) {
  if (!lockedUntil) return 0;
  const left = Math.ceil((Date.parse(lockedUntil) - now) / 1000);
  return left > 0 ? left : 0;
}

/** 아이에게 보여 줄 문구. 분과 초를 섞지 않는다 — 글을 더듬는 아이에게는 한 덩어리가 낫다. */
export function lockMessage(remainingSeconds: number) {
  if (remainingSeconds >= 60) {
    const minutes = Math.ceil(remainingSeconds / 60);
    return `코드를 여러 번 잘못 넣었어요. ${minutes}분 뒤에 다시 해 봐요. 선생님을 불러도 돼요.`;
  }
  return `코드를 여러 번 잘못 넣었어요. ${Math.max(remainingSeconds, 1)}초 뒤에 다시 해 봐요. 선생님을 불러도 돼요.`;
}
