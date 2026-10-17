import { redirect } from "next/navigation"
import { getAdminAccessState } from "@/lib/adminAuth"
import CfpSeedingClient from "./CfpSeedingClient"

export const dynamic = "force-dynamic"

/**
 * Admin — College Football Playoff seeding.
 *
 * Its own page for the same reason league recovery is: it writes to real pools
 * (bracket slots and the picks that name them), so it is reached on purpose,
 * not one stray click from a dashboard tile.
 *
 * ⚠ THE GATE HERE IS NOT THE SECURITY BOUNDARY — the API is. This redirect stops
 * an admin-less browser rendering the form; `requireAdmin` inside
 * /api/admin/brackets/cfp-seeds is what actually refuses the write.
 */
export default async function CfpSeedingPage() {
  const state = await getAdminAccessState()
  if (state.status !== "admin") {
    redirect("/admin")
  }

  return (
    <main className="min-h-dvh bg-[#020817] px-4 py-8 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(34,211,238,0.20),transparent_34%),linear-gradient(180deg,#020817_0%,#06111f_48%,#020817_100%)]" />
      <div className="relative mx-auto max-w-4xl">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-rose-200">
          Operator tooling · writes to real pools
        </p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
          College Football Playoff seeding
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/62">
          Enter the twelve teams in the committee&apos;s seed order right after Selection Sunday. Saving
          fills the bracket of every College Football Playoff pool for that season, and moves any picks
          already made with them. Results then update automatically.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-amber-100/75">
          Check every name against the official announcement before saving. A typo can be corrected
          here until the first game kicks off; after that, seeds are locked. Every save is written to
          the admin audit log against your account.
        </p>

        <CfpSeedingClient />
      </div>
    </main>
  )
}
