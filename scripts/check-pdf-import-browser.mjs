// Run after npm run build with Playwright installed (or BOOK_PLAYWRIGHT_MODULE).
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {startTestServer} from '../tests/harness/server.mjs';
import {sha256} from '../lib/token-crypto.ts';
const require=createRequire(import.meta.url),{chromium}=require(process.env.BOOK_PLAYWRIGHT_MODULE || 'playwright');
import { PDFDocument } from 'pdf-lib';
const server=await startTestServer(); await server.fetch('/api/student');
const teacher='teacher_pdf', room='class_pdfimport', student='student_pdfimport', token=randomUUID();
await server.DB.batch([
 server.DB.prepare("INSERT INTO teachers(id,email,display_name) VALUES(?,?,'PDF 교사')").bind(teacher,'pdf@example.test'),
 server.DB.prepare("INSERT INTO classrooms(id,teacher_id,display_name,class_code,join_token) VALUES(?,?,'PDF 반','1928',?)").bind(room,teacher,randomUUID()),
 server.DB.prepare("INSERT INTO student_profiles(id,classroom_id,nickname,animal,last_activity_at,seat_number,real_name) VALUES(?,?,'별명','cat',CURRENT_TIMESTAMP,1,'테스트학생')").bind(student,room),
 server.DB.prepare("INSERT INTO teacher_sessions(token_hash,teacher_id,expires_at,last_used_at) VALUES(?,?,?,CURRENT_TIMESTAMP)").bind(await sha256(token),teacher,new Date(Date.now()+3600000).toISOString())
]);
const browser=await chromium.launch({executablePath:process.env.BOOK_CHROME_PATH || undefined,headless:true});
try {
 const context=await browser.newContext();await context.addCookies([{name:'wiggle_teacher',value:token,url:server.origin}]);
 const page=await context.newPage();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.origin+'/teacher/class/'+room+'/books');
 const pdf=await PDFDocument.create();
 for(let i=0;i<131;i++){const p=pdf.addPage([420,595]);p.drawText('PDF page '+(i+1),{x:35,y:450,size:28});}
 await page.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles({name:'131-pages.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
 await page.locator('.pdf-import-row select').selectOption(student);
 // Exercise automatic recovery from throttling without changing server limits.
 let throttled=false;
 await page.route('**/api/teacher/book-editor/*/assets', async route=>{
  if(!throttled && route.request().method()==='POST'){throttled=true;await route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:'test throttle'})});}else await route.continue();
 });
 await page.getByRole('button',{name:'선택한 PDF 가져오기',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.pdf-import-row')?.textContent?.match(/가져오기 완료|가져오기 실패/),{},{timeout:300000});
 assert.equal(await page.getByText('가져오기 완료',{exact:true}).count(),1,await page.locator('.pdf-import-panel').innerText());
 const row=await server.DB.prepare("SELECT id,document_json AS doc,status FROM storybooks WHERE title='131-pages'").first();
 const doc=JSON.parse(row.doc);assert.equal(doc.pages.length,131);assert.equal(row.status,'complete');
 assert.equal(new Set(doc.pages.map(p=>p.backgroundAssetId)).size,131);
 const assets=await server.DB.prepare('SELECT COUNT(*) AS count FROM storybook_assets WHERE storybook_id=?').bind(row.id).first();assert.equal(assets.count,131);
 for(const [width,height] of [[320,568],[390,844],[844,390]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 await page.goto(server.origin+'/teacher/class/'+room+'/books/'+row.id+'/edit');
 await page.getByLabel('이 쪽의 이야기',{exact:true}).waitFor();
 await page.locator('.storybook-page-rail button').nth(130).click();
 await page.getByLabel('이 쪽의 이야기',{exact:true}).fill('마지막 131쪽 수정');
 await page.getByRole('button',{name:'완성하기',exact:true}).click();
 await page.getByRole('button',{name:'편집으로 돌아가기',exact:true}).waitFor();
 await page.waitForTimeout(1500);
 const saved=JSON.parse((await server.DB.prepare('SELECT document_json AS doc FROM storybooks WHERE id=?').bind(row.id).first()).doc);
 assert.equal(saved.pages.length,131);assert.equal(saved.pages[130].elements[0].text,'마지막 131쪽 수정');
 assert.deepEqual(errors,[]);console.log('PASS 131-page real PDF import, 429 recovery, 131 distinct assets, complete reload and last-page editing, 3 viewport widths');
} finally {await browser.close();await server.dispose();}
