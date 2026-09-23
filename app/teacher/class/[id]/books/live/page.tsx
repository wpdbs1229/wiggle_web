import { TeacherStorybookLive } from "@/app/components/TeacherStorybookLive";
import { redirect } from "next/navigation";
import { requiresHostedTeacherAuthentication } from "@/lib/runtime/environment";
import { requireTeacher } from "@/lib/security";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (requiresHostedTeacherAuthentication() && !(await requireTeacher())) redirect(`/api/auth/google/start?return_to=${encodeURIComponent(`/teacher/class/${id}/books/live`)}`);
  return <TeacherStorybookLive classroomId={id} />;
}
