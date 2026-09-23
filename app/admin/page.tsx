import { requireAdmin } from "@/lib/admin";
import { AdminDashboard } from "@/app/components/AdminDashboard";
export default async function AdminPage() {
  const admin = await requireAdmin();
  if (!admin) return <main style={{ maxWidth: 640, margin: "80px auto", padding: 24 }}><h1>운영 관리자 로그인</h1><p>관리자로 지정된 구글 계정으로 로그인해 주세요.</p><a className="button primary" href="/teacher">교사 로그인으로 이동</a></main>;
  return <AdminDashboard name={admin.displayName} />;
}
