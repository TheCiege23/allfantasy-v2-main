"use client"

import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import AdminLayout, { type AdminTab } from "@/app/admin/components/AdminLayout"
import AdminOverview from "@/app/admin/components/AdminOverview"
import AdminBlog from "@/app/admin/components/AdminBlog"
import AdminUsers from "@/app/admin/components/AdminUsers"
import AdminLeagueOverview from "@/app/admin/components/AdminLeagueOverview"
import AdminModerationPanel from "@/app/admin/components/AdminModerationPanel"
import AdminSystemPanel from "@/app/admin/components/AdminSystemPanel"
import AdminProviderDiagnostics from "@/app/admin/components/AdminProviderDiagnostics"

const ALLOWED_TABS: AdminTab[] = [
  "overview",
  "blog",
  "users",
  "leagues",
  "moderation",
  "system",
  "providers",
]

export function AdminDashboardHarnessClient() {
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)

  const activeTab = useMemo<AdminTab>(() => {
    const raw = searchParams?.get("tab") as AdminTab | null
    if (raw && ALLOWED_TABS.includes(raw)) return raw
    return "overview"
  }, [searchParams])

  if (!open) {
    return (
      <main className="min-h-screen bg-[#0a0a0f] p-6 text-white">
        <h1 className="mb-4 text-xl font-semibold">Admin Dashboard Harness</h1>
        <button
          type="button"
          data-testid="admin-open-dashboard-button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200"
        >
          Open Admin Dashboard
        </button>
      </main>
    )
  }

  return (
    <AdminLayout
      user={{
        email: "admin-harness@allfantasy.ai",
        name: "Admin Harness",
      }}
      activeTab={activeTab}
    >
      {activeTab === "overview" && <AdminOverview />}
      {activeTab === "blog" && <AdminBlog />}
      {activeTab === "users" && <AdminUsers />}
      {activeTab === "leagues" && <AdminLeagueOverview />}
      {activeTab === "moderation" && <AdminModerationPanel />}
      {activeTab === "system" && <AdminSystemPanel />}
      {activeTab === "providers" && <AdminProviderDiagnostics />}
    </AdminLayout>
  )
}

