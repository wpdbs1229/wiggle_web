import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestServer } from './harness/server.mjs';
import { sha256 } from '../lib/token-crypto.ts';
import { emptyStorybookDocument } from '../lib/storybook-model.ts';

test('live books follow the active page, omit unchanged documents, isolate classrooms and deliver advice without editing', async t => {
  const server = await startTestServer({env:{OPENAI_API_KEY:'',SWEETBOOK_API_KEY:''}}); t.after(()=>server.dispose()); await server.fetch('/api/student');
  const teacherToken=randomUUID(), otherTeacherToken=randomUUID(), token=randomUUID(), otherToken=randomUUID(), expiry=new Date(Date.now()+3600000).toISOString();
  await server.DB.batch([
    ...['live','other'].map(n=>server.DB.prepare('INSERT INTO teachers(id,email,display_name) VALUES(?,?,?)').bind(n+'_teacher',n+'@example.test',n)),
    ...['live','other'].map((n,i)=>server.DB.prepare('INSERT INTO classrooms(id,teacher_id,display_name,class_code,join_token) VALUES(?,?,?,?,?)').bind(n+'_class',n+'_teacher',n,String(6011+i),randomUUID())),
    ...['live','other'].map(n=>server.DB.prepare('INSERT INTO student_profiles(id,classroom_id,nickname,animal,last_activity_at) VALUES(?,?,?,\'cat\',CURRENT_TIMESTAMP)').bind(n+'_student',n+'_class',n)),
    ...await Promise.all([[teacherToken,'live_teacher'],[otherTeacherToken,'other_teacher']].map(async([token,teacher])=>server.DB.prepare('INSERT INTO teacher_sessions(token_hash,teacher_id,expires_at,last_used_at) VALUES(?,?,?,CURRENT_TIMESTAMP)').bind(await sha256(token),teacher,expiry))),
    ...await Promise.all([[token,'live_student'],[otherToken,'other_student']].map(async([token,student])=>server.DB.prepare('INSERT INTO device_sessions(token_hash,student_id,expires_at,last_used_at) VALUES(?,?,?,CURRENT_TIMESTAMP)').bind(await sha256(token),student,expiry))),
  ]);
  const studentHeaders={authorization:'Bearer '+token,'content-type':'application/json'}, teacherHeaders={cookie:'wiggle_teacher='+teacherToken,'content-type':'application/json'};
  const created=await(await server.fetch('/api/storybooks',{method:'POST',headers:studentHeaders,body:'{}'})).json(), bookId=created.storybook.id;
  const doc=emptyStorybookDocument();doc.pages=Array.from({length:24},(_,i)=>emptyStorybookDocument('squarebook-hc','page_live'+String(i).padStart(8,'0'),'element_live'+String(i).padStart(8,'0')).pages[0]);doc.pages[1].elements[0].text='두 번째 쪽';
  await server.DB.prepare('UPDATE storybooks SET title=?,document_json=? WHERE id=?').bind('우리의 책',JSON.stringify(doc),bookId).run();
  const base='/api/teacher/book-live?classroomId=live_class', detail=base+'&studentId=live_student';
  const pulse=(pageId,headers=studentHeaders)=>server.fetch(`/api/storybooks/${bookId}/live`,{method:'POST',headers,body:JSON.stringify({pageId})});
  const post=(body,headers=teacherHeaders)=>server.fetch('/api/teacher/book-live',{method:'POST',headers,body:JSON.stringify(body)});
  const get=async url=>{const r=await server.fetch(url,{headers:teacherHeaders});assert.equal(r.status,200);return r.json();};
  assert.equal((await server.fetch(base)).status,401);
  assert.equal((await server.fetch(detail,{headers:{cookie:'wiggle_teacher='+otherTeacherToken}})).status,403);
  assert.equal((await pulse(doc.pages[0].id,{authorization:'Bearer '+otherToken})).status,404);
  const before=await server.DB.prepare('SELECT revision,document_json FROM storybooks WHERE id=?').bind(bookId).first();
  assert.equal((await post({action:'watch',classroomId:'live_class',studentId:'live_student'})).status,200);
  assert.equal((await(await pulse(doc.pages[1].id)).json()).watching,true);
  const roster=await get(base);assert.equal(roster.students[0].active,true);assert.equal(roster.students[0].bookId,bookId);assert.ok(!JSON.stringify(roster).includes('elements'));
  let first=await get(detail);assert.equal(first.book.page.id,doc.pages[1].id);assert.equal(first.book.pageCount,24);assert.equal(first.book.page.elements[0].text,'두 번째 쪽');assert.equal(first.book.document,undefined);
  let known=`&knownBookId=${bookId}&knownRevision=0&knownPageId=${doc.pages[1].id}`;
  const same=await get(detail+known);assert.equal(same.book.unchanged,true);assert.equal(same.book.page,undefined);assert.ok(JSON.stringify(same).length<700);
  await pulse(doc.pages[2].id);const flipped=await get(detail+known);assert.equal(flipped.book.page.id,doc.pages[2].id);
  assert.equal((await get(detail+known+'&pageId='+doc.pages[0].id)).book.page.id,doc.pages[0].id);
  const message={action:'advice',bookId,pageId:doc.pages[1].id,body:'주인공 마음을 한 문장 더 써 볼까?'};
  assert.equal((await post(message,{cookie:'wiggle_teacher='+otherTeacherToken})).status,404);
  assert.equal((await post({...message,pageId:'page_missing'})).status,409);
  assert.equal((await post(message,{...teacherHeaders,origin:'https://outside.example'})).status,403);
  const sent=await(await post(message)).json();assert.equal(sent.advice[0].pageNumber,2);
  let received=await(await pulse(doc.pages[2].id)).json();assert.equal(received.advice[0].body,message.body);
  assert.equal((await server.fetch(`/api/storybooks/${bookId}/live`,{method:'POST',headers:studentHeaders,body:JSON.stringify({action:'ack',adviceId:sent.advice[0].id})})).status,200);
  assert.ok((await get(detail)).advice[0].seenAt);
  assert.deepEqual(await server.DB.prepare('SELECT revision,document_json FROM storybooks WHERE id=?').bind(bookId).first(),before);
  doc.pages[1].elements[0].text='새로 저장한 이야기';await server.DB.prepare('UPDATE storybooks SET revision=1,document_json=? WHERE id=?').bind(JSON.stringify(doc),bookId).run();
  const changed=await get(detail+known+'&pageId='+doc.pages[1].id);assert.equal(changed.book.revision,1);assert.equal(changed.book.page.elements[0].text,'새로 저장한 이야기');
  await server.DB.prepare('UPDATE storybook_presence SET updated_at=?').bind(new Date(Date.now()-30_000).toISOString()).run();assert.equal((await get(detail)).book.active,false);
  await server.DB.prepare("UPDATE student_profiles SET archived_at=CURRENT_TIMESTAMP WHERE id='live_student'").run();assert.equal((await server.fetch(detail,{headers:teacherHeaders})).status,404);assert.equal((await post(message)).status,404);assert.equal((await pulse(doc.pages[0].id)).status,401);
});
