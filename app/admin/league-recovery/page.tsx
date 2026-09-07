import { redirect } from "next/navigation"
import { getAdminAccessState } from "@/lib/adminAuth"
import LeagueRecoveryClient from "./LeagueRecoveryClient"

export const dynamic = "force-dynamic"

/**
 * Admin — league recovery.
 *
 * 🛑 ITS OWN PAGE, NOT AN ACCORDION ON /admin, AND THAT IS DELIBERATE. Every panel on the admin
 * dashboard is GLOBAL; this one is league-scoped and destructive — six mutations including pausing
 * a draft other people are sitting in. Burying that behind an accordion on a 2,200-line dashboard
 * puts a live-event interrupt one stray click from a metrics tile. `duplicate-manager-verify` is
 * the precedent for a deliberate admin tool: its own route, its own warning header, reached on
 * purpose.
 *
 * ⚠ THE GATE HERE IS NOT THE SECURITY BOUNDARY — the API is. This redirect stops an admin-less
 * browser rendering the screen; `requireAdmin` inside GET/POST is what actually refuses the work.
 * A page-level check alone would be decoration, since anyone can call the route directly.
 */
export default async function LeagueRecoveryPage() {
  const state = await getAdminAccessState()
  if (state.status !== "admin") {
    redirect("/admin")
  }

  return (
    <main className="min-h-dvh bg-[#020817] px-4 py-8 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(34,211,238,0.20),transparent_34%),radial-gradient(circle_at_85%_8%,rgba(244,63,94,0.14),transparent_30%),linear-gradient(180deg,#020817_0%,#06111f_48%,#020817_100%)]" />
      <div className="relative mx-auto max-w-4xl">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-rose-200">Operator tooling · writes to real leagues</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
          League recovery
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/62">
          Repairs a league you are not a member of — a stuck lifecycle state, waivers that stopped
          processing, a hung draft, or a stat correction that needs a week reprocessed. Every league
          route otherwise requires commissioner rights, which is why support could not fix these.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-amber-100/75">
          Every action is written to the admin audit log against your account and this league. Load
          the league first — the actions offered depend on the state it is actually in.
        </p>

        <LeagueRecoveryClient />
      </div>
    </main>
  )
}
