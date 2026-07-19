import Link from "next/link"
import { redirect } from "next/navigation"

import { getAdminAccessState } from "@/lib/adminAuth"
import { listAdminApiTokens } from "@/lib/admin/adminApiTokens"

import AdminApiTokensClient, { type AdminApiTokenRow } from "./AdminApiTokensClient"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export default async function AdminApiTokensPage() {
  const gate = await getAdminAccessState()
  if (gate.status === "unauthenticated") {
    redirect("/admin-login?next=/admin/api-tokens")
  }
  if (gate.status === "forbidden") {
    return (
      <main className="min-h-dvh bg-[#020817] p-8 text-white">
        <p className="text-rose-300">Forbidden — admin access required.</p>
      </main>
    )
  }

  const tokens = await listAdminApiTokens()
  const rows: AdminApiTokenRow[] = tokens.map((t) => ({
    id: t.id,
    label: t.label,
    ownerEmail: t.ownerEmail,
    createdByEmail: t.createdByEmail,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
    revokedByEmail: t.revokedByEmail,
  }))

  return (
    <main className="min-h-dvh bg-[#020817] p-8 text-white">
      <div className="mx-auto max-w-5xl">
        <Link href="/admin" className="text-xs font-semibold text-white/40 hover:text-white/70">
          ← Admin
        </Link>
        <h1 className="mt-3 text-xl font-black">API tokens</h1>
        <p className="mt-1 max-w-2xl text-sm text-white/50">
          Per-admin tokens for machine callers. Each one acts as a specific person, so admin actions
          made with a token can be attributed and revoked individually — unlike the shared password
          they replace. Only a hash is stored; a token is shown once at creation and never again.
        </p>

        <div className="mt-8">
          <AdminApiTokensClient initialTokens={rows} />
        </div>
      </div>
    </main>
  )
}
