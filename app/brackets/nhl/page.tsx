import Link from "next/link"
import { getServerSession } from "next-auth"
import { Compass, Plus, Trophy, UserPlus, Users } from "lucide-react"
import { authOptions } from "@/lib/auth"
import { listUserPlayoffChallenges } from "@/lib/playoffs/playoffService"

export const dynamic = "force-dynamic"

type SessionUser = { id?: string | null; email?: string | null; name?: string | null }

export default async function NhlPlayoffPoolsHubPage() {
  const session = (await getServerSession(authOptions as never)) as { user?: SessionUser } | null
  const userId = session?.user?.id ?? null

  const nhlPools = userId
    ? (await listUserPlayoffChallenges(userId)).filter((c) => String(c.sport).toLowerCase() === "nhl")
    : []

  return (
    <main className="relative min-h-screen bg-[#05070b] text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_70%_50%_at_50%_-10%,rgba(56,189,248,0.12),transparent)]" />
      <div className="relative mx-auto max-w-[min(100%,920px)] px-4 py-8 sm:px-6 lg:px-10">
        <Link
          href="/brackets"
          className="inline-flex w-max items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white/60 transition hover:border-white/15 hover:text-white"
        >
          ← Bracket Pools
        </Link>

        <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-sky-200/70">NHL</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">NHL Playoff Pools</h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/55 sm:text-base">
              Create or open a playoff pool, then add bracket entries when you&apos;re ready to pick series winners.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link
              href="/brackets/nhl/create"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-sky-400 px-4 py-2.5 text-sm font-black text-black shadow-lg shadow-sky-500/20"
            >
              <Plus className="h-4 w-4 shrink-0" />
              Create NHL Pool
            </Link>
            {userId ? (
              <Link
                href="/brackets/join"
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-bold text-white/85 hover:bg-white/[0.08]"
              >
                <UserPlus className="h-4 w-4 shrink-0" />
                Join Pool
              </Link>
            ) : null}
            <Link
              href="/brackets/discover"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-sky-400/30 bg-sky-400/10 px-4 py-2.5 text-sm font-bold text-sky-100 hover:bg-sky-400/15"
            >
              <Compass className="h-4 w-4 shrink-0" />
              Discover
            </Link>
          </div>
        </div>

        <section className="mt-12 rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-6">
          <div className="flex items-center gap-2 text-white/90">
            <Trophy className="h-5 w-5 text-sky-300" />
            <h2 className="text-sm font-black uppercase tracking-wide">My NHL pools</h2>
          </div>
          {userId ? null : (
            <p className="mt-3 text-sm text-white/45">Sign in to see playoff pools you own or joined.</p>
          )}
          {userId && nhlPools.length === 0 ? (
            <p className="mt-3 text-sm text-white/55">
              You don&apos;t have any NHL playoff pools yet.{" "}
              <Link href="/brackets/nhl/create" className="font-semibold text-sky-300 hover:text-sky-200 underline-offset-4 hover:underline">
                Create one
              </Link>
              .
            </p>
          ) : null}
          {nhlPools.length > 0 ? (
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {nhlPools.map((pool) => (
                <li key={pool.challengeId}>
                  <Link
                    href={`/brackets/leagues/${pool.challengeId}`}
                    className="flex flex-col rounded-xl border border-white/10 bg-black/25 px-4 py-3 transition hover:border-sky-400/35 hover:bg-white/[0.06]"
                  >
                    <span className="truncate text-sm font-bold text-white">{pool.name}</span>
                    <span className="mt-1 inline-flex flex-wrap items-center gap-2 text-[11px] text-white/50">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        {pool.participantCount} participants
                      </span>
                      <span>·</span>
                      <span>{pool.entryCount} entries</span>
                      <span>·</span>
                      <span>{pool.seasonYear}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </main>
  )
}
