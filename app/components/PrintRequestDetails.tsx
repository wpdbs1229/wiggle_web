"use client";
import { useState } from "react";
import { teacherRequest } from "./book-workflow-client";
import type { PrintLayout } from "@/lib/print-validation";
import type { PrintRequest, RequestDocument, ProviderState } from "@/lib/print-requests";
export const requestStatus = (status: string) => ({ requested: "접수 · 운영자 확인 대기", preparing: "제작사 원고 준비 중", quoted: "견적 확인 완료", submitting: "발주 결과 확인 중", uncertain: "발주 결과 재확인 필요", submitted: "발주 완료" }[status] ?? status);
export function PrintDimensions({ layout }: { layout: PrintLayout }) {
  const { size, spec, pageCount } = layout, spreads = spec.bindingType.toUpperCase() === "LAYFLAT";
  return <div className="print-dimensions"><strong>필수 PDF 크기 · 가로 × 세로</strong><p>표지 1페이지: <b>{size.coverWidthMm} × {size.coverHeightMm}mm</b><br />뒤표지 + 책등 {size.spineWidthMm}mm + 앞표지가 이어진 펼침 표지</p><p>내지 1~{spreads ? pageCount / 2 : pageCount}페이지 각각: <b>{size.innerWidthMm} × {size.innerHeightMm}mm</b><br />인쇄 {pageCount}쪽{spreads ? " · 두 쪽씩 묶인 펼침 PDF" : " · 한 쪽씩 구성한 PDF"}</p><p>재단·여유분이 포함된 제작사 규격입니다. 모든 페이지가 이 크기여야 주문할 수 있어요 (허용 오차 ±1mm). 회전·별도 잘림 영역은 허용하지 않습니다.</p>{!!layout.addedPages && <p>원본 뒤에 빈 쪽 {layout.addedPages}쪽이 추가됩니다.</p>}</div>;
}
export function RequestDetails({ request }: { request: PrintRequest }) {
  const doc: RequestDocument = JSON.parse(request.document_json), provider: ProviderState = request.provider_json ? JSON.parse(request.provider_json) : {};
  return <div className="print-request-details"><p><b>{doc.classroom.school} {doc.classroom.grade}학년 {doc.classroom.classNumber}반</b><br />{doc.teacher.name} · {doc.teacher.email}</p><p>수령인: {doc.shipping.recipientName} · {doc.shipping.recipientPhone}<br />({doc.shipping.postalCode}) {doc.shipping.address1} {doc.shipping.address2}<br />배송 메모: {doc.shipping.memo || "없음"}</p><p>요청 사항: {doc.notes || "없음"}</p><p>접수번호: {request.id}<br />{request.environment === "live" ? "실물 제작" : "Sandbox · 실제 제작/배송 없음"}</p><a className="small-button" href={`/api/print-requests/${request.id}?kind=request`}>주문 요청서 다운로드</a>
    {doc.items.map((item) => <article className="book-panel" key={item.id}><h3>{item.title} · {item.quantity}권</h3><p>{item.layout.spec.name}</p><PrintDimensions layout={item.layout} /><div className="book-toolbar"><a className="small-button" href={`/api/print-requests/${request.id}?item=${item.id}&kind=cover`}>접수한 표지 PDF</a><a className="small-button" href={`/api/print-requests/${request.id}?item=${item.id}&kind=inner`}>접수한 내지 PDF</a></div><details><summary>모든 페이지 실측값</summary><p>표지: {item.measurements.cover.map((p) => `${p.page}p ${p.widthMm}×${p.heightMm}mm`).join(" / ")}</p><p>내지: {item.measurements.inner.map((p) => `${p.page}p ${p.widthMm}×${p.heightMm}mm`).join(" / ")}</p></details></article>)}
    {provider.result && <p>{provider.result.orderStatusDisplay ?? "제작사 발주 완료"} · {provider.result.orderUid}{provider.result.trackingNumber && ` · 운송장 ${provider.result.trackingNumber}`}</p>}
    {request.error && <p className="error-box">{request.error}</p>}
  </div>;
}

export function RequestHistory({ request }: { request: PrintRequest }) {
  const [detail, setDetail] = useState<PrintRequest | null>(null), [error, setError] = useState("");
  return <details className="book-panel" onToggle={(event) => { if (event.currentTarget.open) void teacherRequest<PrintRequest>(`/api/print-requests/${request.id}?kind=detail`).then(setDetail).catch((e) => setError(e.message)); }}><summary>{requestStatus(request.status)} · {request.created_at}</summary>{error && <p role="alert">{error}</p>}{detail ? <RequestDetails request={detail} /> : <p>원고 정보를 불러오는 중…</p>}</details>;
}
