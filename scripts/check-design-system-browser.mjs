// Run after npm run build. Capture --baseline on the base revision before changing styles.
// Without a saved baseline, still checks the protected route boundary and every extended surface.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {designFixture} from '../tests/harness/design-fixture.mjs';
import {createFamilyShare,exchangeFamilyInvite} from '../lib/family-sharing.ts';
const {chromium}=createRequire(import.meta.url)(process.env.BOOK_PLAYWRIGHT_MODULE || 'playwright');
const {server,room,book,token,teacherToken,adminToken,expiresAt,student}=await designFixture();
const baseline=process.argv.includes('--baseline');
const dir='work/design-audit/'+(baseline?'before':'after');await mkdir(dir,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.BOOK_CHROME_PATH || undefined,headless:true});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true});
 await context.addInitScript(({student,token,expiresAt})=>{localStorage.setItem('wiggle.deviceProfiles.v2',JSON.stringify([{studentId:student,nickname:'김하늘',animal:'cat',classroomName:'우리 반 · 예시 학생'}]));sessionStorage.setItem('wiggle.activeSession.v2',JSON.stringify({studentId:student,deviceToken:token,expiresAt}));},{student,token,expiresAt});
 await context.addCookies([{name:'wiggle_teacher',value:teacherToken,url:server.origin}]);
 const page=await context.newPage();page.setDefaultTimeout(15000);
 const protectedStyles=[];
 for(const [name,path,ready] of [['landing','/','.gallery-landing'],['join','/join?code=7829','main'],['drawing','/student/draw/artwork_designpreview','canvas:not(.hidden)']]) {
  await page.goto(server.origin+path);await page.locator(ready).first().waitFor();await page.waitForTimeout(500);
  assert.equal(await page.locator('.design-surface').count(),0,'protected route '+name);
  for(const [width,height] of [[1440,1000],[320,568],[390,844],[844,390]]) {
   await page.setViewportSize({width,height});await page.waitForTimeout(120);
   const styles=await page.evaluate(()=>[...document.querySelectorAll('main,header,button,input,canvas')].filter(e=>e.getBoundingClientRect().width).map(e=>{const s=getComputedStyle(e);return {tag:e.tagName,cls:e.className,bg:s.backgroundColor,color:s.color,font:s.fontSize,radius:s.borderRadius,shadow:s.boxShadow,padding:s.padding};}));
   protectedStyles.push({name,width,styles});await page.screenshot({path:`${dir}/${name}-${width}.png`});
  }
 }
 if(baseline) await writeFile('work/design-audit/protected.json',JSON.stringify(protectedStyles));
 else {
  let saved;try {saved=await readFile('work/design-audit/protected.json','utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(saved)assert.deepEqual(protectedStyles,JSON.parse(saved),'protected page computed styles changed');
  else console.log('No baseline supplied; checked route boundary only.');
 }
 console.log('PASS protected landing/join/drawing styles, four widths');
 const asset=await server.DB.prepare('SELECT object_key FROM storybook_assets WHERE storybook_id=?').bind(book).first();
 await server.DB.prepare("UPDATE artworks SET status='complete',completed_at=CURRENT_TIMESTAMP,thumbnail_key=?,final_image_key=? WHERE id='artwork_designpreview'").bind(asset.object_key,asset.object_key).run();
 const routes=[['student-books','/student/books','.storybook-book-grid'],['student-editor','/student/books/'+book,'.storybook-inline-text'],['archive','/student/archive','.archive-book'],['detail','/student/archive/artwork_designpreview','.artwork-detail-card'],['teacher','/teacher','.class-card'],['class','/teacher/class/'+room,'.tcw-tabs'],['books','/teacher/class/'+room+'/books','.book-library-card'],['feedback','/teacher/class/'+room+'/books/feedback','.fm-book'],['orders','/teacher/class/'+room+'/books/orders','.book-order-layout'],['live','/teacher/class/'+room+'/books/live','.book-live-student'],['teacher-editor','/teacher/class/'+room+'/books/'+book+'/edit','.storybook-inline-text'],['reader','/teacher/class/'+room+'/books/storybook_preview0000','.teacher-story-page'],['family','/family/view','.family-unavailable']];
 const audit=[];
 async function capture(name,path,ready){
  await page.setViewportSize({width:1440,height:1000});if(path) await page.goto(server.origin+path);await page.locator(ready).first().waitFor();await page.waitForTimeout(250);
  for(const [width,height] of [[1440,1000],[320,568],[390,844],[844,390]]) {
   await page.setViewportSize({width,height});await page.waitForTimeout(100);
   const check=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,offenders:[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+2&&getComputedStyle(e).position!=='absolute').slice(0,8).map(e=>e.className),styles:[...document.querySelectorAll('main,main>section,.book-panel,.fm-batch,.admin-metrics article,.storybook-workspace,.storybook-stage,.button,.small-button')].slice(0,50).map(e=>{const s=getComputedStyle(e);return {cls:e.className,bg:s.backgroundColor,color:s.color,font:s.fontSize,radius:s.borderRadius,shadow:s.boxShadow};})}));
   audit.push({name,width,...check});if(!baseline){
    assert.ok(!check.overflow,`${name} ${width} overflow: ${JSON.stringify(check.offenders)}`);
    if(name.includes('editor')) {
     const clipped=await page.locator('.storybook-toolbar button').evaluateAll(items=>items.filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>e.textContent));
     assert.deepEqual(clipped,[],`${name} ${width} toolbar text clipped`);
     const overlapping=await page.locator('.storybook-editor-header').evaluate(el=>{const buttons=[...el.querySelectorAll('button,a,input')].map(e=>e.getBoundingClientRect());return buttons.some((a,i)=>buttons.slice(i+1).some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1));});
     assert.equal(overlapping,false,`${name} ${width} header overlap`);
    }
    if(name==='feedback')assert.equal(await page.locator('.fm-batch').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(46, 95, 35)');
    const undersized=await page.locator('button:visible, a.button:visible, a.small-button:visible').evaluateAll(items=>items.filter(e=>!e.disabled).map(e=>({label:e.getAttribute('aria-label')||e.textContent?.trim(),box:e.getBoundingClientRect()})).filter(e=>e.box.width<43.5||e.box.height<43.5).map(e=>({label:e.label,width:e.box.width,height:e.box.height})));
    assert.deepEqual(undersized,[],`${name} ${width} touch target smaller than 44px`);
   }
   await page.screenshot({path:`${dir}/${name}-${width}.png`,fullPage:true});
  }
  console.log('PASS '+name+' four widths');
 }
 for(const r of routes)await capture(...r);
 await capture('class-archive','/teacher/class/'+room+'?view=archive','.twa');
 await capture('class-settings','/teacher/class/'+room+'?view=settings','.trs');
 const share=await createFamilyShare(server.DB,{teacherId:'teacher_preview',classroomId:room,studentId:student,artworkIds:['artwork_designpreview'],guardianConsentConfirmed:true,consentMethod:'paper'});
 assert.equal(share.ok,true);const family=await exchangeFamilyInvite(server.DB,share.inviteToken);assert.equal(family.ok,true);
 await context.addCookies([{name:'wiggle_family',value:family.sessionToken,url:server.origin}]);
 await capture('family-record','/family/view','.family-artwork');
 await page.goto(server.origin+'/student/books/'+book);await page.getByRole('button',{name:'미리보기',exact:true}).click();await capture('student-preview',null,'.storybook-preview');
 await page.getByRole('button',{name:'편집으로 돌아가기',exact:true}).click();
 await page.getByRole('button',{name:'내 그림',exact:false}).click();await capture('artwork-picker',null,'.storybook-picker-modal');
 await context.addCookies([{name:'wiggle_teacher',value:adminToken,url:server.origin}]);
 await capture('admin-orders','/admin','.admin-orders');
 for(const [name,label,ready] of [['admin-classes','교사 · 학급 · 참여자','.admin-table'],['admin-resources','서버 · 수용 인원','.book-field textarea']]){await page.getByRole('button',{name:label,exact:true}).click();await capture(name,null,ready);}
 await writeFile(`${dir}/audit.json`,JSON.stringify(audit,null,2));
}finally{await browser.close();await server.dispose();}
