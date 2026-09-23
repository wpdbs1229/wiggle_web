"use client";
import {useCallback,useEffect,useState} from "react";
import {Logo} from "./Logo";
import {TeacherPdfImport} from "./TeacherPdfImport";
import {teacherRequest,type CompletedBook} from "./book-workflow-client";
import "./book-workflow.css";
export function TeacherStorybookLibrary({classroomId}:{classroomId:string}){
  const [books,setBooks]=useState<CompletedBook[]>([]),[name,setName]=useState(""),[error,setError]=useState("");
  const load=useCallback(async()=>{const data=await teacherRequest<{classroom:{displayName:string};storybooks:CompletedBook[]}>(`/api/teacher/storybooks?classroomId=${classroomId}`);setBooks(data.storybooks);setName(data.classroom.displayName);},[classroomId]);
  useEffect(()=>{void load().catch(e=>setError(e.message));},[load]);
  const groups=[...books.reduce((map,b)=>{const list=map.get(b.studentId)??[];list.push(b);map.set(b.studentId,list);return map;},new Map<string,CompletedBook[]>()).values()].sort((a,b)=>(a[0].seatNumber??Infinity)-(b[0].seatNumber??Infinity));
  return <main className="book-desk"><header className="book-desk-header"><Logo/><a className="small-button" href={`/teacher/class/${classroomId}`}>← 수업실</a><a className="button secondary" href={`/teacher/class/${classroomId}/books/orders`}>그림책 주문 →</a></header>
    <section className="book-desk-hero"><div><p className="eyebrow">{name||"우리 반"} · 선생님의 책상</p><h1>우리 반의 완성 그림책</h1><p>학생별 그림책을 읽고 수정하거나 제작을 요청하세요.</p></div><div className="book-desk-count"><b>{books.length}</b><span>완성 그림책</span></div></section>
    <section className="book-panel book-section-heading"><div><h2>만들고 있는 그림책 함께 보기</h2><p>학생이 작업하는 쪽을 실시간으로 확인하고 조언을 보내세요.</p></div><a className="button primary" href={`/teacher/class/${classroomId}/books/live`}>그림책 실시간 보기 →</a></section>
    <section className="book-panel book-section-heading"><div><h2>학생별 피드백 관리</h2><p>평가 기준 수정, 피드백 만들기, 필요한 영역 선택과 PDF 다운로드를 한 곳에서 관리해요.</p></div><a className="button primary" href={`/teacher/class/${classroomId}/books/feedback`}>피드백 관리 열기 →</a></section>
    {error&&<p className="error-box" role="alert">{error}</p>}<TeacherPdfImport classroomId={classroomId} onImported={load}/>
    <section className="book-panel"><h2>학생별 그림책</h2>{groups.map(group=><section className="book-student-group" key={group[0].studentId} aria-label={`${group[0].seatNumber??""}번 ${group[0].realName||group[0].nickname} 그림책`}><h3>{group[0].seatNumber?group[0].seatNumber+"번 ":""}{group[0].realName||group[0].nickname} · {group.length}권</h3><div className="book-library-grid">{group.map(book=>{const asset=book.cover.imageAssetId||book.cover.backgroundAssetId;return <article className="book-library-card" key={book.id}><a className="book-cover-art" style={{background:book.cover.background}} href={`/teacher/class/${classroomId}/books/${book.id}`}>{asset&&<img src={`/api/teacher/storybooks/${book.id}/assets/${asset}`} alt="" loading="lazy"/>}<span>{book.cover.text||book.title}</span></a><div className="book-card-copy"><h3>{book.title||"제목 없음"}</h3><p>{book.pageCount}쪽 · {new Date(book.completedAt).toLocaleDateString("ko-KR")}</p></div><div className="book-card-buttons"><a className="small-button" href={`/teacher/class/${classroomId}/books/${book.id}/edit`}>그림책 수정</a><a className="small-button" href={`/teacher/class/${classroomId}/books/feedback?book=${book.id}`}>피드백 관리</a></div></article>;})}</div></section>)}{!books.length&&<p className="book-empty">완성한 그림책이 아직 없어요.</p>}</section>
  </main>;
}
