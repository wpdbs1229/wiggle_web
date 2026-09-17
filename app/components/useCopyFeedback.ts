"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { copyNoticeText, copyText } from "@/lib/copy-text";

/**
 * 복사 성공은 누른 그 단추 자리에서 체크(✓)로 알린다 (2026-09-17 사용자 요청 —
 * 화면 다른 곳에 "복사했어요" 줄이 뜨는 것보다 누른 자리가 바뀌는 편이 읽기 쉽다).
 *
 * 실패는 여전히 글로 알려야 한다. 교실 태블릿의 비보안 맥락(http://10.0.0.5:3000)에서는
 * 클립보드가 조용히 실패해, 아무 표시가 없으면 교사가 눌린 줄 안다(2026-09-13 신고).
 */
export function useCopyFeedback(onFailure: (message: string) => void, resetMs = 1800) {
  const [copied, setCopied] = useState<{ key: string; label: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string, label: string, key = label) => {
    const ok = await copyText(text);
    window.clearTimeout(timer.current);
    if (!ok) {
      setCopied(null);
      onFailure(copyNoticeText(false, label));
      return false;
    }
    // 앞선 실패 안내가 남아 있으면 지운다 — 성공한 화면에 실패 문구가 함께 보이면 안 된다.
    onFailure("");
    setCopied({ key, label });
    timer.current = window.setTimeout(() => setCopied(null), resetMs);
    return true;
  }, [onFailure, resetMs]);

  return { copiedKey: copied?.key ?? "", copiedLabel: copied?.label ?? "", copy };
}
