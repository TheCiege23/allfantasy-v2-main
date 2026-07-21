import type { Metadata } from "next"
import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { getAdminAccessState } from "@/lib/adminAuth"
import { getOperatorEnvironment } from "@/lib/admin-dashboard/operatorEnvironment"
import { AdminOperatorShell } from "@/components/admin/operator/AdminOperatorShell"
import { OperatorAccessDenied } from "@/components/admin/operator/OperatorAccessDenied"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "AllFantasy Operator",
  robots: { index: false, follow: false },
}

export default async function OperatorLayout({ children }: { children: ReactNode }) {
  // Server-side authorization only — never trust client-provided admin status.
  const gate = await getAdminAccessState()

  if (gate.status === "unauthenticated") {
    redirect("/admin-login?next=/admin/operator")
  }
  if (gate.status === "forbidden") {
    return <OperatorAccessDenied />
  }

  const environment = getOperatorEnvironment()

  return (
    <AdminOperatorShell
      environment={environment}
      operator={{
        name: gate.user.name ?? null,
        email: gate.user.email ?? null,
        role: gate.user.role ?? null,
        source: gate.source,
      }}
    >
      {children}
    </AdminOperatorShell>
  )
}
