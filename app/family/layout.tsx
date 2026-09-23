import { DesignSurface } from "@/app/components/DesignSurface";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <DesignSurface audience="adult">{children}</DesignSurface>;
}
