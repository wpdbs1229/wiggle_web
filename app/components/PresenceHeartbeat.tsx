"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { studentFetch } from "@/lib/client-session";
export function PresenceHeartbeat() {
  const path = usePathname();
  useEffect(() => {
    if (!/^\/(student|teacher|admin)(\/|$)/.test(path)) return;
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      const send = path.startsWith("/student") ? studentFetch : fetch;
      void send("/api/presence", { method: "POST" }).catch(() => {});
    };
    ping(); const timer = setInterval(ping, 30_000);
    document.addEventListener("visibilitychange", ping);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", ping); };
  }, [path]);
  return null;
}
