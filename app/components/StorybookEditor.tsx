"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import Moveable, { type OnDrag, type OnResize, type OnRotate } from "react-moveable";
import { storybookEditorFetch } from "@/lib/storybook-editor-fetch";
import { containedCropPlacement, visibleContentBounds, type NormalizedRect } from "@/lib/image-cutout";
import {
  createStorybookTextElement,
  DEFAULT_STORYBOOK_TEXT,
  MAX_STORYBOOK_PAGES,
  storybookCompletionError,
  storybookAspectRatio,
  STORYBOOK_IMAGE_AREA,
  STORYBOOK_TEXT_BOX,
  type StorybookDocument,
  type StorybookCrop,
  type StorybookElement,
  type StorybookFormat,
  type StorybookPage,
} from "@/lib/storybook-model";
import { AuthenticatedImage, AuthenticatedImageCache } from "./AuthenticatedImage";
import { StorybookTextInput } from "./StorybookTextInput";
import { StorybookPresence } from "./StorybookPresence";
import { ImageCutoutModal } from "./ImageCutoutModal";
import { Logo } from "./Logo";
import "./storybook-editing.css";

type Asset = { id: string; storybookId: string; sourceType: "artwork" | "upload"; sourceArtworkId: string | null; contentType: string; byteSize: number; createdAt: string };
type Book = { id: string; title: string; document: StorybookDocument; revision: number; status: "draft" | "complete"; updatedAt: string };
type ArtworkChoice = { id: string; title: string; status: string };
type CutoutTarget = { asset: Asset; elementId: string; pageIndex: number };
type StageSize = { width: number; height: number };

