export type StudentEntryResponse = {
  error?: string;
  code?: "NO_ROSTER" | "ENTRY_CODE" | "ENTRY_LOCKED";
  /* 코드를 거듭 틀려 이 기기가 쉬는 중일 때 남은 초. */
  retryAfterSeconds?: number;
  /* 잠기기까지 남은 시도 횟수. 아이가 갑자기 막히지 않고 미리 알 수 있게 한다. */
  attemptsLeft?: number;
  classroomName?: string;
  hasProfiles?: boolean;
  /* 선생님이 명단을 만든 학급인지. 명단 내용(번호·이름·코드 목록)은 서버가 절대 주지 않는다. */
  hasRoster?: boolean;
  /* 참여 코드는 맞지만 아직 아무도 들어오지 않은 자리 — 동물을 고르면 자리가 채워진다. */
  firstTime?: boolean;
  student?: { id: string; nickname: string; animal: string; classroomName: string };
  deviceToken?: string;
  expiresAt?: string;
};

export class StudentEntryResponseError extends Error {}

export type EntryErrorKind = "code" | "locked" | "general";

// 아이가 스스로 복구할 행동을 고르기 위한 실패 분류:
// code → 수업 코드나 참여 코드가 틀림(선생님 불러요), locked → 여러 번 틀려 쉬는 중,
// 그 밖은 일반 오류(다시 해 보기).
export function classifyEntryError(status: number, code?: string): EntryErrorKind {
  if (code === "ENTRY_LOCKED") return "locked";
  return status === 404 ? "code" : "general";
}

/* 입장 잠금은 기기 단위다(2026-09-21). 학교는 반 전체가 공인 IP 하나를 쓰기 때문에
 * IP로 잠그면 한 아이 때문에 교실이 함께 막힌다. 이 값은 이 브라우저에만 남는다. */
const DEVICE_KEY_STORAGE = "wiggle.entryDevice.v1";
export function entryDeviceKey() {
  try {
    const known = localStorage.getItem(DEVICE_KEY_STORAGE);
    if (known && /^[A-Za-z0-9_-]{8,64}$/.test(known)) return known;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const made = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(DEVICE_KEY_STORAGE, made);
    return made;
  } catch {
    // 저장소를 못 쓰는 브라우저에서도 입장 자체는 막지 않는다. 그때는 IP·학급 상한만 남는다.
    return "";
  }
}

export async function readStudentEntryResponse(response: Response): Promise<StudentEntryResponse> {
  try {
    const value = JSON.parse(await response.text()) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid response shape");
    return value as StudentEntryResponse;
  } catch {
    throw new StudentEntryResponseError(
      response.ok
        ? "입장 응답을 확인하지 못했어요. 잠시 뒤 다시 해 주세요."
        : "입장 서버가 잠시 응답하지 않아요. 잠시 뒤 다시 해 주세요.",
    );
  }
}
