"use client";
import type { Rubric } from "@/lib/book-rubric";
import { rubricTemplateRows } from "@/lib/rubric-template";
export function RubricGuide({ rubric, classroomId }: { rubric: Rubric; classroomId: string }) {
  return <div className="rubric-guide">
    <div className="book-section-heading"><div><h3>우리 수업에 맞게 평가 기준 바꾸기</h3><p>현재 기준이 채워진 엑셀을 받아, 연노랑 칸을 수정하고 다시 올려 주세요.</p></div><a className="button secondary" href={`/api/teacher/book-feedback?classroomId=${encodeURIComponent(classroomId)}&format=xlsx`}>현재 기준 엑셀 양식 받기</a></div>
    <ol className="rubric-steps"><li><b>1. 양식 받기</b><span>‘평가’ 시트를 엽니다.</span></li><li><b>2. B·C열 수정</b><span>영역 이름, 점수, 판단 기준을 바꿉니다.</span></li><li><b>3. 엑셀 파일 교체</b><span>저장한 .xlsx를 올리면 다음 요청부터 적용됩니다.</span></li></ol>
    <details><summary>엑셀 양식 미리보기 · 어느 칸을 수정하나요?</summary>
      <p><b>B1</b>: 평가 이름 · <b>‘채점기준 N’ 옆 B열</b>: 영역 이름 · <b>바로 아래 B열</b>: 점수 · <b>C열</b>: 그 점수를 주는 기준</p>
      <p>영역 추가·삭제는 채점기준과 단계 행을 함께 편집하세요. 점수를 바꾸면 맨 아래 <b>영역만점·최소점수</b>도 각 영역 최고·최저 점수의 합으로 맞춰 주세요. ‘평가’ 시트 이름과 A열 항목명은 유지합니다.</p>
      <div className="rubric-sheet-scroll" tabIndex={0} role="region" aria-label="평가 엑셀 셀 미리보기"><table className="rubric-sheet"><thead><tr><th>행</th><th>A · 항목 (유지)</th><th>B · 이름 / 점수 (수정)</th><th>C · 판단 기준 (수정)</th></tr></thead><tbody>{rubricTemplateRows(rubric).map((row, i) => <tr key={i}><th scope="row">{i + 1}</th>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>
      <p className="book-muted">영역 1~20개 · 영역당 단계 1~10개 · 파일 2MB 이하. 이미 완성된 피드백은 당시 평가 기준으로 보존돼요.</p>
    </details>
  </div>;
}
