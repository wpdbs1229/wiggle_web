import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { startTestServer } from "./harness/server.mjs";
import { sha256 } from "../lib/token-crypto.ts";
import { emptyStorybookDocument } from "../lib/storybook-model.ts";

test("PDF 가져오기·교사 편집: 학생 연결, 권한 격리, 이미지·완성·저장 충돌", async (t) => {
  const server = await startTestServer(); t.after(() => server.dispose()); await server.fetch("/api/student");
  const teacherId = `teacher_${randomUUID()}`, room = `class_${randomUUID()}`, student = `student_${randomUUID()}`, token = randomUUID();
  await server.DB.batch([
    server.DB.prepare("INSERT INTO teachers(id,email,display_name) VALUES(?,?,'교사')").bind(teacherId, `${teacherId}@example.test`),
    server.DB.prepare("INSERT INTO classrooms(id,teacher_id,display_name,class_code,join_token) VALUES(?,?,'반','1427',?)").bind(room,teacherId,randomUUID()),
    server.DB.prepare("INSERT INTO student_profiles(id,classroom_id,nickname,animal,last_activity_at,seat_number,real_name) VALUES(?,?,'별명','cat',CURRENT_TIMESTAMP,1,'가상학생')").bind(student,room),
    server.DB.prepare("INSERT INTO teacher_sessions(token_hash,teacher_id,expires_at,last_used_at) VALUES(?,?,?,CURRENT_TIMESTAMP)").bind(await sha256(token),teacherId,new Date(Date.now()+3_600_000).toISOString()),
  ]);
  const headers = { cookie:`wiggle_teacher=${token}`, "content-type":"application/json" };
  const bookId = `storybook_${randomUUID().replaceAll("-","")}`;
  const data={ classroomId:room,studentId:student,bookId,format:"portrait",pageCount:131,title:"PDF 가져온 책" };
  async function send(path,body,method="POST") { return server.fetch(path,{method,headers,body:JSON.stringify(body)}); }
  assert.equal((await server.fetch("/api/teacher/book-import",{method:"POST",body:JSON.stringify(data)})).status,401);
  assert.equal((await send("/api/teacher/book-import",{...data,studentId:"student_other"})).status,400);
  for (const pageCount of [0, -1, 1.5, "25", null, Number.MAX_SAFE_INTEGER + 1]) assert.equal((await send("/api/teacher/book-import",{...data,pageCount})).status,400);
  assert.equal((await send("/api/teacher/book-import",data)).status,201);
  assert.equal((await send("/api/teacher/book-import",data)).status,200);
  const base=`/api/teacher/book-editor/${bookId}`;
  assert.equal((await server.fetch(base,{headers})).status,200);
  assert.equal((await server.fetch(`/api/storybooks/${bookId}`,{headers})).status,401);
  assert.equal((await server.fetch(base)).status,401);
  const bytes=await sharp({create:{width:300,height:400,channels:3,background:'#ffddcc'}}).png().toBuffer();
  const upload=await server.fetch(base+'/assets',{method:"POST",headers:{cookie:headers.cookie,"content-type":"image/png"},body:bytes});
  assert.equal(upload.status,201);const {asset}=await upload.json();
  assert.equal((await server.fetch(base+'/assets/'+asset.id,{headers})).status,200);
  const doc=emptyStorybookDocument('portrait');doc.pages[0].backgroundAssetId=asset.id;doc.pages[0].elements[0].text='';
  doc.pages = Array.from({ length: 131 }, (_, i) => {
    const page = emptyStorybookDocument('squarebook-hc', `page_import${i.toString().padStart(8,'0')}`, `element_import${i.toString().padStart(8,'0')}`).pages[0];
    page.backgroundAssetId = asset.id; page.elements[0].text = `Page ${i+1}`; return page;
  });
  const change={requestId:'teacher_save_request_001',expectedRevision:0,title:'PDF 수정본',document:doc,complete:true};
  assert.equal((await send(base,change,"PUT")).status,200);
  assert.equal((await (await send(base,change,"PUT")).json()).duplicate,true);
  assert.equal((await send(base,{...change,requestId:'teacher_save_request_002'},"PUT")).status,409);
  const reloaded = await (await server.fetch(base,{headers})).json();
  assert.equal(reloaded.storybook.document.pages.length,131);
  assert.equal(reloaded.storybook.document.pages[130].elements[0].text,'Page 131');
  const bad=structuredClone(doc);bad.pages[0].backgroundAssetId='asset_foreign0001';
  assert.equal((await send(base,{...change,expectedRevision:1,requestId:'teacher_save_request_003',document:bad},"PUT")).status,403);
  // A valid session for a different teacher must not access or mutate this book.
  const otherId=`teacher_${randomUUID()}`,otherToken=randomUUID();
  await server.DB.batch([
    server.DB.prepare("INSERT INTO teachers(id,email,display_name) VALUES(?,?,'다른 교사')").bind(otherId,`${otherId}@example.test`),
    server.DB.prepare("INSERT INTO teacher_sessions(token_hash,teacher_id,expires_at,last_used_at) VALUES(?,?,?,CURRENT_TIMESTAMP)").bind(await sha256(otherToken),otherId,new Date(Date.now()+3_600_000).toISOString()),
  ]);
  for(const path of [base,base+'/assets/'+asset.id])assert.equal((await server.fetch(path,{headers:{cookie:`wiggle_teacher=${otherToken}`}})).status,401);
  assert.equal((await server.fetch(base,{method:'PUT',headers:{...headers,cookie:`wiggle_teacher=${otherToken}`},body:JSON.stringify({...change,expectedRevision:1})})).status,401);
  const saved=await server.DB.prepare('SELECT status,revision FROM storybooks WHERE id=?').bind(bookId).first();assert.deepEqual(saved,{status:'complete',revision:1});
});
