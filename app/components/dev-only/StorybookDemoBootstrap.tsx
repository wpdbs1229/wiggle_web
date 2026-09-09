"use client";

import { useEffect, useRef, useState } from "react";
import { storeProfile, studentFetch, type ActiveDeviceProfile } from "@/lib/client-session";
import { emptyDocument } from "@/lib/drawing-model";
import { Logo } from "../Logo";

type DemoSession = {
  student?: { id: string; nickname: string; animal: string; classroomName: string };
  deviceToken?: string;
  expiresAt?: string;
  error?: string;
};

type ArtworkSummary = { id: string; title: string; status: string };
const DEMO_ARTWORK_TITLE = "몽그리와 떠나는 상상 여행 · 완성본";

async function demoDrawingPng() {
  const image = new Image();
  image.decoding = "async";
  image.src = "/brand/grimi-mascot.png";
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = 768;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("체험 그림을 준비하지 못했어요.");
  const gradient = context.createLinearGradient(0, 0, 1024, 768);
  gradient.addColorStop(0, "#DFF4FF"); gradient.addColorStop(1, "#FFF0C8");
  context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255,255,255,.78)";
  context.beginPath(); context.arc(150, 130, 82, 0, Math.PI * 2); context.fill();
  context.beginPath(); context.arc(880, 620, 118, 0, Math.PI * 2); context.fill();
  const scale = Math.min(650 / image.naturalWidth, 610 / image.naturalHeight);
  const width = image.naturalWidth * scale; const height = image.naturalHeight * scale;
  context.drawImage(image, (1024 - width) / 2, 118 + (520 - height) / 2, width, height);
  context.fillStyle = "#24324A"; context.textAlign = "center";
  context.font = "700 54px sans-serif"; context.fillText("몽그리와 떠나는 상상 여행", 512, 82);
  return canvas.toDataURL("image/png");
}

async function ensureCompletedArtwork(profile: ActiveDeviceProfile) {
  const listed = await studentFetch("/api/artworks", {}, profile);
  const listedData = await listed.json() as { artworks?: ArtworkSummary[]; error?: string };
  if (!listed.ok) throw new Error(listedData.error ?? "완성 그림을 찾지 못했어요.");
  const existing = (listedData.artworks ?? []).find((artwork) => artwork.status === "complete" && artwork.title === DEMO_ARTWORK_TITLE);
  if (existing) return existing;

  const created = await studentFetch("/api/artworks", {
    method: "POST",
    body: JSON.stringify({ learningMode: "free", title: DEMO_ARTWORK_TITLE, topic: "상상 친구", intent: "몽그리와 함께 새로운 이야기를 만들고 싶어요." }),
  }, profile);
  const createdData = await created.json() as { artwork?: ArtworkSummary; error?: string };
  if (!created.ok || !createdData.artwork) throw new Error(createdData.error ?? "체험 그림을 만들지 못했어요.");
  const finalDataUrl = await demoDrawingPng();
  const finalBlob = await (await fetch(finalDataUrl)).blob();
  const requestId = `demo_${crypto.randomUUID().replaceAll("-", "")}`;
  const uploaded = await studentFetch(`/api/artworks/${encodeURIComponent(createdData.artwork.id)}/image?kind=final&requestId=${encodeURIComponent(requestId)}`, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: finalBlob,
  }, profile);
  const uploadedData = await uploaded.json() as { key?: string; error?: string };
  if (!uploaded.ok || !uploadedData.key) throw new Error(uploadedData.error ?? "체험 그림 파일을 올리지 못했어요.");
  const completed = await studentFetch(`/api/artworks/${encodeURIComponent(createdData.artwork.id)}`, {
    method: "PUT",
    body: JSON.stringify({
      requestId,
      expectedRevision: 0,
      document: emptyDocument(),
      currentStep: 0,
      complete: true,
      finalImageKey: uploadedData.key,
      reflection: {
        favoritePart: "몽그리와 색이 만나는 부분",
        favoriteReason: "새로운 이야기가 시작될 것 같아서 마음에 들어요.",
        storyText: "몽그리는 오늘 처음 보는 책 속으로 여행을 떠났어요.",
      },
    }),
  }, profile);
  const completedData = await completed.json() as { error?: string };
  if (!completed.ok) throw new Error(completedData.error ?? "체험 그림을 완성하지 못했어요.");
  return createdData.artwork;
}

export function StorybookDemoBootstrap() {
  const started = useRef(false);
  const [status, setStatus] = useState("완성한 그림을 준비하고 있어요…");
  const [error, setError] = useState("");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const sessionResponse = await fetch("/api/student", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "localStorybookDemo" }),
          cache: "no-store",
        });
        const session = await sessionResponse.json() as DemoSession;
        if (!sessionResponse.ok || !session.student || !session.deviceToken || !session.expiresAt) throw new Error(session.error ?? "체험 학생을 준비하지 못했어요.");
        const profile: ActiveDeviceProfile = { studentId: session.student.id, nickname: session.student.nickname, animal: session.student.animal, classroomName: session.student.classroomName, deviceToken: session.deviceToken, expiresAt: session.expiresAt };
        storeProfile(profile);
        setStatus("완성한 그림을 그림책으로 옮기고 있어요…");
        const artwork = await ensureCompletedArtwork(profile);
        const response = await studentFetch("/api/storybooks", { method: "POST", body: JSON.stringify({ format: "landscape", artworkId: artwork.id, title: "몽그리의 상상 그림책" }) }, profile);
        const data = await response.json() as { storybook?: { id: string }; error?: string };
        if (!response.ok || !data.storybook) throw new Error(data.error ?? "체험 그림책을 만들지 못했어요.");
        location.replace(`/student/books/${data.storybook.id}`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "체험 화면을 준비하지 못했어요.");
      }
    })();
  }, []);

  return <main className="app-shell"><header className="app-header"><Logo /></header><section className="loading-card" role="status"><h1>그림책 작업실 준비 중</h1><p>{error || status}</p>{error && <a className="button secondary" href="/student/books/demo">다시 준비하기</a>}</section></main>;
}
