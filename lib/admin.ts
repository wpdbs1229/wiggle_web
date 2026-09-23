import "server-only";
import { requireTeacher, type TeacherIdentity } from "@/lib/security";

// User-approved initial operator; deployment can replace the entire allowlist.
export function isAdmin(teacher: TeacherIdentity | null) {
  const emails = (process.env.ADMIN_EMAILS ?? "qudcks1940@gmail.com").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  return !!teacher && emails.includes(teacher.email.toLowerCase());
}
export async function requireAdmin() { const teacher = await requireTeacher(); return isAdmin(teacher) ? teacher : null; }
