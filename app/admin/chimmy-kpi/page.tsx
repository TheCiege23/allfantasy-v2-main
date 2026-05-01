import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/adminAuth'
import { getAdminLoginRedirectUrl } from '@/lib/routing/ProtectedRouteResolver'
import { ChimmyKPIReadout } from '@/components/admin/ChimmyKPIReadout'

export const dynamic = 'force-dynamic'

export default async function ChimmyKPIPage() {
  const auth = await requireAdmin()
  if (!auth.ok) {
    redirect(getAdminLoginRedirectUrl('/admin/chimmy-kpi'))
  }

  return (
    <main className="min-h-screen bg-[#0b1220] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h1 className="text-xl font-bold">Chimmy KPI Readout</h1>
          <p className="mt-1 text-sm text-white/65">
            Admin-only analytics snapshot from the Chimmy rollup endpoint. Privacy-safe by design.
          </p>
        </header>

        <ChimmyKPIReadout />
      </div>
    </main>
  )
}
