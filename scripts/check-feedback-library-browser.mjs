// Run after npm run build. Set BOOK_PLAYWRIGHT_MODULE and optionally BOOK_CHROME_PATH.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile, mkdir} from 'node:fs/promises';
import {unzipSync} from 'fflate';
import {PDFDocument} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {parseRubric} from '../lib/book-rubric.ts';
import {startTestServer} from '../tests/harness/server.mjs';
import {sha256} from '../lib/token-crypto.ts';
import {emptyStorybookDocument} from '../lib/storybook-model.ts';
const require=createRequire(import.meta.url),{chromium}=require(process.env.BOOK_PLAYWRIGHT_MODULE || 'playwright');
const server=await startTestServer({env:{OPENAI_API_KEY:'fixture',WIGGLE_BOOK_PROVIDER_FIXTURE:'true',WIGGLE_BOOK_PROVIDER_DELAY_MS:'2200',NODE_OPTIONS:'--import='+new URL('../tests/harness/book-provider-fixture.mjs',import.meta.url).href}});
await server.fetch('/api/student');
const teacher='teacher_feedback', room='class_feedback', token=randomUUID(), students=['student_feedback01','student_feedback02'];
await server.DB.batch([
 server.DB.prepare("INSERT INTO teachers(id,email,display_name) VALUES(?,?,'피드백 교사')").bind(teacher,'feedback@example.test'),
 server.DB.prepare("INSERT INTO classrooms(id,teacher_id,display_name,class_code,join_token) VALUES(?,?,'피드백 반','1928',?)").bind(room,teacher,randomUUID()),
 ...students.map((id,i)=>server.DB.prepare("INSERT INTO student_profiles(id,classroom_id,nickname,animal,last_activity_at,seat_number,real_name) VALUES(?,?,'별명','cat',CURRENT_TIMESTAMP,?,'테스트실명')").bind(id,room,i+1)),
 server.DB.prepare("INSERT INTO teacher_sessions(token_hash,teacher_id,expires_at,last_used_at) VALUES(?,?,?,CURRENT_TIMESTAMP)").bind(await sha256(token),teacher,new Date(Date.now()+3600000).toISOString()),
 ...[0,1,2].map(i=>{const doc=emptyStorybookDocument();doc.pages[0].elements[0].text='이야기 '+i;return server.DB.prepare("INSERT INTO storybooks(id,student_id,classroom_id,title,document_json,schema_version,revision,status,completed_at) VALUES(?,?,?,?,?,1,1,'complete',CURRENT_TIMESTAMP)").bind('storybook_feedback000'+i,students[i<2?0:1],room,'같은 제목',JSON.stringify(doc));})
]);
const browser=await chromium.launch({executablePath:process.env.BOOK_CHROME_PATH || undefined,headless:true});
try {
 const context=await browser.newContext();await context.addCookies([{name:'wiggle_teacher',value:token,url:server.origin}]);
 const page=await context.newPage();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.origin+'/teacher/class/'+room+'/books');
 const group1=page.getByRole('region',{name:'1번 테스트실명 그림책',exact:true}),group2=page.getByRole('region',{name:'2번 테스트실명 그림책',exact:true});
 await group1.waitFor();
 assert.equal(await page.getByRole('button',{name:'학년·반 저장',exact:true}).count(),0);assert.equal(await group1.locator('.book-library-card').count(),2);assert.equal(await group2.locator('.book-library-card').count(),1);
 assert.equal(await page.locator('.fm-generation, .feedback-files').count(),0);
 await page.getByRole('link',{name:'피드백 관리 열기 →',exact:true}).click();
 await page.getByLabel('전체 선택',{exact:true}).check();
 assert.equal(await page.getByRole('button',{name:'선택한 PDF 받기',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'선택한 책 피드백 만들기',exact:true}).click();
 await page.getByRole('button',{name:'피드백 만드는 중…',exact:true}).first().waitFor();
 await page.waitForFunction(()=>document.querySelector('.feedback-progress')?.textContent.includes('피드백 작성 중'));
 assert.equal(await page.locator('.feedback-spinner').first().isVisible(),true);
 await page.getByRole('button',{name:'현재 책까지 처리',exact:true}).click();
 await page.getByText(/처리를 멈췄어요/).first().waitFor();
 await page.getByRole('button',{name:'대기 작업 이어서 처리',exact:true}).click();
 await page.getByText(/피드백 처리 완료/).first().waitFor();
 await page.locator('.fm-criteria').waitFor();
 const student1=page.locator('.fm-student').first();
 await student1.getByRole('button',{name:'학생 전체 선택',exact:true}).click();
 let event=page.waitForEvent('download');await page.getByRole('button',{name:'선택한 PDF 받기',exact:true}).click();
 const zip=await event;const entries=unzipSync(await readFile(await zip.path()));assert.equal(Object.keys(entries).length,2);
 for(const bytes of Object.values(entries)) assert.ok((await PDFDocument.load(bytes)).getPageCount()>0);
 await page.getByText(/2권 다운로드를 시작했어요/).waitFor();
 await page.route('**/api/teacher/book-feedback/*?format=pdf*',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'PDF 검증용 실패'})}));
 await page.getByRole('button',{name:'이 책 PDF 받기',exact:true}).click();await page.getByRole('alert').filter({hasText:'PDF 검증용 실패'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'이 책 PDF 받기',exact:true}).isEnabled(),true);
 await page.unroute('**/api/teacher/book-feedback/*?format=pdf*');
 await page.reload();await page.locator('.fm-criteria').waitFor();assert.equal(await page.locator('.fm-book').count(),3);
 await server.DB.prepare("UPDATE book_feedback_jobs SET status='processing' WHERE storybook_id='storybook_feedback0000'").run();
 await page.reload();await page.locator('.fm-generation .feedback-progress').waitFor();
 await server.DB.prepare("UPDATE book_feedback_jobs SET status='complete' WHERE storybook_id='storybook_feedback0000'").run();
 await page.locator('.fm-generation .feedback-progress').waitFor({state:'detached'});
 await mkdir('work/feedback-qa',{recursive:true});
 for(const [width,height] of [[320,568],[390,844],[844,390],[1440,1000]]) {await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`work/feedback-qa/${width}.png`,fullPage:true});}
 await page.getByText('엑셀 양식 미리보기 · 어느 칸을 수정하나요?',{exact:true}).click();
 await page.locator('.rubric-sheet').waitFor();
 event=page.waitForEvent('download');await page.getByRole('link',{name:'현재 기준 엑셀 양식 받기',exact:true}).click();
 const template=await event;assert.equal((await parseRubric(new Uint8Array(await readFile(await template.path())))).criteria.length,10);
 await page.locator('.rubric-guide').screenshot({path:'work/feedback-qa/rubric-guide.png'});
 await page.locator('.fm-criteria').waitFor();
 assert.equal(await page.locator('.fm-student').count(),2);
 const checks=page.locator('.fm-criteria input');assert.equal(await checks.count(),10);
 await page.getByRole('button',{name:'모두 해제',exact:true}).click();
 await checks.nth(1).check();
 await page.getByLabel('영역별 점수 · 합계',{exact:true}).uncheck();
 await page.getByLabel('종합 의견 · 다음에 해 볼 일',{exact:true}).uncheck();
 await page.getByLabel('근거 쪽 번호',{exact:true}).check();
 assert.equal(await page.locator('.fm-preview article').count(),1);
 assert.equal(await page.locator('.fm-total').count(),0);
 event=page.waitForEvent('download');await page.getByRole('button',{name:'이 책 PDF 받기',exact:true}).click();
 const subset=await event;await subset.saveAs('work/feedback-qa/selected-feedback.pdf');
 const task=getDocument({data:new Uint8Array(await readFile(await subset.path()))});const pdf=await task.promise;
 let pdfText='';for(let n=1;n<=pdf.numPages;n++)pdfText+=(await(await pdf.getPage(n)).getTextContent()).items.map(x=>x.str).join(' ');
 assert.match(pdfText,/독자 고려/);assert.doesNotMatch(pdfText,/총점|그림책의 목적과 주제 설정|종합 의견|학년|null/);await task.destroy();
 await page.getByText(/1권 다운로드를 시작했어요/).waitFor();
 await checks.nth(1).uncheck();assert.equal(await page.getByRole('button',{name:'이 책 PDF 받기',exact:true}).isDisabled(),true);
 await checks.nth(1).check();
 await page.getByLabel('검색 결과의 완료 책 선택',{exact:true}).check();
 await page.getByRole('button',{name:'이 구성을 선택한 책에 적용',exact:true}).click();
 await page.getByText('3권에 현재 구성을 적용했어요.',{exact:true}).waitFor();
 await page.locator('.fm-book-button').last().click();assert.equal(await checks.nth(1).isChecked(),true);assert.equal(await checks.nth(0).isChecked(),false);
 event=page.waitForEvent('download');await page.getByRole('button',{name:'선택한 PDF 받기',exact:true}).click();
 const subsetZip=await event;const subsetEntries=unzipSync(await readFile(await subsetZip.path()));assert.equal(Object.keys(subsetEntries).length,3);
 await page.getByText(/3권 다운로드를 시작했어요/).waitFor();
 await page.getByLabel('학생 이름·번호·책 제목 검색',{exact:true}).fill('2번');assert.equal(await page.locator('.fm-student').count(),1);
 await page.getByLabel('학생 이름·번호·책 제목 검색',{exact:true}).fill('없는학생');assert.equal(await page.locator('.fm-student').count(),0);
 await page.getByLabel('학생 이름·번호·책 제목 검색',{exact:true}).fill('');
 for(const [width,height] of [[320,568],[390,844],[768,1024],[844,390],[1440,1000]]) {
   await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:`work/feedback-qa/manager-${width}.png`,fullPage:true});
   await page.locator('.fm-book-button').first().focus();await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.activeElement!==document.body));
 }
 console.log('PASS rubric template/guide, individual criteria + PDF text exclusion, empty selection guard, bulk apply, distinct ZIP names, student search, keyboard and five responsive widths');
 assert.deepEqual(errors,[]);console.log('PASS student identity grouping, live generation progress, stop/resume, persistent PDF collections, same-title ZIP contains two valid PDFs, single PDF, download progress/error recovery, four widths');
} finally {await browser.close();await server.dispose();}
