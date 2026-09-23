import { mkdir } from "node:fs/promises";
// Run after npm run build: node --import ./tests/harness/register.mjs scripts/check-book-browser.mjs
// Requires Playwright (or BOOK_PLAYWRIGHT_MODULE pointing to its installed module).
import assert from "node:assert/strict";

import { randomUUID } from "node:crypto";
import { startTestServer } from "../tests/harness/server.mjs";
import { sha256 } from "../lib/token-crypto.ts";
import { emptyStorybookDocument } from "../lib/storybook-model.ts";


import {createRequire} from "node:module";
const require=createRequire(import.meta.url); const {chromium}=require(process.env.BOOK_PLAYWRIGHT_MODULE || "playwright");

const server = await startTestServer({env:{OPENAI_API_KEY:'fixture',SWEETBOOK_API_KEY:'fixture',WIGGLE_BOOK_PROVIDER_FIXTURE:'true',NODE_OPTIONS:'--import='+new URL('../tests/harness/book-provider-fixture.mjs',import.meta.url).href}});
await server.fetch('/api/student');
  const teacherId = `teacher_${randomUUID()}`, classroomId = `class_${randomUUID().replaceAll("-", "").slice(0,24)}`, studentId = `student_${randomUUID()}`, session = randomUUID();
  const ids = [1,2].map(() => `storybook_${randomUUID().replaceAll("-", "")}`);
  const docs = ["친구의 마음", "실패테스트 이야기"].map((title) => { const doc = emptyStorybookDocument("square"); doc.pages[0].elements.find((e) => e.type === "text").text = title; const second = emptyStorybookDocument("square", "page_second0001", "element_secondtext0001"); second.pages[0].elements.find((e) => e.type === "text").text = "우리는 서로 손을 잡았어요."; doc.pages.push(second.pages[0]); return doc; });
  await server.DB.batch([
    server.DB.prepare("INSERT INTO teachers(id,email,display_name) VALUES (?,?,'테스트교사')").bind(teacherId, `${teacherId}@example.test`),
    server.DB.prepare("INSERT INTO classrooms(id,teacher_id,display_name,class_code,join_token) VALUES (?,?,'검증반','8457',?)").bind(classroomId, teacherId, randomUUID()),
    server.DB.prepare("INSERT INTO student_profiles(id,classroom_id,nickname,animal,last_activity_at,seat_number,real_name) VALUES (?,?,'별명','cat',CURRENT_TIMESTAMP,1,'테스트실명')").bind(studentId, classroomId),
    server.DB.prepare("INSERT INTO teacher_sessions(token_hash,teacher_id,expires_at,last_used_at) VALUES (?,?,?,CURRENT_TIMESTAMP)").bind(await sha256(session), teacherId, new Date(Date.now() + 3_600_000).toISOString()),
    ...ids.map((id,i) => server.DB.prepare("INSERT INTO storybooks(id,student_id,classroom_id,title,document_json,schema_version,revision,status,completed_at) VALUES (?,?,?,?,?,1,1,'complete',CURRENT_TIMESTAMP)").bind(id,studentId,classroomId,`다른 책 ${i}`,JSON.stringify(docs[i]))),
  ]);

