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
doc.pages[0].elements.push(illustration);
await server.DB.prepare('UPDATE storybooks SET title=?,document_json=? WHERE id=?').bind('처음 제목',JSON.stringify(doc),id).run();
const browser=await chromium.launch({executablePath:process.env.BOOK_CHROME_PATH || undefined,headless:true});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true});
 await context.addInitScript(({student,token,expiresAt})=>{localStorage.setItem('wiggle.deviceProfiles.v2',JSON.stringify([{studentId:student,nickname:'별',animal:'cat',classroomName:'편집 검증반'}]));sessionStorage.setItem('wiggle.activeSession.v2',JSON.stringify({studentId:student,deviceToken:token,expiresAt}));},{student,token,expiresAt});
 const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let imageGets=0;page.on('request',r=>{if(r.url().includes(`/api/storybooks/${id}/assets/`)&&r.method()==='GET')imageGets++;});
 await page.goto(server.origin+'/student/books/'+id);
 const title=page.getByRole('textbox',{name:'그림책 제목',exact:true}),text=page.getByRole('textbox',{name:'이 쪽의 이야기',exact:true});
 await text.waitFor();await page.waitForFunction(()=>!document.querySelector('.storybook-inline-text').disabled);
 assert.equal(await page.getByRole('button',{name:/이야기 쓰기/}).count(),0);
 await text.click();assert.ok(await text.evaluate(e=>document.activeElement===e));
 await page.keyboard.insertText('책 위를 눌러 바로 쓰는 이야기');
 assert.equal(await text.inputValue(),'책 위를 눌러 바로 쓰는 이야기');
 console.log('PASS clicking the visible story area focuses it and accepts typing without a toolbar button');
 assert.equal(await page.locator('.storybook-inspector textarea').count(),0);
 assert.equal(await text.evaluate(e=>getComputedStyle(e).textAlign),'left');
 await text.fill('가나다라마바사아자차카타파하가나다라마바사아자차카타파하');
 assert.equal((await text.inputValue()).length,28);
 assert.ok(await text.evaluate(e=>e.scrollHeight<=e.clientHeight+1));
 const accepted=await text.inputValue();await text.fill('가'.repeat(800));assert.equal(await text.inputValue(),accepted);
 await page.getByRole('status').filter({hasText:'이야기 칸이 가득'}).waitFor();
 await text.fill('\n한글을 직접 쓰는 이야기입니다.');
 await text.dispatchEvent('compositionstart');await text.fill('\n한글을 직접 쓰는 이야기입니다. 봄');await text.dispatchEvent('compositionend');
 assert.match(await text.inputValue(),/봄$/);
 async function saved(){await page.waitForFunction(()=>document.querySelector('.storybook-save-state')?.textContent.includes('✓ 저장됨'));}
 await saved();
 let release,started;const held=new Promise(r=>{release=r;}),inFlight=new Promise(r=>{started=r;});let delayed=false;
 await page.route('**/api/storybooks/'+id,async route=>{if(route.request().method()==='PUT'&&!delayed){delayed=true;const response=await route.fetch();started();await held;await route.fulfill({response});}else await route.continue();});
 await title.fill('저장 중인 옛 제목');await inFlight;await title.fill('늦은 응답에도 남는 새 제목');release();await saved();
 assert.equal(await title.inputValue(),'늦은 응답에도 남는 새 제목');
 await page.unroute('**/api/storybooks/'+id);await page.reload();await text.waitFor();assert.equal(await title.inputValue(),'늦은 응답에도 남는 새 제목');
 assert.equal(await text.inputValue(),'\n한글을 직접 쓰는 이야기입니다. 봄');
 console.log('PASS inline left text, wrapping, capacity, Korean composition and delayed save title race');
 await page.locator('.storybook-stage:not(.preview) .image img').waitFor();const initialGets=imageGets;
 await page.locator('.storybook-page-rail button').nth(1).click();await page.locator('.storybook-page-rail button').nth(0).click();
 await page.locator('.storybook-stage:not(.preview) .image img').waitFor();assert.equal(imageGets,initialGets);
 await page.getByRole('button',{name:'미리보기',exact:true}).click();await page.getByRole('dialog').locator('.image img').waitFor();assert.equal(imageGets,initialGets);
 await page.getByRole('button',{name:'편집으로 돌아가기',exact:true}).click();
 const image=page.locator('.storybook-stage:not(.preview) .storybook-stage-element.image');await image.click();await page.getByLabel('비율 유지',{exact:true}).uncheck();
 const before=await image.boundingBox(),handle=await page.locator('.moveable-e').boundingBox();assert.ok(handle);
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+35,handle.y+handle.height/2,{steps:8});await page.mouse.up();
 const after=await image.boundingBox();assert.ok(after.width>before.width+15,JSON.stringify({before,after}));assert.ok(Math.abs(after.height-before.height)<2);
 await saved();await page.reload();await image.locator('img').waitFor();const reopened=await image.boundingBox();assert.ok(Math.abs(reopened.width-after.width)<2);assert.ok(Math.abs(reopened.height-after.height)<2);
 console.log('PASS image cache on revisit/preview and one-axis resizing persists');
 async function rejected(pattern){let message='';page.once('dialog',async dialog=>{message=dialog.message();await dialog.accept();});await page.getByRole('button',{name:'완성하기',exact:true}).click();assert.match(message,pattern);assert.equal(await page.getByRole('dialog',{name:'그림책 미리보기'}).count(),0);await page.locator('.storybook-editor-error[role=alert]').getByRole('button',{name:'닫기',exact:true}).click();}
 await saved();await rejected(/최소 24/);await page.getByRole('button',{name:'쪽 복제',exact:true}).click();await saved();
 await title.fill('');await rejected(/제목/);await saved();await page.reload();assert.equal(await title.inputValue(),'');
 await title.fill('나의 새 그림책');await rejected(/제목/);
 await title.fill('별과 함께한 스물네 장');await saved();await page.getByRole('button',{name:'완성하기',exact:true}).click();
 await page.getByRole('dialog',{name:'그림책 미리보기'}).waitFor();assert.equal(await page.getByRole('link',{name:'첫 화면으로',exact:true}).getAttribute('href'),'/student');
 await page.waitForTimeout(1400);assert.equal((await server.DB.prepare('SELECT status FROM storybooks WHERE id=?').bind(id).first()).status,'complete');
 await page.getByRole('button',{name:'편집으로 돌아가기',exact:true}).click();
 await mkdir('work/storybook-0923',{recursive:true});
 for(const [width,height]of [[1440,1000],[320,568],[390,844],[844,390]]){
  await page.setViewportSize({width,height});await text.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow at ${width}`);
  assert.ok(await text.evaluate(e=>e.scrollHeight<=e.clientHeight+1),`text hidden at ${width}`);
  await page.locator('.storybook-stage:not(.preview) .image').click();
  await text.tap();assert.ok(await text.evaluate(e=>document.activeElement===e),`tap focus at ${width}`);
  assert.equal(await page.locator('.storybook-stage-element.selected').count(),0);
  await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.activeElement!==document.body));
  await page.screenshot({path:`work/storybook-0923/editor-${width}.png`,fullPage:true});
 }
 console.log('PASS 23-page/title completion guards, 24-page completion, home link and four responsive widths');
 assert.deepEqual(errors,[]);
}finally{await browser.close();await server.dispose();}
