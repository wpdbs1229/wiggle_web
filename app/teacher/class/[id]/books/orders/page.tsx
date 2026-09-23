import { redirect } from "next/navigation";
import { TeacherBookOrders } from "@/app/components/TeacherBookOrders";
import { requiresHostedTeacherAuthentication } from "@/lib/runtime/environment";
import { requireTeacher } from "@/lib/security";
export const dynamic = "force-dynamic";
export default async function BookOrdersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (requiresHostedTeacherAuthentication() && !await requireTeacher()) redirect(`/api/auth/google/start?return_to=${encodeURIComponent(`/teacher/class/${id}/books/orders`)}`);
  return <TeacherBookOrders classroomId={id} />;
}
