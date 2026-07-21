"use client"
/**
 * Operator Command Center — application shell.
 *
 * A dedicated admin shell, separate from the consumer app: fixed left nav on
 * desktop, a slide-over drawer on mobile, and a sticky operator header. Server
 * section pages are passed in as `children` and render inside <main>.
 */
import { useState } from "react"
import { OperatorSidebar } from "@/components/admin/operator/OperatorSidebar"
import { OperatorHeader, type OperatorIdentity } from "@/components/admin/operator/OperatorHeader"
import type { OperatorEnvironment } from "@/lib/admin-dashboard/operatorEnvironment"
import type { ReactNode } from "react"

export function AdminOperatorShell({
  operator,
  environment,
  children,
}: {
  operator: OperatorIdentity
  environment: OperatorEnvironment
  children: ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="min-h-dvh bg-[#0a0e1a] text-white">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[232px] border-r border-white/[0.06] bg-[#080a12] lg:block">
        <OperatorSidebar environment={environment} />
      </aside>

      {/* Mobile drawer */}
      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 w-[248px] border-r border-white/[0.06] bg-[#080a12]">
            <OperatorSidebar environment={environment} onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      ) : null}

      {/* Main column */}
      <div className="lg:pl-[232px]">
        <OperatorHeader
          operator={operator}
          environment={environment}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />
        <main className="mx-auto w-full max-w-[1440px] px-3 py-5 sm:px-5 lg:px-6">{children}</main>
      </div>
    </div>
  )
}
