import "server-only";
import { runtimeEnvironment } from "@/lib/runtime/environment";
export function printEnvironment() { return process.env.SWEETBOOK_ENV === "live" ? "live" : "sandbox"; }
export function printConfigured() { return Boolean(process.env.SWEETBOOK_API_KEY?.trim()); }
export function assertPrintEnvironment() {
  if (printEnvironment() === "live" && (runtimeEnvironment() !== "production" || process.env.SWEETBOOK_LIVE_ORDERS_ENABLED !== "true")) throw new Error("실주문은 운영 환경에서 SWEETBOOK_LIVE_ORDERS_ENABLED=true로 설정한 뒤 사용할 수 있어요.");
}
export class SweetbookError extends Error {
  status: number;
  constructor(status: number) { super(`스위트북 연결 오류(${status}). 파트너 포털에서 키·잔액·제작 규격을 확인해 주세요.`); this.status = status; }
}
export async function sweetbook<T>(path: string, options: { method?: string; body?: unknown; file?: Uint8Array; key?: string; fetchImpl?: typeof fetch } = {}): Promise<T> {
  assertPrintEnvironment();
  const apiKey = process.env.SWEETBOOK_API_KEY?.trim();
  if (!apiKey) throw new Error("SWEETBOOK_API_KEY를 서버 환경 변수에 넣어 주세요.");
  const base = printEnvironment() === "live" ? "https://api.sweetbook.com/v1" : "https://api-sandbox.sweetbook.com/v1";
  const headers: Record<string, string> = { authorization: `Bearer ${apiKey}` };
  let body: BodyInit | undefined;
  if (options.file) { const form = new FormData(); form.append("file", new Blob([new Uint8Array(options.file)], { type: "application/pdf" }), "book.pdf"); body = form; }
  else if (options.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(options.body); }
  if (options.key) headers["Idempotency-Key"] = options.key;
  const response = await (options.fetchImpl ?? fetch)(`${base}${path}`, { method: options.method ?? "GET", headers, body, signal: AbortSignal.timeout(45_000), redirect: "error", cache: "no-store" });
  if (!response.ok) throw new SweetbookError(response.status);
  const payload = await response.json() as { success: boolean; data: T };
  if (!payload.success || payload.data == null) throw new Error("스위트북 응답을 확인하지 못했어요.");
  return payload.data;
}
