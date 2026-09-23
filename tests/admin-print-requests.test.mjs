import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PDFDocument, degrees } from "pdf-lib";
import { startTestServer } from "./harness/server.mjs";
import { sha256 } from "../lib/token-crypto.ts";
import { validatePrintPdf } from "../lib/print-validation.ts";
const layout = { spec: { bindingType: "PUR" }, size: { coverWidthMm: 544, coverHeightMm: 288, innerWidthMm: 249, innerHeightMm: 254 }, pageCount: 24 };
async function pdf(kind, wrong = false) { const d = await PDFDocument.create(); for (let i = 0; i < (kind === 'cover' ? 1 : 24); i++) d.addPage([(kind === 'cover' ? 544 : wrong && i === 23 ? 220 : 249) * 72 / 25.4, (kind === 'cover' ? 288 : 254) * 72 / 25.4]); return Buffer.from(await d.save()); }
test('인쇄 규격: 마지막 페이지까지 검사하고 회전·잘림·암호/손상 파일 거절', async () => {
  assert.equal((await validatePrintPdf(await pdf('inner'), 'inner', layout)).length, 24);
  await assert.rejects(validatePrintPdf(await pdf('inner',true), 'inner', layout), /24페이지/);
  const rotated = await PDFDocument.load(await pdf('cover')); rotated.getPage(0).setRotation(degrees(90));
  await assert.rejects(validatePrintPdf(await rotated.save(),'cover',layout),/회전/);
  const cropped = await PDFDocument.load(await pdf('cover')); cropped.getPage(0).setCropBox(0,0,100,100);
  await assert.rejects(validatePrintPdf(await cropped.save(),'cover',layout),/잘림/);
  await assert.rejects(validatePrintPdf(Buffer.from('%PDF-broken'),'inner',layout));
});
test('관리자 접근·업로드 검사·주문 소유권·실시간 중복 제거·만료·최대 인원', async (t) => {
  const server = await startTestServer({ env: { ADMIN_EMAILS:'qudcks1940@gmail.com', SWEETBOOK_API_KEY:'fixture',SWEETBOOK_ENV:'sandbox',WIGGLE_BOOK_PROVIDER_FIXTURE:'true',NODE_OPTIONS:`--import=${new URL('./harness/book-provider-fixture.mjs',import.meta.url).href}` } });
  t.after(()=>server.dispose()); await server.fetch('/api/student');
  const sessions = {};
  for (const [id,email] of [['owner','owner@example.test'],['other','other@example.test'],['admin','qudcks1940@gmail.com']]) {
    const token=randomUUID(); sessions[id]={cookie:`wiggle_teacher=${token}`,'content-type':'application/json'};
    await server.DB.batch([server.DB.prepare('INSERT INTO teachers(id,email,display_name) VALUES(?,?,?)').bind(id,email,id),server.DB.prepare('INSERT INTO teacher_sessions(token_hash,teacher_id,expires_at,last_used_at) VALUES(?,?,?,CURRENT_TIMESTAMP)').bind(await sha256(token),id,new Date(Date.now()+3600000).toISOString())]);
  }
  const room='class_print_upload_test', student='student_presence_test', studentToken=randomUUID();
  await server.DB.batch([
    server.DB.prepare("INSERT INTO classrooms(id,teacher_id,display_name,class_code,join_token) VALUES(?,'owner','검증반','9462',?)").bind(room,randomUUID()),
    server.DB.prepare("INSERT INTO student_profiles(id,classroom_id,nickname,animal,last_activity_at,claimed_at) VALUES(?,?,'별','cat',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").bind(student,room),
    server.DB.prepare('INSERT INTO device_sessions(token_hash,student_id,expires_at,last_used_at) VALUES(?,?,?,CURRENT_TIMESTAMP)').bind(await sha256(studentToken),student,new Date(Date.now()+3600000).toISOString()),
  ]);
  async function send(path, body, who='owner', status=200) {const r=await server.fetch(path,{method:'POST',headers:sessions[who],body:JSON.stringify(body)});const value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value;}
  for (const role of ['owner','other','admin']) {
    const identity = await (await server.fetch('/api/teacher',{headers:sessions[role]})).json();
    assert.equal(identity.teacher.isAdmin,role==='admin');
    const html = await (await server.fetch('/admin',{headers:sessions[role]})).text();
    assert.equal(html.includes('관리자로 지정된 구글 계정'),role!=='admin');
  }
  assert.equal((await server.fetch('/api/admin')).status,403);
  assert.equal((await server.fetch('/api/admin',{headers:sessions.owner})).status,403);
  await send('/api/admin',{maximum:200,basis:'동시 저장 부하 테스트'},'owner',403);
  await send('/api/admin',{maximum:200,basis:'동시 저장 부하 테스트'},'admin');
  for(let i=0;i<3;i++)assert.equal((await server.fetch('/api/presence',{method:'POST',headers:{authorization:`Bearer ${studentToken}`}})).status,200);
  await send('/api/presence',{});
  let dashboard=await (await server.fetch('/api/admin',{headers:sessions.admin})).json();
  assert.equal(dashboard.participants.length,1);assert.equal(dashboard.classrooms[0].onlineCount,1);assert.equal(dashboard.capacity.maximum,200);
  await server.DB.prepare('UPDATE participant_presence SET seen_at=?').bind(Date.now()-100000).run();
  dashboard=await (await server.fetch('/api/admin',{headers:sessions.admin})).json();assert.equal(dashboard.participants.length,0);
  const cover=await pdf('cover'), inner=await pdf('inner'), bad=await pdf('inner',true);
  async function upload(innerFile,expected=200){
    const start=await send('/api/teacher/print-uploads',{action:'start',classroomId:room,title:'첨부 원고',specUid:'SQUAREBOOK_HC',pageCount:24,coverBytes:cover.length,innerBytes:innerFile.length});
    for(const [kind,bytes] of [['cover',cover],['inner',innerFile]]) {
      const url=`/api/teacher/print-uploads?id=${start.id}&kind=${kind}&part=0`;
      assert.equal((await server.fetch(url,{method:'PUT',headers:sessions.other,body:bytes})).status,403);
      assert.equal((await server.fetch(url,{method:'PUT',headers:sessions.owner,body:bytes})).status,200);
    }
    const result=await send('/api/teacher/print-uploads',{action:'finish',classroomId:room,id:start.id},'owner',expected);
    return {start,result};
  }
  const invalid=await upload(bad,400);assert.match(invalid.result.error,/24페이지/);
  const valid=await upload(inner);assert.equal(valid.result.measurements.inner.length,24);
  const body={classroomId:room,requestId:randomUUID(),schoolName:'검증초',grade:4,classNumber:7,confirmed:true,shipping:{recipientName:'선생님',recipientPhone:'010-0000-0000',postalCode:'12345',address1:'검증시 검증로 123',address2:'',memo:''},items:[{uploadId:valid.start.id,quantity:2}]};
  await send('/api/teacher/print-requests',body,'other',400);
  const accepted=await send('/api/teacher/print-requests',body,'owner',201);
  assert.equal((await server.fetch(`/api/print-requests/${accepted.id}?kind=request`,{headers:sessions.other})).status,404);
  assert.equal((await server.fetch(`/api/print-requests/${accepted.id}?kind=request`,{headers:sessions.admin})).status,200);
  assert.equal((await server.fetch(`/api/teacher/print-uploads?id=${valid.start.id}&kind=cover&part=0`,{method:'PUT',headers:sessions.owner,body:cover})).status,403,'accepted uploads cannot be overwritten');
  await send('/api/teacher/book-print',{action:'submit',classroomId:room,confirmed:true},'owner',403);
  const prep=await send('/api/admin/print-requests',{id:accepted.id,action:'prepare'},'admin');assert.equal(prep.done,false);
  const quote=await send('/api/admin/print-requests',{id:accepted.id,action:'prepare'},'admin');assert.equal(quote.estimate.paidCreditAmount,22000);
  const ordered=await send('/api/admin/print-requests',{id:accepted.id,action:'order',confirmed:true},'admin');assert.ok(ordered.result.orderUid);
});
