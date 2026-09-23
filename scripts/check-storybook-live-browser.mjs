// Run after npm run build with BOOK_PLAYWRIGHT_MODULE and BOOK_CHROME_PATH if needed.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import sharp from 'sharp';
import {startTestServer} from '../tests/harness/server.mjs';
import {sha256} from '../lib/token-crypto.ts';
import {emptyStorybookDocument} from '../lib/storybook-model.ts';
const require=createRequire(import.meta.url),{chromium}=require(process.env.BOOK_PLAYWRIGHT_MODULE || 'playwright');
const server=await startTestServer({env:{OPENAI_API_KEY:'',SWEETBOOK_API_KEY:''}});
await server.fetch('/api/student');
const token=randomUUID(),student='student_editortest',room='class_editortest',expiresAt=new Date(Date.now()+3600000).toISOString();
await server.DB.batch([
 server.DB.prepare("INSERT INTO teachers(id,email,display_name) VALUES('teacher_editor','editor@example.test','교사')"),
 server.DB.prepare("INSERT INTO classrooms(id,teacher_id,display_name,class_code,join_token) VALUES(?,'teacher_editor','편집 검증반','1738',?)").bind(room,randomUUID()),
 server.DB.prepare("INSERT INTO student_profiles(id,classroom_id,nickname,animal,last_activity_at) VALUES(?,?,'별','cat',CURRENT_TIMESTAMP)").bind(student,room),
 server.DB.prepare("INSERT INTO device_sessions(token_hash,student_id,expires_at,last_used_at) VALUES(?,?,?,CURRENT_TIMESTAMP)").bind(await sha256(token),student,expiresAt)
]);
const headers={authorization:'Bearer '+token,'content-type':'application/json'};
const created=await(await server.fetch('/api/storybooks',{method:'POST',headers,body:'{}'})).json(),id=created.storybook.id;
const png=await sharp({create:{width:300,height:250,channels:3,background:'#87b870'}}).png().toBuffer();
const uploaded=await(await server.fetch(`/api/storybooks/${id}/assets`,{method:'POST',headers:{...headers,'content-type':'image/png'},body:png})).json();
const doc=emptyStorybookDocument();doc.pages=Array.from({length:23},(_,i)=>emptyStorybookDocument('squarebook-hc','page_editor'+String(i).padStart(8,'0'),'element_editor'+String(i).padStart(8,'0')).pages[0]);
const illustration={id:'element_editorimage',type:'image',assetId:uploaded.asset.id,rotation:0,opacity:1,locked:false,zIndex:1,x:.2,y:.35,width:.3,height:.25,aspectRatio:.3*(243/248)/.25};
doc.pages[0].elements.push(illustration); doc.pages[1].elements.push({...illustration,id:"element_secondimage"}); doc.pages[0].elements[0].text="첫 장면"; doc.pages[1].elements[0].text="두 번째 장면";
await server.DB.prepare('UPDATE storybooks SET title=?,document_json=? WHERE id=?').bind('처음 제목',JSON.stringify(doc),id).run();
const teacherToken=randomUUID();
await server.DB.prepare('INSERT INTO teacher_sessions(token_hash,teacher_id,expires_at,last_used_at) VALUES(?,?,?,CURRENT_TIMESTAMP)').bind(await sha256(teacherToken),'teacher_editor',expiresAt).run();
for(let i=0;i<2;i++) await server.DB.prepare("INSERT INTO storybooks(id,student_id,classroom_id,title,document_json) VALUES(?,?,?,?,?)").bind('storybook_otherdraft'+i,student,room,'아주 긴 제목의 그림책을 수정하고 있어요 '.repeat(3),JSON.stringify(doc)).run();
const browser=await chromium.launch({executablePath:process.env.BOOK_CHROME_PATH || undefined,headless:true});
try {
 const pupilContext=await browser.newContext({viewport:{width:1440,height:1000}}), teacherContext=await browser.newContext({viewport:{width:1440,height:1000}});
 await pupilContext.addInitScript(({student,token,expiresAt})=>{localStorage.setItem('wiggle.deviceProfiles.v2',JSON.stringify([{studentId:student,nickname:'별',animal:'cat',classroomName:'편집 검증반'}]));sessionStorage.setItem('wiggle.activeSession.v2',JSON.stringify({studentId:student,deviceToken:token,expiresAt}));},{student,token,expiresAt});
 await teacherContext.addCookies([{name:'wiggle_teacher',value:teacherToken,url:server.origin}]);
 const pupil=await pupilContext.newPage(),teacher=await teacherContext.newPage();pupil.setDefaultTimeout(20000);teacher.setDefaultTimeout(20000);
 const errors=[];for(const page of [pupil,teacher]) page.on('pageerror',e=>errors.push(e.message));
 let imageGets=0;teacher.on('request',r=>{if(r.url().includes('/assets/')&&r.method()==='GET') imageGets++;});
 const replies=[];teacher.on('response',async r=>{if(r.url().includes('/api/teacher/book-live?')&&r.url().includes('studentId=')){try{replies.push(await r.json());}catch{}}});
 await pupil.goto(server.origin+'/student/books/'+id);await pupil.getByRole('textbox',{name:'이 쪽의 이야기',exact:true}).waitFor();
 await teacher.goto(server.origin+'/teacher/class/'+room+'/books/live');await teacher.locator('.teacher-story-page img').waitFor();
 await pupil.getByText('선생님이 그림책을 함께 보고 있어요.',{exact:false}).waitFor();
 assert.equal(await teacher.locator('.teacher-story-page').innerText(),'첫 장면');const originalGets=imageGets;
 const text=pupil.getByRole('textbox',{name:'이 쪽의 이야기',exact:true});const changedAt=Date.now();await text.fill('친구와 함께 새로운 여행을 떠났어요.');
 await teacher.waitForFunction(()=>document.querySelector('.teacher-story-page')?.textContent.includes('새로운 여행'));
 const delay=Date.now()-changedAt;assert.ok(delay<5000,'live delay '+delay);
 await pupil.locator('.storybook-page-rail button').nth(1).click();await teacher.waitForFunction(()=>document.querySelector('.teacher-story-page')?.textContent.includes('두 번째 장면'));
 await teacher.locator('.teacher-story-page img').waitFor();assert.equal(imageGets,originalGets,'same asset must be reused across pages');
 await teacher.getByRole('button',{name:'이전 쪽',exact:true}).click();await teacher.waitForFunction(()=>document.querySelector('.teacher-story-page')?.textContent.includes('새로운 여행'));
 await teacher.getByRole('button',{name:'학생이 보는 쪽 따라가기',exact:true}).click();await teacher.waitForFunction(()=>document.querySelector('.teacher-story-page')?.textContent.includes('두 번째 장면'));
 await teacher.getByRole('textbox',{name:'2쪽에 조언 보내기'}).fill('여기에서 주인공의 마음을 조금 더 알려 줄까?');
 // Capture the page when typing starts: a student page turn must not redirect the advice.
 await pupil.locator('.storybook-page-rail button').nth(0).click();await teacher.waitForFunction(()=>document.querySelector('.book-live-navigation b')?.textContent==='1 / 23쪽');
 await teacher.getByRole('button',{name:'조언 보내기',exact:true}).click();await pupil.getByText('여기에서 주인공의 마음을 조금 더 알려 줄까?',{exact:true}).waitFor();
 assert.match(await pupil.locator('.storybook-teacher-advice').innerText(),/2쪽/);await pupil.getByRole('button',{name:'읽었어요',exact:true}).click();await teacher.getByText('2쪽 · 학생이 읽었어요',{exact:true}).waitFor();
 console.log('PASS live edit '+delay+'ms, page following/manual browsing, cached image reuse, page-anchored advice and read receipt');
 // Continued input must reach the teacher before the user stops typing.
 const title=pupil.getByRole('textbox',{name:'그림책 제목',exact:true});await title.fill('');let writes=0;pupil.on('request',r=>{if(r.method()==='PUT'&&r.url().endsWith('/api/storybooks/'+id))writes++;});
 await title.pressSequentially('계속 쓰는 이야기 제목이 선생님께 보여요',{delay:180});assert.ok(writes>=1,'continuous typing was never saved');
 await pupil.waitForFunction(()=>document.querySelector('.storybook-save-state')?.textContent.includes('저장됨'));
 await teacher.waitForFunction(()=>document.querySelector('.book-live-reader h2')?.textContent==='계속 쓰는 이야기 제목이 선생님께 보여요');
 await teacher.waitForTimeout(2200);assert.ok(replies.some(r=>r.book?.unchanged&&!r.book.page));assert.ok(replies.every(r=>!r.book?.document));assert.equal(imageGets,originalGets);
 const count=()=>replies.length;await teacher.getByRole('button',{name:'실시간 잠시 멈춤',exact:true}).click();await teacher.waitForTimeout(300);let before=count();await teacher.waitForTimeout(1800);assert.equal(count(),before);
 await teacher.getByRole('button',{name:'실시간 다시 보기',exact:true}).click();await teacher.waitForTimeout(1300);assert.ok(count()>before);
 // Simulate background-tab visibility; scheduling must stop without changing the drawing.
 await teacher.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await teacher.waitForTimeout(300);before=count();await teacher.waitForTimeout(1600);assert.equal(count(),before);
 await teacher.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
 let inflight=0,maxInflight=0;await teacher.route('**/api/teacher/book-live?**studentId=**',async route=>{inflight++;maxInflight=Math.max(maxInflight,inflight);await new Promise(r=>setTimeout(r,1500));try{await route.continue();}catch{}finally{inflight--;}});
 await teacher.waitForTimeout(4000);assert.equal(maxInflight,1);await teacher.unroute('**/api/teacher/book-live?**studentId=**');
 console.log('PASS continuous typing max-save, unchanged response skips pages, paused/hidden scheduling, slow network has one in-flight read');
 await mkdir('work/book-live-qa',{recursive:true});
 for(const width of [320,390,844,1440]){
  await teacher.setViewportSize({width,height:width===844?390:960});await teacher.waitForTimeout(150);
  assert.ok(await teacher.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'live overflow '+width);
  const bad=await teacher.locator('button,a.small-button,textarea').evaluateAll(es=>es.filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<43;}).map(e=>e.textContent));assert.deepEqual(bad,[],'small touch targets '+width);
  await teacher.screenshot({path:'work/book-live-qa/live-'+width+'.png',fullPage:true});
 }
 await teacher.goto(server.origin+'/teacher/class/'+room+'/books');await teacher.getByText(/편집 중인 책 ·/).click();
 for(const width of [320,390,844,1440]){
  await teacher.setViewportSize({width,height:900});
  assert.ok(await teacher.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'library overflow '+width);
  const rects=await teacher.locator('.book-draft-list a').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};}));assert.equal(rects.length,3);assert.ok(rects.every(r=>r.height>=44));assert.ok(rects.every((r,i)=>!i||r.top>=rects[i-1].bottom+8));
  await teacher.screenshot({path:'work/book-live-qa/drafts-'+width+'.png',fullPage:true});
 }
 assert.deepEqual(errors,[]);console.log('PASS resume buttons do not overlap, 4 responsive widths, no browser errors');
} finally {await browser.close();await server.dispose();}