await mkdir("work/book-qa",{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
const context=await browser.newContext(); await context.addCookies([{name:'wiggle_teacher',value:session,url:server.origin}]);
const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(server.origin+'/teacher/class/'+classroomId+'/books/feedback');
await page.getByLabel('전체 선택',{exact:true}).check();await page.getByRole('button',{name:'선택한 책 피드백 만들기',exact:true}).click();
await page.getByText(/피드백 처리 완료/).waitFor();
await page.getByRole('button',{name:'선택한 책 피드백 만들기',exact:true}).click();await page.getByText(/피드백 처리 완료/).waitFor();
await page.waitForFunction(()=>[...document.querySelectorAll('.fm-book-button')].filter(e=>e.textContent.includes('준비 완료')).length===2);
await page.getByLabel('검색 결과의 완료 책 선택',{exact:true}).check();
const download=page.waitForEvent('download');await page.getByRole('button',{name:'선택한 PDF 받기',exact:true}).click(); assert.equal((await download).suggestedFilename(),'학생별_선택피드백.zip');
for(const route of ['books','books/orders']) {await page.goto(server.origin+'/teacher/class/'+classroomId+'/'+route); await page.getByText('다른 책 0',{exact:true}).waitFor();for(const [w,h] of [[320,568],[390,844],[844,390],[1440,1000]]) {await page.setViewportSize({width:w,height:h});await page.waitForTimeout(150);await page.screenshot({path:"work/book-qa/debug-"+w+".png",fullPage:true}); assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll("*")].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,class:e.className,w:e.getBoundingClientRect().width})).slice(0,12))));await page.screenshot({path:'work/book-qa/'+route.replace('/','-')+'-'+w+'.png',fullPage:true});await page.locator('a[href]').first().focus(); await page.keyboard.press('Tab'); assert.ok(await page.evaluate(()=>document.activeElement!==document.body));}}
await page.setViewportSize({width:1440,height:1000});
await page.getByLabel('우리 반 전체 선택',{exact:true}).check();
await page.getByRole('button',{name:'선택한 책 인쇄 준비 · 재시도'}).click();
await page.waitForFunction(()=>document.querySelectorAll('.status-ready').length===2);
for(const [label,value] of [['수령인','검증교사'],['연락처','010-0000-0000'],['우편번호','12345'],['주소','테스트시 테스트로 123'],['상세주소','4층'],['배송 메모','']])await page.getByLabel(label,{exact:true}).fill(value);
await page.getByLabel('학교',{exact:true}).fill('위글검증초등학교');
await page.getByLabel('학년',{exact:true}).fill('4');await page.getByLabel('반',{exact:true}).fill('2');
await page.getByLabel('모든 PDF의 페이지 크기·글·그림·빈 쪽, 수량과 배송지를 확인했습니다.').check();
await page.getByRole('button',{name:'운영자에게 제작 요청 보내기'}).click();
await page.getByText('운영자에게 제작 요청서를 보냈어요. 아래에서 접수 상태를 확인하세요.').waitFor();
// Teacher-provided production PDFs: size lookup, browser chunk upload, per-page validation, separate single-book request.
const {PDFDocument: PrintPdf}=await import('pdf-lib');
const printCover=await PrintPdf.create();printCover.addPage([544*72/25.4,288*72/25.4]);
const printInner=await PrintPdf.create();for(let n=0;n<24;n++)printInner.addPage([249*72/25.4,254*72/25.4]);
await page.getByLabel('책 이름',{exact:true}).fill('직접 첨부한 인쇄 원고');
await page.getByRole('button',{name:'필요한 PDF 크기 확인'}).click();
await page.getByLabel('표지 PDF',{exact:true}).setInputFiles({name:'cover.pdf',mimeType:'application/pdf',buffer:Buffer.from(await printCover.save())});
await page.getByLabel('내지 PDF',{exact:true}).setInputFiles({name:'inner.pdf',mimeType:'application/pdf',buffer:Buffer.from(await printInner.save())});
await page.getByRole('button',{name:'모든 페이지 검사하고 추가'}).click();await page.getByText('직접 첨부한 인쇄 원고 · 규격 검사 완료',{exact:true}).waitFor();
await page.getByLabel('모든 PDF의 페이지 크기·글·그림·빈 쪽, 수량과 배송지를 확인했습니다.').check();
await page.getByRole('button',{name:'운영자에게 제작 요청 보내기'}).click();
await page.getByText('운영자에게 제작 요청서를 보냈어요. 아래에서 접수 상태를 확인하세요.').waitFor();
const adminToken=randomUUID();await server.DB.batch([
server.DB.prepare("INSERT INTO teachers(id,email,display_name) VALUES('admin_browser','qudcks1940@gmail.com','운영검증관리자')"),
server.DB.prepare("INSERT INTO teacher_sessions(token_hash,teacher_id,expires_at,last_used_at) VALUES(?,'admin_browser',?,CURRENT_TIMESTAMP)").bind(await sha256(adminToken),new Date(Date.now()+3600000).toISOString())]);
await context.addCookies([{name:'wiggle_teacher',value:adminToken,url:server.origin}]);
await page.goto(server.origin+'/admin'); await page.getByRole('button',{name:/위글검증초등학교/}).first().click();
await page.getByRole('button',{name:'제작사에 원고 준비 · 견적 조회'}).click();
await page.getByRole('button',{name:'Sandbox 테스트 발주'}).waitFor();
await page.getByLabel('접수 원고·수량·배송지·충전금 차감 금액을 확인했습니다.').check();
await page.getByRole('button',{name:'Sandbox 테스트 발주'}).click();await page.getByRole('button',{name:'제작 · 배송 상태 조회'}).waitFor();
for(const tab of ['제작 요청','교사 · 학급 · 참여자','서버 · 수용 인원']){await page.getByRole('button',{name:tab,exact:true}).click();for(const [width,height] of [[320,568],[390,844],[844,390],[1440,1000]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`admin overflow ${tab} ${width}`);await page.screenshot({path:`work/book-qa/admin-${tab.slice(0,2)}-${width}.png`,fullPage:true});}}
await page.setViewportSize({width:1440,height:1000});
await context.addCookies([{name:'wiggle_teacher',value:session,url:server.origin}]);

