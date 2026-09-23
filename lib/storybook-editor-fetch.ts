import { studentFetch } from "@/lib/client-session";

export function storybookEditorFetch(path: string, init: RequestInit = {}) {
  if (!path.startsWith("/api/teacher/")) return studentFetch(path, init);
  const headers = new Headers(init.headers);
  if (typeof init.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(path, { ...init, headers, cache: "no-store" });
}
