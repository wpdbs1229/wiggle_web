import type { ReactNode } from "react";
import "./design-surface.css";

/** Route boundary: styles never reach the landing, joining or drawing screens. */
export function DesignSurface({ audience, children }: { audience: "student" | "adult"; children: ReactNode }) {
  return <div className={`design-surface design-${audience}`}>{children}</div>;
}
