import "server-only";
import { bindings } from "@/db/runtime";
import { requireTeacher, studentFromRequest } from "@/lib/security";

// Teacher routes use their own cookie and verify the book's classroom. No student impersonation token.
export async function storybookEditorActor(request: Request) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/teacher/book-editor/")) return studentFromRequest(request);
  const teacher = await requireTeacher();
  if (!teacher) return null;
  const bookId = path.split("/")[4];
  return bindings().DB.prepare(`SELECT s.id, s.classroom_id AS classroomId FROM storybooks b JOIN student_profiles s ON s.id=b.student_id JOIN classrooms c ON c.id=b.classroom_id WHERE b.id=? AND c.teacher_id=? AND c.active=1 AND s.archived_at IS NULL`).bind(bookId, teacher.id).first<{ id: string; classroomId: string }>();
}
