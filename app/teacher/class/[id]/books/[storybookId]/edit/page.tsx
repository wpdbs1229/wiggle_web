import { redirect } from "next/navigation";
import { requireTeacher } from "@/lib/security";
import { StorybookEditor } from "@/app/components/StorybookEditor";
import { bindings } from "@/db/runtime";
export const dynamic = "force-dynamic";
export default async function TeacherBookEditorPage({ params }: { params: Promise<{ id: string; storybookId: string }> }) {
  const { id, storybookId } = await params;
  const teacher = await requireTeacher();
  if (!teacher) redirect(`/teacher`);
  const book = await bindings().DB.prepare(`SELECT b.id FROM storybooks b JOIN classrooms c ON c.id=b.classroom_id WHERE b.id=? AND c.id=? AND c.teacher_id=? AND c.active=1`).bind(storybookId, id, teacher.id).first();
  if (!book) return <main className="app-shell">그림책을 편집할 권한이 없어요.</main>;
  return <StorybookEditor teacherBookId={storybookId} classroomId={id} />;
}
