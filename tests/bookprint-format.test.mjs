import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { emptyStorybookDocument, storybookAspectRatio, validateStorybookDocument } from "../lib/storybook-model.ts";
import { printPdfs, printPageCount, renderBookPages } from "../lib/book-render.ts";
import { validatePrintPdf } from "../lib/print-validation.ts";
import { assertBookPrintSize } from "../lib/book-print-format.ts";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
const spec = { bookSpecUid: "SQUAREBOOK_HC", name: "스퀘어북", bindingType: "PUR", pageMin: 24, pageMax: 130, pageIncrement: 2, innerTrimWidthMm: 243, innerTrimHeightMm: 248, hingeGapMm: 10 };
const size = { innerWidthMm: 249, innerHeightMm: 254, coverWidthMm: 544, coverHeightMm: 288, spineWidthMm: 10 };
test("new book has exact trim ratio; existing formats remain readable", () => {
  const doc = emptyStorybookDocument();
  assert.equal(doc.format, "squarebook-hc");
  assert.equal(storybookAspectRatio(doc.format), 243 / 248);
  for (const format of ["landscape", "portrait", "square", "squarebook-hc"]) assert.equal(validateStorybookDocument(emptyStorybookDocument(format)).format, format);
});

test("cover contains only the first source page; inner starts at the second and keeps the last", async () => {
  const colors = ['#ff0000','#00ff00','#0000ff'];
  const images = await Promise.all(colors.map(background => sharp({create:{width:243,height:248,channels:3,background}}).jpeg().toBuffer()));
  const result = await printPdfs(images,spec,size,'표지 분리');
  assert.equal(result.addedPages,22);
  async function sample(bytes,pageNumber,rx,ry) {
    const task=getDocument({data:new Uint8Array(bytes)}),pdf=await task.promise,page=await pdf.getPage(pageNumber),viewport=page.getViewport({scale:.5});
    const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height)),context=canvas.getContext('2d');
    await page.render({canvasContext:context,viewport}).promise;
    const color=[...context.getImageData(Math.floor(canvas.width*rx),Math.floor(canvas.height*ry),1,1).data].slice(0,3);await task.destroy();return color;
  }
  const front=await sample(result.cover,1,.75,.5),back=await sample(result.cover,1,.25,.5);
  assert.ok(front[0]>240&&front[1]<10&&front[2]<10);
  assert.ok(back.every(v=>v>220),'back cover must not repeat the final story page');
  const first=await sample(result.inner,1,.5,.5),last=await sample(result.inner,2,.5,.5),blank=await sample(result.inner,3,.5,.5);
  assert.ok(first[1]>240&&first[0]<10&&first[2]<10,'inner page one must be source page two');
  assert.ok(last[2]>240&&last[0]<10&&last[1]<10,'last source page remains inside');
  assert.ok(blank.every(v=>v>250));
});
test("print page and spine boundaries follow the hardcover product", () => {
  for (const [n, expected] of [[1,24],[24,24],[25,26],[63,64],[65,66],[129,130]]) assert.equal(printPageCount(n,spec),expected);
  assert.throws(() => printPageCount(131,spec));
  assertBookPrintSize(size,64);
  assertBookPrintSize({...size,coverWidthMm:550,spineWidthMm:16},66);
  assert.throws(() => assertBookPrintSize(size,66));
  assert.throws(() => assertBookPrintSize({...size,innerWidthMm:243},24));
});
test("rendered pages and both generated PDFs retain the required physical geometry", async () => {
  const doc = emptyStorybookDocument(); doc.pages[0].background="#338866";
  const images=await renderBookPages(doc,new Map(),243);
  const meta=await sharp(images[0]).metadata(); assert.equal(meta.width,243); assert.equal(meta.height,248);
  const result=await printPdfs(images,spec,size,"규격 확인");
  const layout={spec,size,pageCount:24};
  assert.equal((await validatePrintPdf(result.inner,"inner",layout)).length,24);
  assert.equal((await validatePrintPdf(result.cover,"cover",layout)).length,1);
  const pdf=await PDFDocument.load(result.inner), trim=pdf.getPage(0).getTrimBox();
  assert.ok(Math.abs(trim.x*25.4/72-3)<.0001);
  assert.ok(Math.abs(trim.width*25.4/72-243)<.0001);
  assert.ok(Math.abs(trim.height*25.4/72-248)<.0001);
  await assert.rejects(printPdfs(images,{...spec,bookSpecUid:"PHOTOBOOK_A4_SC"},size,"wrong"));
});
