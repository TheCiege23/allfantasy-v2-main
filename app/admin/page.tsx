import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

/**
 * /admin now serves the Operator Command Center (app/admin/operator/*), which
 * owns its own auth gate (getAdminAccessState via app/admin/operator/layout.tsx)
 * — this route only forwards. The prior monolithic accordion page is preserved,
 * unchanged, at /admin/classic as a fallback; it is not deleted.
 */
export default function AdminPage() {
  redirect("/admin/operator")
}
