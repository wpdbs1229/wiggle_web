// Isolated local-only data for the design browser audit. No production credentials.
import {startTestServer} from './server.mjs';
import {defaultRubric,feedbackPrompt,rubricVersion} from '../../lib/book-rubric.ts';
import {emptyStorybookDocument} from '../../lib/storybook-model.ts';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {sha256} from '../../lib/token-crypto.ts';
import {emptyDocument} from '../../lib/drawing-model.ts';
export async function designFixture(){
const server=await startTestServer({env:{OPENAI_API_KEY:'',SWEETBOOK_API_KEY:''}});
await server.fetch('/api/student');
const teacher='teacher_preview',room='class_feedbackpreview';
await server.DB.batch([
 server.DB.prepare("INSERT INTO teachers(id,email,display_name) VALUES(?,?,'미리보기 선생님')").bind(teacher,'preview@example.test'),
 server.DB.prepare("INSERT INTO classrooms(id,teacher_id,display_name,class_code,join_token) VALUES(?,?,'우리 반 · 예시 학생','7829',?)").bind(room,teacher,randomUUID()),
 ...['김하늘','이서준','박지우'].map((name,i)=>server.DB.prepare("INSERT INTO student_profiles(id,classroom_id,nickname,animal,last_activity_at,seat_number,real_name) VALUES(?,?,?,'cat',CURRENT_TIMESTAMP,?,?)").bind('student_preview'+i,room,name,i+1,name))
]);
const rubric=await defaultRubric(),prompt=await feedbackPrompt(rubric),version=createHash('sha256').update(rubricVersion(rubric)+prompt).digest('hex');
const titles=['작은 씨앗의 여행','비 오는 날의 약속','달빛 우체국','우리가 지킨 숲'];
const comments=[
 '작은 씨앗이 낯선 곳에서도 자라나는 과정을 통해 용기라는 주제를 잘 전했어요. 마지막 장면에 씨앗이 느낀 마음을 한 문장 더 써 보면 주제가 더욱 또렷해질 거예요.',
 '독자가 씨앗의 마음을 따라갈 수 있도록 따뜻한 말을 골라 썼어요. 친구에게 이 이야기를 들려준다고 생각하며 첫 문장을 소리 내어 읽어 보세요.',
 '출발, 어려움, 새로운 시작이 자연스럽게 이어져요. 씨앗이 도움을 받는 장면에 대화를 넣으면 사건의 변화가 더 잘 드러날 거예요.',
 '글에서 말한 바람과 비를 그림 속 선과 색으로 표현했어요. 씨앗의 크기와 위치를 장면마다 조금씩 바꾸어 움직임을 보여 주세요.',
 '이야기 분위기에 어울리는 낱말을 사용했어요. 반복되는 ‘그리고’를 장면에 맞는 다른 말로 바꾸어 보면 문장이 더 생생해져요.',
 '씨앗의 눈으로 세상을 바라보는 발상이 재미있어요. 씨앗만 발견할 수 있는 작은 풍경을 하나 더 그려 보세요.',
 '제목과 표지 그림에서 이야기의 주인공이 잘 드러나요. 뒤표지에 독자에게 건네는 짧은 질문을 더해도 좋아요.',
 '쪽마다 한 장면에 집중해서 이야기를 따라가기 쉬워요. 새로운 장소로 옮겨 갈 때 배경색을 달리하면 변화를 더 쉽게 알아볼 수 있어요.',
 '대부분의 문장을 바르게 썼어요. 인물의 말을 적은 곳에는 따옴표를 붙이고 문장 끝의 마침표를 한 번 더 확인해 보세요.',
 '모든 장면을 끝까지 채우고 색과 글을 정성껏 다듬었어요. 완성한 책을 친구와 함께 읽으며 가장 마음에 드는 장면을 이야기해 보세요.'
];
for(let i=0;i<titles.length;i++){
 const id='storybook_preview000'+i,doc=emptyStorybookDocument();doc.pages[0].elements[0].text=titles[i];
 await server.DB.prepare("INSERT INTO storybooks(id,student_id,classroom_id,title,document_json,schema_version,revision,status,completed_at) VALUES(?,?,?,?,?,1,1,'complete',CURRENT_TIMESTAMP)").bind(id,'student_preview'+(i<2?0:i-1),room,titles[i],JSON.stringify(doc)).run();
 if(i===3)continue;
 const feedback={summary:'이야기의 흐름과 따뜻한 주제가 잘 어울리는 그림책이에요. 다음에는 주인공의 마음이 달라지는 순간을 대화로 표현해 보세요. ※ 화면 확인을 위해 만든 예시 피드백입니다.',criteria:rubric.criteria.map((c,k)=>({id:c.id,score:k%3===0?10:8,feedback:comments[k],pages:[1]}))};
 await server.DB.prepare("INSERT INTO book_feedback_jobs(id,storybook_id,classroom_id,teacher_id,revision,rubric_version,rubric_json,prompt,document_json,title,status,feedback_json) VALUES(?,?,?,?,1,?,?,?,?,?,'complete',?)").bind('feedback_preview'+i,id,room,teacher,version,JSON.stringify(rubric),prompt,JSON.stringify(doc),titles[i],JSON.stringify(feedback)).run();
}

for(let i=0;i<3;i++){
 const doc=emptyStorybookDocument();doc.pages=Array.from({length:24},(_,p)=>{const page=emptyStorybookDocument('squarebook-hc','page_livepreview'+i+String(p).padStart(4,'0'),'element_livepreview'+i+String(p).padStart(4,'0')).pages[0];page.background=['#FFF7DA','#E8F2E0','#E7F0FA'][i];page.elements[0].text=['작은 씨앗은 바람을 따라 새로운 세상으로 떠났어요.','우산 아래에서 친구와 비 오는 길을 함께 걸었어요.','달빛 우체국에 별이 보낸 편지가 도착했어요.'][i];return page;});
 await server.DB.prepare("INSERT INTO storybooks(id,student_id,classroom_id,title,document_json,schema_version,revision,status) VALUES(?,?,?,?,?,1,1,'draft')").bind('storybook_livepreview'+i,'student_preview'+i,room,['씨앗의 새로운 여행','우리들의 우산','달빛 우체국의 편지'][i],JSON.stringify(doc)).run();
}

const token=randomUUID(),teacherToken=randomUUID(),adminToken=randomUUID(),expiresAt=new Date(Date.now()+86400000).toISOString();
await server.DB.batch([
server.DB.prepare('INSERT INTO device_sessions(token_hash,student_id,expires_at,last_used_at) VALUES(?,?,?,CURRENT_TIMESTAMP)').bind(await sha256(token),'student_preview0',expiresAt),
server.DB.prepare('INSERT INTO teacher_sessions(token_hash,teacher_id,expires_at,last_used_at) VALUES(?,?,?,CURRENT_TIMESTAMP)').bind(await sha256(teacherToken),teacher,expiresAt),
server.DB.prepare("INSERT INTO teachers(id,email,display_name) VALUES('teacher_designadmin','qudcks1940@gmail.com','미리보기 관리자')"),
server.DB.prepare('INSERT INTO teacher_sessions(token_hash,teacher_id,expires_at,last_used_at) VALUES(?,?,?,CURRENT_TIMESTAMP)').bind(await sha256(adminToken),'teacher_designadmin',expiresAt),
server.DB.prepare("INSERT INTO artworks(id,student_id,classroom_id,title,topic,learning_mode,ops_json) VALUES('artwork_designpreview','student_preview0',?,'바닷속 친구들','바다','free',?)").bind(room,JSON.stringify(emptyDocument()))
]);
const book='storybook_livepreview0';
const bytes=await readFile('public/landing-gallery/artwork-whale.png');
const response=await server.fetch('/api/storybooks/'+book+'/assets',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'image/png'},body:bytes});
const uploaded=await response.json();if(!response.ok) throw new Error(JSON.stringify(uploaded));
const row=await server.DB.prepare('SELECT document_json AS doc FROM storybooks WHERE id=?').bind(book).first();
const doc=JSON.parse(row.doc);for(let p=0;p<doc.pages.length;p++){
 doc.pages[p].background='#FFFFFF';doc.pages[p].elements[0].text=p===0?'고래와 함께 바닷속을 여행해요.':'작은 물고기가 고래에게 길을 알려 주었어요.';
 doc.pages[p].elements.push({id:'element_designimage'+p,type:'image',assetId:uploaded.asset.id,x:.08,y:.26,width:.84,height:.64,rotation:0,opacity:1,locked:false,zIndex:1});
}
await server.DB.prepare('UPDATE storybooks SET document_json=? WHERE id=?').bind(JSON.stringify(doc),book).run();
return {server,room,book,token,teacherToken,adminToken,expiresAt,student:'student_preview0'};
}
