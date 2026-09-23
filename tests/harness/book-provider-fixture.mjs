// Isolated test-process transport. Never loaded by application code or normal dev servers.
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
if (process.env.WIGGLE_APP_ENV !== "test" || process.env.WIGGLE_BOOK_PROVIDER_FIXTURE !== "true") throw new Error("Book fixture may only run in an isolated test server");
const original = globalThis.fetch;
const books = new Map(), orders = new Map(), failures = new Set();
const spec = { bookSpecUid: "SQUAREBOOK_HC", name: "검증용 스퀘어 하드커버", pageMin: 24, pageMax: 130, pageIncrement: 2, bindingType: "PUR", innerTrimWidthMm: 243, innerTrimHeightMm: 248, hingeGapMm: 10 };
const size = { coverWidthMm: 544, coverHeightMm: 288, innerWidthMm: 249, innerHeightMm: 254, spineWidthMm: 10 };
const ok = (data) => Response.json({ success: true, data });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["api.openai.com", "api-sandbox.sweetbook.com"].includes(url.hostname)) {
    if (url.hostname === "api.sweetbook.com") throw new Error("Live service forbidden in tests");
    return original(input, init);
  }
  const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
  if (url.hostname === "api.openai.com") {
    if (process.env.WIGGLE_BOOK_PROVIDER_DELAY_MS) await new Promise(resolve => setTimeout(resolve, Math.min(5000, Number(process.env.WIGGLE_BOOK_PROVIDER_DELAY_MS) || 0)));
    assert.equal(body.store, false);
    const rubric = JSON.parse(body.instructions.split("<rubric_data>\n")[1].split("\n</rubric_data>")[0]);
    const content = body.input[0].content, texts = content.filter((c) => c.type === "input_text"), images = content.filter((c) => c.type === "input_image");
    assert.equal(images.length, texts.length); assert.ok(images.length > 0);
    assert.ok(images.every((i) => i.image_url.startsWith("data:image/jpeg;base64,")));
    assert.ok(!JSON.stringify(body).includes("테스트실명"));
    const marker = texts.map((t) => t.text).join(" ");
    if (marker.includes("실패테스트") && !failures.has(marker)) { failures.add(marker); return Response.json({ error: "synthetic failure" }, { status: 429 }); }
    await new Promise((r) => setTimeout(r, 50));
    return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ summary: "마지막 쪽에 인물의 생각을 더 적어 보세요.", criteria: rubric.criteria.map((c) => ({ id: c.id, score: c.levels[1].score, feedback: `${texts[0].text.split("\n")[1]}의 장면에서 인물의 마음이 드러남. ${images.length}쪽의 결말에 대화를 더하면 변화가 분명해질 수 있음.`, pages: [1, images.length] })) }) }] }] });
  }
  const path = url.pathname.replace(/^\/v1/, "");
  if (path === "/book-specs") return ok([spec]);
  if (path === "/book-specs/SQUAREBOOK_HC") return ok(spec);
  if (path.endsWith("/calculated-size")) return ok(size);
  const method = init.method ?? "GET", headers = new Headers(init.headers);
  if (path === "/books" && method === "POST") {
    const key = headers.get("idempotency-key"); assert.ok(key); assert.equal(body.creationType, "PDF_UPLOAD"); assert.equal(body.pageCount, 24); assert.equal(body.bookSpecUid, "SQUAREBOOK_HC");
    if (!books.has(key)) books.set(key, { bookUid: `bk_${key}`, pageCount: body.pageCount });
    return ok(books.get(key));
  }
  if (/\/pdf-(cover|contents)$/.test(path)) {
    const file = body.get("file"); const pdf = await PDFDocument.load(await file.arrayBuffer());
    assert.equal(pdf.getPageCount(), path.endsWith("cover") ? 1 : 24);
    for (const page of pdf.getPages()) {
      const expected = path.endsWith("cover") ? [544,288] : [249,254];
      assert.ok(Math.abs(page.getWidth()*25.4/72-expected[0])<.01);
      assert.ok(Math.abs(page.getHeight()*25.4/72-expected[1])<.01);
    }
    return ok({ valid: true });
  }
  if (path.endsWith("/finalization")) return ok({ status: "finalized" });
  if (path === "/orders/estimate") {
    assert.ok(body.items.length > 0 && body.items.length <= 50);
    assert.ok(body.items.every((i) => i.bookUid.startsWith("bk_")));
    return ok({ totalAmount: body.items.reduce((s, i) => s + i.quantity * 10000, 0), paidCreditAmount: body.items.reduce((s, i) => s + i.quantity * 11000, 0), creditBalance: 1000000, creditSufficient: true });
  }
  if (path === "/orders" && method === "POST") {
    const key = headers.get("idempotency-key"); assert.ok(key);
    if (orders.has(key)) { assert.equal(JSON.stringify(body), orders.get(key).request); return ok(orders.get(key).response); }
    const result = { orderUid: `or_${key}`, orderStatus: "PAID", orderStatusDisplay: "결제완료", paidCreditAmount: 22000 };
    orders.set(key, { request: JSON.stringify(body), response: result });
    if (body.shipping.memo === "응답유실테스트") throw new Error("Synthetic lost response after provider accepted payment");
    return ok(result);
  }
  if (path.startsWith("/orders/") && method === "GET") return ok({ orderUid: path.split("/").at(-1), orderStatus: "SHIPPED", orderStatusDisplay: "발송완료", trackingNumber: "TEST-1234" });
  throw new Error(`Unexpected fixture path: ${method} ${path}`);
};