await page.goto(server.origin+'/teacher/class/'+classroomId+'/books');
const {PDFDocument,rgb}=await import('pdf-lib');const sourcePdf=await PDFDocument.create();
for(let i=0;i<3;i++){const p=sourcePdf.addPage([420,595]);p.drawRectangle({x:0,y:0,width:420,height:595,color:[rgb(.9,.95,1),rgb(1,.95,.8),rgb(.9,1,.9)][i]});p.drawText('Imported page '+(i+1),{x:35,y:450,size:28});}
await page.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles({name:'PDF-import-test.pdf',mimeType:'application/pdf',buffer:Buffer.from(await sourcePdf.save())});
await page.locator('.pdf-import-row select').selectOption(studentId); await page.getByRole('button',{name:'선택한 PDF 가져오기',exact:true}).click();
await page.waitForFunction(()=>document.querySelector('.pdf-import-row')?.textContent?.match(/가져오기 완료|가져오기 실패/),{},{timeout:60000}); assert.ok(await page.getByText('가져오기 완료',{exact:true}).count(),await page.locator('.pdf-import-panel').innerText());
const imported=(await server.DB.prepare("SELECT id,document_json AS doc FROM storybooks WHERE title='PDF-import-test'").first());
assert.equal(JSON.parse(imported.doc).pages.length,3);assert.ok(JSON.parse(imported.doc).pages.every(p=>p.backgroundAssetId && p.elements[0].text===''));
await page.goto(server.origin+'/teacher/class/'+classroomId+'/books/'+imported.id+'/edit');
await page.getByLabel('이 쪽의 이야기',{exact:true}).waitFor();assert.equal(await page.getByLabel('이 쪽의 이야기',{exact:true}).inputValue(),'');
await page.getByLabel('이 쪽의 이야기',{exact:true}).fill('PDF 위에 덧붙인 새로운 이야기');
await page.getByRole('button',{name:'완성하기',exact:true}).click();await page.getByRole('button',{name:'편집으로 돌아가기'}).waitFor();
await page.waitForTimeout(1300); await page.screenshot({path:'work/book-qa/imported-preview.png',fullPage:true});
const saved=await server.DB.prepare('SELECT document_json AS doc,status FROM storybooks WHERE id=?').bind(imported.id).first();assert.equal(saved.status,'complete');assert.equal(JSON.parse(saved.doc).pages[0].elements[0].text,'PDF 위에 덧붙인 새로운 이야기');
const requestHeaders={origin:server.origin};
for(const [url,body] of [['book-feedback',{storybookIds:[imported.id]}],['book-feedback/process',{}],['book-print',{action:'prepare',storybookIds:[imported.id],specUid:'SQUAREBOOK_HC'}],['book-print/process',{}]]){const r=await context.request.post(server.origin+'/api/teacher/'+url,{headers:requestHeaders,data:{classroomId,...body}});assert.ok(r.ok(),await r.text());}
assert.equal((await server.DB.prepare('SELECT status FROM book_feedback_jobs WHERE storybook_id=?').bind(imported.id).first()).status,'complete');
assert.equal((await server.DB.prepare('SELECT status FROM book_print_jobs WHERE storybook_id=?').bind(imported.id).first()).status,'ready');
assert.deepEqual(errors,[]);console.log('Book/admin browser checks passed: bulk feedback, retry, ZIP, external PDF editing, production PDF upload, teacher requests, administrator order, 5 views × 4 sizes, keyboard focus.');
}finally{await browser.close();await server.dispose();}