function clientId(prefix: "page" | "element") { return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`; }
function clonePage(page: StorybookPage): StorybookPage {
  return { ...page, id: clientId("page"), elements: page.elements.map((element) => ({ ...element, id: clientId("element") })) };
}
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function nextZ(page: StorybookPage) { return Math.min(10_000, page.elements.reduce((max, element) => element.type === "image" ? Math.max(max, element.zIndex) : max, 0) + 1); }
const formatAspectRatio = storybookAspectRatio;
const FULL_IMAGE_CROP: StorybookCrop = { x: 0, y: 0, width: 1, height: 1 };

function fitImageToArea(element: Pick<StorybookElement, "x" | "y" | "width" | "height">, format: StorybookFormat, aspectRatio?: number) {
  const areaRight = STORYBOOK_IMAGE_AREA.x + STORYBOOK_IMAGE_AREA.width;
  const areaBottom = STORYBOOK_IMAGE_AREA.y + STORYBOOK_IMAGE_AREA.height;
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  let width = clamp(element.width, 0.04, STORYBOOK_IMAGE_AREA.width);
  let height = clamp(element.height, 0.04, STORYBOOK_IMAGE_AREA.height);
  if (aspectRatio && Number.isFinite(aspectRatio)) {
    const safeRatio = clamp(aspectRatio, 0.1, 10);
    height = width * formatAspectRatio(format) / safeRatio;
    if (height > STORYBOOK_IMAGE_AREA.height) {
      height = STORYBOOK_IMAGE_AREA.height;
      width = height * safeRatio / formatAspectRatio(format);
    }
    if (height < 0.04) {
      height = 0.04;
      width = height * safeRatio / formatAspectRatio(format);
    }
    if (width > STORYBOOK_IMAGE_AREA.width) {
      width = STORYBOOK_IMAGE_AREA.width;
      height = width * formatAspectRatio(format) / safeRatio;
    }
  }
  const x = clamp(centerX - width / 2, STORYBOOK_IMAGE_AREA.x, areaRight - width);
  const y = clamp(centerY - height / 2, STORYBOOK_IMAGE_AREA.y, areaBottom - height);
  return { x, y, width, height, ...(aspectRatio ? { aspectRatio: clamp(aspectRatio, 0.1, 10) } : {}) };
}

function cropPlacement(element: StorybookElement, format: StorybookFormat, sourceAspectRatio: number, nextCrop: StorybookCrop) {
  const currentCrop = element.crop;
  const sourceRect = currentCrop ? {
    x: element.x - element.width * currentCrop.x / currentCrop.width,
    y: element.y - element.height * currentCrop.y / currentCrop.height,
    width: element.width / currentCrop.width,
    height: element.height / currentCrop.height,
  } : containedCropPlacement(element, formatAspectRatio(format), sourceAspectRatio, FULL_IMAGE_CROP);
  return {
    x: sourceRect.x + sourceRect.width * nextCrop.x,
    y: sourceRect.y + sourceRect.height * nextCrop.y,
    width: sourceRect.width * nextCrop.width,
    height: sourceRect.height * nextCrop.height,
  };
}

function imageCropStyle(crop?: StorybookCrop): CSSProperties {
  if (!crop) return { inset: 0, width: "100%", height: "100%", objectFit: "contain" };
  return {
    left: `${-crop.x / crop.width * 100}%`,
    top: `${-crop.y / crop.height * 100}%`,
    width: `${100 / crop.width}%`,
    height: `${100 / crop.height}%`,
    objectFit: "fill",
  };
}

function detectVisibleCrop(image: HTMLImageElement, tolerance: number): StorybookCrop | undefined {
  const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = window.document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  const padding = Math.max(2, Math.round(Math.min(width, height) * 0.015));
  const bounds = visibleContentBounds(pixels, tolerance, padding);
  if (!bounds) return undefined;
  const crop = { x: bounds.x / width, y: bounds.y / height, width: bounds.width / width, height: bounds.height / height };
  const nearlyFull = crop.x < 0.008 && crop.y < 0.008 && crop.x + crop.width > 0.992 && crop.y + crop.height > 0.992;
  return nearlyFull ? undefined : crop;
}

function cropsMatch(left?: StorybookCrop, right?: StorybookCrop) {
  if (!left || !right) return left === right;
  return (["x", "y", "width", "height"] as const).every((key) => Math.abs(left[key] - right[key]) < 0.0001);
}

function normalizeLoadedDocument(document: StorybookDocument): StorybookDocument {
  return {
    ...document,
    pages: document.pages.map((page) => {
      const textElements = page.elements.filter((element) => element.type === "text");
      const firstText = textElements[0];
      const combinedText = textElements.map((element) => element.text === DEFAULT_STORYBOOK_TEXT ? "" : element.text ?? "").filter(Boolean).join("\n").slice(0, 800);
      const text = firstText ? {
        ...firstText,
        ...STORYBOOK_TEXT_BOX,
        text: combinedText === DEFAULT_STORYBOOK_TEXT ? "" : combinedText,
        rotation: 0,
        zIndex: 0,
        opacity: 1,
        locked: true,
        align: "left" as const,
      } : createStorybookTextElement(clientId("element"));
      const images = page.elements.filter((element) => element.type === "image").map((element, index) => ({
        ...element,
        ...fitImageToArea(element, document.format, element.aspectRatio),
        zIndex: clamp(Math.max(1, element.zIndex || index + 1), 1, 10_000),
      }));
      return { ...page, elements: [text, ...images] };
    }),
  };
}

async function imageFileToPng(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일을 골라 주세요.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이미지를 읽을 수 없어요.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL("image/png"), aspectRatio: canvas.width / canvas.height };
  } finally { URL.revokeObjectURL(url); }
}

async function dataUrlToPngBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  if (blob.type !== "image/png") throw new Error("PNG 이미지로 바꾸지 못했어요.");
  if (blob.size > 3_500_000) throw new Error("이미지가 너무 커요. 조금 작은 이미지를 골라 주세요.");
  return blob;
}

export function StorybookEditor({ teacherBookId, classroomId }: { teacherBookId?: string; classroomId?: string } = {}) {
  return <AuthenticatedImageCache><StorybookEditorContent teacherBookId={teacherBookId} classroomId={classroomId} /></AuthenticatedImageCache>;
}
function StorybookEditorContent({ teacherBookId, classroomId }: { teacherBookId?: string; classroomId?: string }) {
  const routeParams = useParams<{ id: string }>();
  const params = { id: teacherBookId ?? routeParams.id };
  const apiBase = teacherBookId ? "/api/teacher/book-editor" : "/api/storybooks";
  const [book, setBook] = useState<Book | null>(null);
  const [document, setDocument] = useState<StorybookDocument | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [artworks, setArtworks] = useState<ArtworkChoice[] | null>(null);
  const [addingAsset, setAddingAsset] = useState(false);
  const [assetNotice, setAssetNotice] = useState("");
  const [textNotice, setTextNotice] = useState("");
  const [keepImageRatio, setKeepImageRatio] = useState(true);
  const [cutoutTarget, setCutoutTarget] = useState<CutoutTarget | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);
  const [stageSize, setStageSize] = useState<StageSize>({ width: 0, height: 0 });
  const [moveableTarget, setMoveableTarget] = useState<HTMLDivElement | null>(null);
  const [guidelineTargets, setGuidelineTargets] = useState<HTMLDivElement[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const elementRefs = useRef(new Map<string, HTMLDivElement>());
  const aspectSyncedRef = useRef(new Set<string>());
  const gestureRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const backgroundFileRef = useRef<HTMLInputElement>(null);
  const bookRef = useRef<Book | null>(null);
  const documentRef = useRef<StorybookDocument | null>(null);
  const editGeneration = useRef(0);
  const savingRef = useRef(false);
  const completionPending = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const maxSaveTimer = useRef<number | undefined>(undefined);
  const teacherWatching = useRef(false);
  const persistLatest = useRef<() => void>(() => {});
  const onWatching = useCallback((watching: boolean) => {
    if (watching && !teacherWatching.current && maxSaveTimer.current) {
      window.clearTimeout(maxSaveTimer.current);
      maxSaveTimer.current = window.setTimeout(() => persistLatest.current(), 2000);
    }
    teacherWatching.current = watching;
  }, []);
  useEffect(() => { persistLatest.current = () => void persist(false); });
  const undoRef = useRef<StorybookDocument[]>([]);
  const redoRef = useRef<StorybookDocument[]>([]);
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const bindStage = useCallback((node: HTMLDivElement | null) => {
    stageRef.current = node;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void storybookEditorFetch(`${apiBase}/${encodeURIComponent(params.id)}`, { signal: controller.signal }).then(async (response) => {
      const data = await response.json() as { storybook?: Book; assets?: Asset[]; error?: string };
      if (!response.ok || !data.storybook) throw new Error(data.error ?? "그림책을 불러오지 못했어요.");
      const normalizedDocument = normalizeLoadedDocument(data.storybook.document);
      const normalizedBook = { ...data.storybook, document: normalizedDocument };
      setBook(normalizedBook); setDocument(normalizedDocument); setAssets(data.assets ?? []);
      bookRef.current = normalizedBook; documentRef.current = normalizedDocument;
    }).catch((cause: unknown) => {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "그림책을 불러오지 못했어요.");
    });
    return () => controller.abort();
  }, [params.id, apiBase]);

  useEffect(() => { bookRef.current = book; }, [book]);
  useEffect(() => { documentRef.current = document; }, [document]);
  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); if (maxSaveTimer.current) window.clearTimeout(maxSaveTimer.current); }, []);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const rect = stage.getBoundingClientRect();
      setStageSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [document?.format, pageIndex]);
  useEffect(() => {
    const activePage = document?.pages[pageIndex];
    const activeSelection = activePage?.elements.find((element) => element.id === selectedId);
    setMoveableTarget(activeSelection?.type === "image" ? elementRefs.current.get(activeSelection.id) ?? null : null);
    setGuidelineTargets(activePage?.elements.filter((element) => element.type === "image" && element.id !== selectedId).map((element) => elementRefs.current.get(element.id)).filter((element): element is HTMLDivElement => Boolean(element)) ?? []);
  }, [selectedId, pageIndex, document]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (saveState === "unsaved" || saveState === "saving") event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [saveState]);

  function scheduleSave() {
    editGeneration.current += 1;
    setSaveState("unsaved");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void persist(false), teacherWatching.current ? 500 : 900);
    // Continuous typing cannot postpone autosave forever. Watching uses the same 2s cap as drawing.
    if (!maxSaveTimer.current) maxSaveTimer.current = window.setTimeout(() => void persist(false), teacherWatching.current ? 2000 : 10_000);
  }

  function remember(current: StorybookDocument) {
    undoRef.current = [...undoRef.current.slice(-39), current];
    redoRef.current = [];
    setHistoryState({ undo: undoRef.current.length, redo: 0 });
  }

  function changeDocument(updater: (current: StorybookDocument) => StorybookDocument, record = true) {
    const current = documentRef.current;
    if (!current) return;
    if (record) remember(current);
    const next = updater(current);
    documentRef.current = next; setDocument(next);
    scheduleSave();
  }

  function undo() {
    const current = documentRef.current; const previous = undoRef.current.at(-1);
    if (!current || !previous) return;
    undoRef.current = undoRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current.slice(-39), current];
    documentRef.current = previous; setDocument(previous); setPageIndex((value) => Math.min(value, previous.pages.length - 1)); setSelectedId(null); setHistoryState({ undo: undoRef.current.length, redo: redoRef.current.length }); scheduleSave();
  }

  function redo() {
    const current = documentRef.current; const next = redoRef.current.at(-1);
    if (!current || !next) return;
    redoRef.current = redoRef.current.slice(0, -1);
    undoRef.current = [...undoRef.current.slice(-39), current];
    documentRef.current = next; setDocument(next); setPageIndex((value) => Math.min(value, next.pages.length - 1)); setSelectedId(null); setHistoryState({ undo: undoRef.current.length, redo: redoRef.current.length }); scheduleSave();
  }

  async function persist(complete: boolean) {
    const currentBook = bookRef.current; const currentDocument = documentRef.current;
    if (!currentBook || !currentDocument) return;
    if (complete) {
      const message = storybookCompletionError(currentBook.title, currentDocument.pages.length, !teacherBookId);
      if (message) { completionPending.current = false; setError(message); window.alert(message); return; }
      completionPending.current = true;
    }
    // Invalid completion must leave the scheduled draft save intact.
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = undefined; }
    if (maxSaveTimer.current) { window.clearTimeout(maxSaveTimer.current); maxSaveTimer.current = undefined; }
    if (savingRef.current) {
      return;
    }
    savingRef.current = true; setSaveState("saving"); setError("");
    const generation = editGeneration.current;
    try {
      const response = await storybookEditorFetch(`${apiBase}/${encodeURIComponent(currentBook.id)}`, { method: "PUT", body: JSON.stringify({
        requestId: `save_${crypto.randomUUID().replaceAll("-", "")}`,
        expectedRevision: currentBook.revision, title: currentBook.title, document: currentDocument, complete,
      }) });
      const data = await response.json() as { revision?: number; status?: "draft" | "complete"; error?: string; code?: string };
      if (!response.ok || typeof data.revision !== "number") throw new Error(data.error ?? "그림책을 저장하지 못했어요.");
      // Only server metadata belongs to the completed request. Keep edits made while it was in flight.
      const nextBook = { ...bookRef.current!, revision: data.revision, status: data.status ?? currentBook.status };
      setBook(nextBook); bookRef.current = nextBook;
      setSaveState(generation === editGeneration.current ? "saved" : "unsaved");
      if (complete && generation === editGeneration.current) { completionPending.current = false; setPreviewPage(0); setPreviewOpen(true); }
    } catch (cause) {
      completionPending.current = false;
      setError(cause instanceof Error ? cause.message : "그림책을 저장하지 못했어요."); setSaveState("error");
    } finally {
      savingRef.current = false;
      if (generation !== editGeneration.current || completionPending.current) saveTimer.current = window.setTimeout(() => void persist(completionPending.current), 350);
    }
  }

  function changeTitle(title: string) {
    setBook((current) => {
      if (!current) return current;
      const next = { ...current, title }; bookRef.current = next; return next;
    });
    scheduleSave();
  }

  const page = document?.pages[pageIndex];
  const selected = page?.elements.find((element) => element.id === selectedId && element.type === "image") ?? null;
  const pageText = page?.elements.find((element) => element.type === "text") ?? null;
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const selectedImageAsset = selected?.type === "image" && selected.assetId ? assetMap.get(selected.assetId) : undefined;

  function updateElement(elementId: string, patch: Partial<StorybookElement>, record = true) {
    changeDocument((current) => ({ ...current, pages: current.pages.map((value, index) => index === pageIndex ? { ...value, elements: value.elements.map((element) => element.id === elementId ? { ...element, ...patch } as StorybookElement : element) } : value) }), record);
  }

  function updateSelected(patch: Partial<StorybookElement>) {
    if (selectedId) updateElement(selectedId, patch);
  }

  function updatePageText(patch: Partial<StorybookElement>) {
    if (!pageText) return;
    updateElement(pageText.id, { ...patch, ...STORYBOOK_TEXT_BOX, rotation: 0, opacity: 1, locked: true, align: "left" });
  }

  function addImageElement(asset: Asset, aspectRatio?: number) {
    if (!page || !document) return;
    const placement = fitImageToArea({ x: 0.12, y: 0.27, width: 0.76, height: 0.64 }, document.format, aspectRatio);
    const element: StorybookElement = { id: clientId("element"), type: "image", assetId: asset.id, ...placement, rotation: 0, zIndex: nextZ(page), opacity: 1, locked: false };
    changeDocument((current) => ({ ...current, pages: current.pages.map((value, index) => index === pageIndex ? { ...value, elements: [...value.elements, element] } : value) }));
    setSelectedId(element.id); setPickerOpen(false);
  }

  function setBackgroundAsset(assetId: string) {
    changeDocument((current) => ({ ...current, pages: current.pages.map((value, index) => index === pageIndex ? { ...value, backgroundAssetId: assetId } : value) }));
    setSelectedId(null);
  }

  async function openArtworkPicker() {
    setPickerOpen(true);
    if (artworks) return;
    try {
      const response = await storybookEditorFetch("/api/artworks");
      const data = await response.json() as { artworks?: ArtworkChoice[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "내 그림을 불러오지 못했어요.");
      setArtworks((data.artworks ?? []).filter((artwork) => artwork.status === "complete"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "내 그림을 불러오지 못했어요."); }
  }

  async function importArtwork(artwork: ArtworkChoice) {
    if (addingAsset) return;
    setAddingAsset(true); setError(""); setAssetNotice(`${artwork.title} 그림을 가져오고 있어요…`);
    try {
      const existing = assets.find((asset) => asset.sourceArtworkId === artwork.id);
      if (existing) { addImageElement(existing); return; }
      const response = await storybookEditorFetch(`${apiBase}/${encodeURIComponent(params.id)}/assets`, { method: "POST", body: JSON.stringify({ sourceType: "artwork", artworkId: artwork.id }) });
      const data = await response.json() as { asset?: Asset; error?: string };
      if (!response.ok || !data.asset) throw new Error(data.error ?? "그림을 가져오지 못했어요.");
      setAssets((current) => [...current, data.asset!]); addImageElement(data.asset);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "그림을 가져오지 못했어요."); }
    finally { setAddingAsset(false); setAssetNotice(""); }
  }

  async function uploadPngAsset(dataUrl: string, fallbackMessage: string) {
    const blob = await dataUrlToPngBlob(dataUrl);
    const response = await storybookEditorFetch(`${apiBase}/${encodeURIComponent(params.id)}/assets`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: blob,
    });
    const data = await response.json() as { asset?: Asset; error?: string };
    if (!response.ok || !data.asset) throw new Error(data.error ?? fallbackMessage);
    return data.asset;
  }

  async function uploadFile(file: File | undefined, purpose: "element" | "background") {
    if (!file || addingAsset) return;
    setAddingAsset(true); setError("");
    try {
      const { dataUrl, aspectRatio } = await imageFileToPng(file);
      const asset = await uploadPngAsset(dataUrl, "이미지를 올리지 못했어요.");
      setAssets((current) => [...current, asset]);
      if (purpose === "background") setBackgroundAsset(asset.id);
      else addImageElement(asset, aspectRatio);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "이미지를 올리지 못했어요."); }
    finally {
      setAddingAsset(false);
      if (purpose === "background" && backgroundFileRef.current) backgroundFileRef.current.value = "";
      if (purpose === "element" && fileRef.current) fileRef.current.value = "";
    }
  }

  async function saveCutout(dataUrl: string, aspectRatio: number, crop: NormalizedRect & { sourceAspectRatio: number }) {
    const target = cutoutTarget; const currentDocument = documentRef.current;
    if (!target || !currentDocument || addingAsset) return;
    setAddingAsset(true); setError("");
    try {
      const asset = await uploadPngAsset(dataUrl, "오린 캐릭터를 저장하지 못했어요.");
      const stageRatio = storybookAspectRatio(currentDocument.format);
      changeDocument((current) => ({ ...current, pages: current.pages.map((storyPage, index) => {
        if (index !== target.pageIndex) return storyPage;
        return { ...storyPage, elements: storyPage.elements.map((element) => {
          if (element.id !== target.elementId || element.type !== "image") return element;
          const placement = containedCropPlacement(element, stageRatio, crop.sourceAspectRatio, crop);
          return { ...element, assetId: asset.id, ...fitImageToArea(placement, current.format, aspectRatio), aspectRatio, crop: undefined };
        }) };
      }) }));
      setAssets((current) => [...current, asset]); setCutoutTarget(null);
    } finally { setAddingAsset(false); }
  }

  function addPage() {
    if (!document || (!teacherBookId && document.pages.length >= MAX_STORYBOOK_PAGES)) return;
    const next: StorybookPage = { id: clientId("page"), background: "#FFFFFF", elements: [createStorybookTextElement(clientId("element"))] };
    changeDocument((current) => ({ ...current, pages: [...current.pages, next] }));
    setPageIndex(document.pages.length); setSelectedId(null);
  }

  function duplicatePage() {
    if (!document || !page || (!teacherBookId && document.pages.length >= MAX_STORYBOOK_PAGES)) return;
    const copy = clonePage(page);
    changeDocument((current) => ({ ...current, pages: [...current.pages.slice(0, pageIndex + 1), copy, ...current.pages.slice(pageIndex + 1)] }));
    setPageIndex(pageIndex + 1); setSelectedId(null);
  }

  function deletePage() {
    if (!document || document.pages.length === 1) return;
    changeDocument((current) => ({ ...current, pages: current.pages.filter((_, index) => index !== pageIndex) }));
    setPageIndex(Math.max(0, pageIndex - 1)); setSelectedId(null);
  }

  function movePage(direction: -1 | 1) {
    if (!document) return;
    const destination = pageIndex + direction;
    if (destination < 0 || destination >= document.pages.length) return;
    changeDocument((current) => {
      const pages = [...current.pages];
      [pages[pageIndex], pages[destination]] = [pages[destination], pages[pageIndex]];
      return { ...current, pages };
    });
    setPageIndex(destination);
  }


  function syncImageContentBounds(element: StorybookElement, image: HTMLImageElement, force = false) {
    if (!document || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
    const key = `${page?.id ?? pageIndex}:${element.id}:${element.assetId}`;
    if (!force && aspectSyncedRef.current.has(key)) return;
    aspectSyncedRef.current.add(key);
    // A saved crop/ratio is authoritative; do not undo a deliberate one-axis resize on reload.
    if (!force && element.aspectRatio) return;
    const sourceAspectRatio = clamp(image.naturalWidth / image.naturalHeight, 0.1, 10);
    const crop = detectVisibleCrop(image, force ? 52 : 36);
    const appliedCrop = crop ?? FULL_IMAGE_CROP;
    const aspectRatio = clamp(sourceAspectRatio * appliedCrop.width / appliedCrop.height, 0.1, 10);
    const placement = fitImageToArea(cropPlacement(element, document.format, sourceAspectRatio, appliedCrop), document.format, aspectRatio);
    const unchanged = Math.abs((element.aspectRatio ?? 0) - aspectRatio) < 0.0001
      && cropsMatch(element.crop, crop)
      && (["x", "y", "width", "height"] as const).every((keyName) => Math.abs(element[keyName] - placement[keyName]) < 0.0001);
    if (!unchanged) updateElement(element.id, { ...placement, aspectRatio, crop }, force);
  }

  function tightenSelectedImage() {
    if (!selected) return;
    const image = elementRefs.current.get(selected.id)?.querySelector("img");
    if (!image) { setError("그림을 불러온 뒤 다시 눌러 주세요."); return; }
    syncImageContentBounds(selected, image, true);
  }

  function sendSelectedToBack() {
    if (!selectedId || !selected) return;
    changeDocument((current) => ({ ...current, pages: current.pages.map((value, index) => index === pageIndex ? { ...value, elements: value.elements.map((element) => element.type === "image" ? { ...element, zIndex: element.id === selectedId ? 1 : Math.min(10_000, Math.max(1, element.zIndex + 1)) } : element) } : value) }));
  }

  function deleteSelected() {
    if (!selectedId || !selected) return;
    changeDocument((current) => ({ ...current, pages: current.pages.map((value, index) => index === pageIndex ? { ...value, elements: value.elements.filter((element) => element.id !== selectedId) } : value) }));
    setSelectedId(null);
  }

  function duplicateSelected() {
    if (!selected || !page || !document) return;
    const shifted = { ...selected, x: selected.x + 0.03, y: selected.y + 0.03 };
    const copy = { ...selected, ...fitImageToArea(shifted, document.format, selected.aspectRatio), id: clientId("element"), zIndex: nextZ(page) };
    changeDocument((current) => ({ ...current, pages: current.pages.map((value, index) => index === pageIndex ? { ...value, elements: [...value.elements, copy] } : value) }));
    setSelectedId(copy.id);
  }

  function beginGesture(elementId: string | null) {
    if (!elementId || gestureRef.current) return;
    if (documentRef.current) remember(documentRef.current);
    gestureRef.current = elementId;
  }

  function endGesture() {
    gestureRef.current = null;
  }

  function gestureElement(elementId: string) {
    return documentRef.current?.pages[pageIndex]?.elements.find((element) => element.id === elementId) ?? null;
  }

  function applyMoveableDrag(event: OnDrag) {
    const elementId = gestureRef.current ?? selectedId;
    const stage = stageRef.current;
    if (!elementId || !stage) return;
    const element = gestureElement(elementId);
    if (!element) return;
    const rect = stage.getBoundingClientRect();
    const areaRight = STORYBOOK_IMAGE_AREA.x + STORYBOOK_IMAGE_AREA.width;
    const areaBottom = STORYBOOK_IMAGE_AREA.y + STORYBOOK_IMAGE_AREA.height;
    const x = clamp(event.left / rect.width, STORYBOOK_IMAGE_AREA.x, areaRight - element.width);
    const y = clamp(event.top / rect.height, STORYBOOK_IMAGE_AREA.y, areaBottom - element.height);
    event.target.style.left = `${x * 100}%`;
    event.target.style.top = `${y * 100}%`;
    updateElement(elementId, { x, y }, false);
  }

  function applyMoveableResize(event: OnResize) {
    const elementId = gestureRef.current ?? selectedId;
    const stage = stageRef.current;
    if (!elementId || !stage) return;
    const rect = stage.getBoundingClientRect();
    const areaRight = STORYBOOK_IMAGE_AREA.x + STORYBOOK_IMAGE_AREA.width;
    const areaBottom = STORYBOOK_IMAGE_AREA.y + STORYBOOK_IMAGE_AREA.height;
    const x = clamp(event.drag.left / rect.width, STORYBOOK_IMAGE_AREA.x, areaRight - 0.04);
    const y = clamp(event.drag.top / rect.height, STORYBOOK_IMAGE_AREA.y, areaBottom - 0.04);
    const width = clamp(event.width / rect.width, 0.04, areaRight - x);
    const height = clamp(event.height / rect.height, 0.04, areaBottom - y);
    event.target.style.left = `${x * 100}%`;
    event.target.style.top = `${y * 100}%`;
    event.target.style.width = `${width * 100}%`;
    event.target.style.height = `${height * 100}%`;
    updateElement(elementId, { x, y, width, height, aspectRatio: width * formatAspectRatio(documentRef.current!.format) / height, crop: gestureElement(elementId)?.crop ?? FULL_IMAGE_CROP }, false);
  }

  function applyMoveableRotate(event: OnRotate) {
    const elementId = gestureRef.current ?? selectedId;
    if (!elementId) return;
    const rotation = ((event.rotation + 180) % 360 + 360) % 360 - 180;
    event.target.style.transform = `rotate(${rotation}deg)`;
    updateElement(elementId, { rotation }, false);
  }

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
      if (!selectedId || !selected) return;
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelected(); }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const distance = event.shiftKey ? 0.02 : 0.005;
        const x = event.key === "ArrowLeft" ? selected.x - distance : event.key === "ArrowRight" ? selected.x + distance : selected.x;
        const y = event.key === "ArrowUp" ? selected.y - distance : event.key === "ArrowDown" ? selected.y + distance : selected.y;
        const areaRight = STORYBOOK_IMAGE_AREA.x + STORYBOOK_IMAGE_AREA.width;
        const areaBottom = STORYBOOK_IMAGE_AREA.y + STORYBOOK_IMAGE_AREA.height;
        updateElement(selectedId, { x: clamp(x, STORYBOOK_IMAGE_AREA.x, areaRight - selected.width), y: clamp(y, STORYBOOK_IMAGE_AREA.y, areaBottom - selected.height) });
      }
    }
    window.addEventListener("keydown", keyDown); return () => window.removeEventListener("keydown", keyDown);
  });

  function renderElement(element: StorybookElement, interactive: boolean) {
    const imageAsset = element.type === "image" && element.assetId ? assetMap.get(element.assetId) : undefined;
    const canSelect = interactive && element.type === "image";
    const className = `storybook-stage-element ${element.type} ${canSelect && selectedId === element.id ? "selected" : ""} ${element.locked ? "locked" : ""}`;
    return <div key={element.id} ref={canSelect ? (node) => { if (node) elementRefs.current.set(element.id, node); else elementRefs.current.delete(element.id); } : undefined} data-storybook-element-id={canSelect ? element.id : undefined} className={className} onPointerDown={canSelect ? (event) => { event.stopPropagation(); setSelectedId(element.id); } : undefined} style={{ left: `${element.x * 100}%`, top: `${element.y * 100}%`, width: `${element.width * 100}%`, height: `${element.height * 100}%`, transform: `rotate(${element.rotation}deg)`, zIndex: element.type === "text" ? 10_002 : element.zIndex + 1, opacity: element.opacity, color: element.color, textAlign: element.align }}>
      {imageAsset ? <AuthenticatedImage src={`${apiBase}/${params.id}/assets/${imageAsset.id}`} alt="그림책에 넣은 그림" style={imageCropStyle(element.crop)} onLoad={canSelect ? (event) => syncImageContentBounds(element, event.currentTarget) : undefined} /> : element.type === "text" ? <StorybookTextInput element={element} format={document!.format} interactive={interactive} onFocus={() => setSelectedId(null)} onChange={text => { setTextNotice(""); updatePageText({ text }); }} onFull={() => setTextNotice("이야기 칸이 가득 찼어요. 글자 크기를 줄이거나 다음 쪽에 이어 써 주세요.")} /> : <span>이미지 없음</span>}
    </div>;
  }

  function renderBackground(storyPage: StorybookPage) {
    if (!storyPage.backgroundAssetId) return null;
    const asset = assetMap.get(storyPage.backgroundAssetId);
    return asset ? <AuthenticatedImage className="storybook-page-background" src={`${apiBase}/${params.id}/assets/${asset.id}`} alt="그림책 쪽 배경" /> : null;
  }

  if (!book || !document || !page) return <main className="app-shell"><header className="app-header"><Logo /></header>{error ? <p className="error-box">{error}</p> : <div className="loading-card">그림책 작업실을 여는 중…</div>}</main>;

  return <main className="storybook-editor-shell">
    {!teacherBookId && <StorybookPresence bookId={book.id} pageId={document.pages[previewOpen ? previewPage : pageIndex].id} onWatching={onWatching} />}
    <header className="storybook-editor-header"><a className="small-button" href={teacherBookId ? `/teacher/class/${classroomId}/books` : "/student/books"}>← 그림책</a><input aria-label="그림책 제목" maxLength={60} value={book.title} onChange={(event) => changeTitle(event.target.value)} placeholder="그림책 제목을 지어 주세요" /><span className={`storybook-save-state ${saveState}`}>{saveState === "saving" ? "저장 중…" : saveState === "unsaved" ? "변경됨" : saveState === "error" ? "저장 확인 필요" : "✓ 저장됨"}</span><button type="button" className="button secondary" disabled={saveState === "saving"} onClick={() => void persist(false)}>저장</button><button type="button" className="button secondary" onClick={() => { setPreviewPage(pageIndex); setPreviewOpen(true); }}>미리보기</button><button type="button" className="button primary" disabled={saveState === "saving"} onClick={() => void persist(true)}>완성하기</button></header>
    {textNotice && <p className="storybook-editor-error" role="status">{textNotice}</p>}
    {error && <p className="error-box storybook-editor-error" role="alert">{error}<button type="button" onClick={() => setError("")}>닫기</button></p>}
    <div className="storybook-editor-body">
      <aside className="storybook-page-rail" aria-label="그림책 쪽 목록">{document.pages.map((item, index) => <button type="button" className={index === pageIndex ? "active" : ""} aria-current={index === pageIndex ? "page" : undefined} aria-label={`${index + 1}쪽${index === pageIndex ? " · 선택됨" : ""}`} key={item.id} onClick={() => { setPageIndex(index); setSelectedId(null); }}><span className={`format-${document.format} ${item.backgroundAssetId ? "has-background" : ""}`} style={{ background: item.background }}>{item.elements.slice().sort((a, b) => a.zIndex - b.zIndex).map((element) => <i key={element.id} className={element.type} style={{ left: `${element.x * 100}%`, top: `${element.y * 100}%`, width: `${element.width * 100}%`, height: `${element.height * 100}%` }} />)}</span><b>{index + 1}</b></button>)}<button type="button" className="add-page" disabled={(!teacherBookId && document.pages.length >= MAX_STORYBOOK_PAGES)} onClick={addPage}>＋<span>쪽 추가</span></button></aside>
      <section className="storybook-workspace">
        <div className="storybook-toolbar" aria-label="그림책 도구"><button type="button" disabled={!historyState.undo} onClick={undo}>↶ 되돌리기</button><button type="button" disabled={!historyState.redo} onClick={redo}>↷ 다시하기</button>{!teacherBookId && <button type="button" onClick={() => void openArtworkPicker()}>🎨 내 그림</button>}<button type="button" onClick={() => fileRef.current?.click()}>🖼️ 새 그림</button><input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => void uploadFile(event.target.files?.[0], "element")} /><button type="button" onClick={() => backgroundFileRef.current?.click()}>🌄 배경 넣기</button><input ref={backgroundFileRef} type="file" accept="image/*" hidden onChange={(event) => void uploadFile(event.target.files?.[0], "background")} /><button type="button" disabled={pageIndex === 0} onClick={() => movePage(-1)}>← 쪽 이동</button><button type="button" disabled={pageIndex === document.pages.length - 1} onClick={() => movePage(1)}>쪽 이동 →</button><button type="button" onClick={duplicatePage}>쪽 복제</button><button type="button" disabled={document.pages.length === 1} onClick={deletePage}>쪽 삭제</button></div>
        {teacherBookId && <details className="storybook-teacher-editor-note"><summary>그림책 편집 안내</summary><p>PDF 원본은 쪽 배경입니다. 원본 글자 개별 수정은 지원하지 않으며, 이야기·그림 추가, 배경 교체, 쪽 순서 변경이 가능합니다. 수정 후 완성하기를 눌러야 새 피드백과 주문에 반영됩니다.</p></details>}
        <div className="storybook-stage-wrap"><div ref={bindStage} className={`storybook-stage format-${document.format}`} style={{ background: page.background }} onPointerDown={(event) => { if ((event.target as HTMLElement).closest(".moveable-control-box")) return; setSelectedId(null); }}>
          <div className="storybook-stage-content">
            {renderBackground(page)}
            <div className="storybook-image-zone" aria-hidden="true"><span>그림을 놓는 곳</span></div>
            {page.elements.slice().sort((a, b) => a.zIndex - b.zIndex).map((element) => renderElement(element, true))}
          </div>
          {moveableTarget && selected && !selected.locked && <Moveable
            target={moveableTarget}
            className="storybook-moveable"
            draggable
            resizable
            rotatable
            snappable
            useResizeObserver
            useMutationObserver
            origin={false}
            keepRatio={keepImageRatio}
            renderDirections={["nw", "n", "ne", "w", "e", "sw", "s", "se"]}
            rotationPosition="top"
            displayAroundControls
            controlPadding={44}
            linePadding={8}
            throttleDrag={1}
            throttleResize={1}
            throttleRotate={1}
            bounds={{
              position: "css",
              left: stageSize.width * STORYBOOK_IMAGE_AREA.x,
              top: stageSize.height * STORYBOOK_IMAGE_AREA.y,
              right: stageSize.width * (1 - STORYBOOK_IMAGE_AREA.x - STORYBOOK_IMAGE_AREA.width),
              bottom: stageSize.height * (1 - STORYBOOK_IMAGE_AREA.y - STORYBOOK_IMAGE_AREA.height),
            }}
            snapDirections={{ left: true, right: true, top: true, bottom: true, center: true, middle: true }}
            elementSnapDirections={{ left: true, right: true, top: true, bottom: true, center: true, middle: true }}
            verticalGuidelines={stageSize.width ? [stageSize.width / 2] : []}
            horizontalGuidelines={stageSize.height ? [stageSize.height / 2] : []}
            elementGuidelines={guidelineTargets}
            snapThreshold={8}
            snapRotationDegrees={[-180, -135, -90, -45, 0, 45, 90, 135, 180]}
            snapRotationThreshold={5}
            onDragStart={(event) => { beginGesture(selected.id); event.set([0, 0]); }}
            onDrag={applyMoveableDrag}
            onDragEnd={endGesture}
            onResizeStart={(event) => { beginGesture(selected.id); event.set([selected.width * stageSize.width, selected.height * stageSize.height]); event.setMin([Math.max(24, stageSize.width * 0.04), Math.max(24, stageSize.height * 0.04)]); }}
            onResize={applyMoveableResize}
            onResizeEnd={endGesture}
            onRotateStart={(event) => { beginGesture(selected.id); event.set(selected.rotation); }}
            onRotate={applyMoveableRotate}
            onRotateEnd={endGesture}
          />}
        </div></div>
        <p className="storybook-stage-help">{pageIndex === 0 ? "1쪽은 표지예요. " : `${pageIndex + 1}쪽 · 내지예요. `}{document.pages.length}쪽{!teacherBookId && " / 최소 24쪽"} · <b>점선 안</b>에서 그림을 움직일 수 있어요. 비율 유지를 끄면 옆 손잡이로 가로나 세로만 늘릴 수 있어요.</p>
      </section>
      <aside className="storybook-inspector"><h2>{selected ? "그림 꾸미기" : "쪽 꾸미기"}</h2>
        {pageText && <section className="storybook-story-control"><h3>이야기 글</h3><label>글자 크기<input type="range" min="0.026" max="0.075" step="0.002" value={pageText.fontSize} onChange={(event) => updatePageText({ fontSize: Number(event.target.value) })} /></label><label>글자 색<input type="color" value={pageText.color} onChange={(event) => updatePageText({ color: event.target.value.toUpperCase() })} /></label><p>책 위 이야기 칸을 눌러 직접 써 보세요. 줄이 차면 자동으로 다음 줄로 넘어가요.</p></section>}
        {selected && <><section className="storybook-image-controls"><label className="book-check"><input type="checkbox" checked={keepImageRatio} onChange={e => setKeepImageRatio(e.target.checked)} />비율 유지</label><p>끄면 좌우 손잡이로 가로만, 위아래 손잡이로 세로만 늘릴 수 있어요.</p><label>그림 크기 <b>{Math.round(selected.width * 100)}%</b><input aria-label="그림 크기" type="range" min="0.08" max={STORYBOOK_IMAGE_AREA.width} step="0.01" value={selected.width} onInput={(event) => { const width = Number(event.currentTarget.value); updateSelected(fitImageToArea({ ...selected, x: selected.x + (selected.width - width) / 2, width }, document.format, selected.aspectRatio)); }} /></label><button type="button" className="button secondary full" onClick={tightenSelectedImage}>✨ 빈 여백 없이 맞추기</button><button type="button" className="button secondary full" onClick={() => updateSelected(fitImageToArea(STORYBOOK_IMAGE_AREA, document.format, selected.aspectRatio))}>그림 영역에 크게 맞추기</button><button type="button" className="button primary full cutout-open-button" disabled={!selectedImageAsset || addingAsset} onClick={() => { if (selectedImageAsset) setCutoutTarget({ asset: selectedImageAsset, elementId: selected.id, pageIndex }); }}>✂️ 캐릭터만 오리기</button><p>흰색이나 투명한 빈 여백은 자동으로 빼고, 보이는 그림과 선택 박스를 같은 크기로 맞춰요.</p></section><label>투명도<input type="range" min="0.05" max="1" step="0.05" value={selected.opacity} onChange={(event) => updateSelected({ opacity: Number(event.target.value) })} /></label><label>기울기<input type="range" min="-180" max="180" step="1" value={selected.rotation} onChange={(event) => updateSelected({ rotation: Number(event.target.value) })} /></label><div className="storybook-layer-buttons"><button type="button" onClick={() => updateSelected({ zIndex: nextZ(page) })}>맨 앞으로</button><button type="button" onClick={sendSelectedToBack}>맨 뒤로</button><button type="button" onClick={duplicateSelected}>복제</button><button type="button" onClick={() => updateSelected({ locked: !selected.locked })}>{selected.locked ? "🔓 잠금 풀기" : "🔒 잠그기"}</button><button type="button" className="danger" onClick={deleteSelected}>삭제</button></div></>}
        <section className="storybook-page-controls"><h3>페이지 배경</h3><label>배경색<input type="color" value={page.background} onChange={(event) => changeDocument((current) => ({ ...current, pages: current.pages.map((value, index) => index === pageIndex ? { ...value, background: event.target.value.toUpperCase() } : value) }))} /></label><button type="button" className="button secondary full" onClick={() => backgroundFileRef.current?.click()}>🌄 페이지 전체 배경 넣기</button>{page.backgroundAssetId && <button type="button" className="text-button full" onClick={() => changeDocument((current) => ({ ...current, pages: current.pages.map((value, index) => index === pageIndex ? { ...value, backgroundAssetId: undefined } : value) }))}>배경 그림 지우기</button>}<p>배경 그림은 페이지 전체를 채우고, 그 위에 이야기 글과 그림이 올라가요.</p></section>
      </aside>
    </div>

    {pickerOpen && <div className="storybook-modal-backdrop" role="presentation" onMouseDown={() => setPickerOpen(false)}><section className="storybook-picker-modal" role="dialog" aria-modal="true" aria-labelledby="artwork-picker-title" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">그대로 가져오기</p><h2 id="artwork-picker-title">완성한 내 그림</h2></div><button type="button" className="small-button" onClick={() => setPickerOpen(false)}>닫기</button></header>{assetNotice && <p role="status" className="book-notice">{assetNotice}</p>}{artworks === null ? <div className="loading-card">내 그림을 찾는 중…</div> : artworks.length ? <div className="storybook-artwork-picker-grid">{artworks.map((artwork) => <button type="button" key={artwork.id} disabled={addingAsset} onClick={() => void importArtwork(artwork)}><AuthenticatedImage lazy src={`/api/artworks/${artwork.id}/image`} alt={artwork.title} /><b>{artwork.title}</b><small>이 그림 넣기</small></button>)}</div> : <div className="empty-state">완성한 그림이 아직 없어요.<br /><a href="/student/activities" className="button secondary">그림 그리러 가기</a></div>}</section></div>}

    {cutoutTarget && <ImageCutoutModal sourceUrl={`${apiBase}/${params.id}/assets/${cutoutTarget.asset.id}`} onClose={() => setCutoutTarget(null)} onSave={saveCutout} />}

    {previewOpen && <div className="storybook-preview" role="dialog" aria-modal="true" aria-label="그림책 미리보기"><header><b>{book.title || "제목을 지어 주세요"}</b><div><a className="small-button" href={teacherBookId ? `/teacher/class/${classroomId}/books` : "/student"}>첫 화면으로</a><button type="button" className="small-button" onClick={() => setPreviewOpen(false)}>편집으로 돌아가기</button></div></header><div className="storybook-preview-stage-wrap"><button type="button" aria-label="이전 쪽" disabled={previewPage === 0} onClick={() => setPreviewPage((value) => value - 1)}>‹</button><div key={document.pages[previewPage].id} className={`storybook-stage preview format-${document.format}`} style={{ background: document.pages[previewPage].background }}><div className="storybook-stage-content">{renderBackground(document.pages[previewPage])}{document.pages[previewPage].elements.slice().sort((a, b) => a.zIndex - b.zIndex).map((element) => renderElement(element, false))}</div></div><button type="button" aria-label="다음 쪽" disabled={previewPage === document.pages.length - 1} onClick={() => setPreviewPage((value) => value + 1)}>›</button></div><footer>{previewPage + 1} / {document.pages.length}</footer></div>}
  </main>;
}
