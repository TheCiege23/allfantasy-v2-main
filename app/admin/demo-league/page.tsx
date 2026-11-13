import { redirect } from 'next/navigation'
import { getAdminAccessState } from '@/lib/adminAuth'
import DemoLeagueAdminClient from './DemoLeagueAdminClient'

export const dynamic = 'force-dynamic'

/**
 * Admin — choose which of your leagues powers the public demo (/demo).
 * The page gate only stops an admin-less browser rendering it; `requireAdmin` plus the
 * commissioner check inside /api/admin/demo-league is the real boundary.
 */
export default async function DemoLeagueAdminPage() {
  const state = await getAdminAccessState()
  if (state.status !== 'admin') redirect('/admin')

  return (
    <main className="min-h-dvh bg-[#020817] px-4 py-8 text-white">
      <div className="relative mx-auto max-w-3xl">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200">Operator tooling · public demo</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Demo league source</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/62">
          The public demo at <code>/demo</code> is a live, anonymized view of one league you commission. It is not a
          copy: it reads that league&apos;s synced data on every visit and replaces every team name, manager name,
          username, email, avatar and id with a stable fake one. Chat, trade notes and DMs are never shown.
        </p>
        <DemoLeagueAdminClient />
      </div>
    </main>
  )
}
