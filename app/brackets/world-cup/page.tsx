import Link from "next/link"
import { getServerSession } from "next-auth"
import { Bot, Globe2, Lock, Plus, Sparkles, Trophy, Users } from "lucide-react"
import { authOptions } from "@/lib/auth"
import { listUserWorldCupChallenges } from "@/lib/world-cup"

export const dynamic = "force-dynamic"

type SessionUser = { id?: string | null; email?: string | null; name?: string | null }
type WorldCupPoolSummary = {
  id: string
  name: string
  seasonYear: number
  status: string
  participantCount: number
  totalScore: number
  rank: number | null
}

const FEATURE_BULLETS = [
  { icon: Users, text: "Create private or public World Cup bracket pools." },
  { icon: Users, text: "Up to 100 users per pool." },
  { icon: Trophy, text: "Up to 5 brackets per user — compete with multiple strategies." },
  { icon: Trophy, text: "NCAA-style scoring — more points for later rounds." },
  { icon: Sparkles, text: "Full-screen guided pick builder with AI matchup previews." },
  { icon: Globe2, text: "Live score and match-minute tracking." },
  { icon: Bot, text: "AI bracket builder fills unpicked matches automatically." },
  { icon: Trophy, text: "Entry-level leaderboard — every bracket is ranked individually." },
  { icon: Lock, text: "Brackets lock when the first World Cup match begins." },
]

export default async function WorldCupBracketsPage() {
  const session = (await getServerSession(authOptions as any)) as { user?: SessionUser } | null
  const userId = session?.user?.id ?? null
  const pools: WorldCupPoolSummary[] = userId
    ? await listUserWorldCupChallenges(userId)
    : []

  return (
    <main className="min-h-screen bg-[#05070b] text-white">
      <section className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
        {/* Nav row */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/brackets"
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white/60 hover:text-white"
          >
            ← Back to Brackets
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/brackets/world-cup/discover"
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm font-bold text-cyan-100 hover:bg-cyan-400/15"
            >
              Discover public pools
            </Link>
            {userId && (
              <Link
                href="/brackets/world-cup/join"
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-bold text-white/70 hover:bg-white/[0.08]"
              >
                Join with Invite Code
              </Link>
            )}
            <Link
              href="/brackets/world-cup/create"
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-4 py-2 text-sm font-black text-black"
            >
              <Plus className="h-4 w-4" />
              Create Pool
            </Link>
          </div>
        </div>

        {/* Hero */}
        <header className="rounded-xl border border-white/10 bg-white/[0.04] p-6 sm:p-8">
          <div className="mb-4 inline-flex rounded-xl bg-cyan-300 p-3 text-black">
            <Globe2 className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
            World Cup Bracket Pools
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-white/60">
            Create an NCAA-style bracket pool for the FIFA World Cup. Invite friends, make picks,
            track live scores, and climb the leaderboard.
          </p>

          {/* Feature bullets */}
          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {FEATURE_BULLETS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2 text-sm text-white/55">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300/70" />
                {text}
              </li>
            ))}
          </ul>

          {/* CTA strip */}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/brackets/world-cup/create"
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-2.5 text-sm font-black text-black"
            >
              <Plus className="h-4 w-4" />
              Create World Cup Pool
            </Link>
            <Link
              href="/brackets/world-cup/discover"
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-5 py-2.5 text-sm font-bold text-cyan-100 hover:bg-cyan-400/15"
            >
              Discover public pools
            </Link>
            {userId && (
              <Link
                href="/brackets/world-cup/join"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-5 py-2.5 text-sm font-bold text-white/75 hover:bg-white/[0.09]"
              >
                Join with Invite Code
              </Link>
            )}
          </div>
        </header>

        {/* Your pools */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-[0.16em] text-white/45">
              Your World Cup Pools
            </h2>
            <span className="text-xs text-white/35">{pools.length} joined</span>
          </div>

          {userId ? (
            pools.length > 0 ? (
              <div className="grid gap-3">
                {pools.map((pool) => {
                  const isLocked = pool.status === "locked" || pool.status === "final"
                  return (
                    <Link
                      key={pool.id}
                      href={`/brackets/world-cup/${pool.id}`}
                      className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] p-4 hover:bg-white/[0.07]"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-black text-white">{pool.name}</span>
                          {isLocked && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold text-white/40">
                              <Lock className="h-2.5 w-2.5" />
                              Locked
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-white/45">
                          {pool.seasonYear} · {pool.participantCount} participant{pool.participantCount !== 1 ? "s" : ""}
                        </div>
                      </div>
                      <div className="ml-4 shrink-0 text-right text-xs text-white/45">
                        <div className="font-black text-cyan-200">{pool.totalScore} pts</div>
                        <div>{pool.rank ? `Rank #${pool.rank}` : "Unranked"}</div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-6 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-300/10">
                  <Globe2 className="h-6 w-6 text-cyan-200" />
                </div>
                <div>
                  <p className="font-black text-white">No World Cup pools yet</p>
                  <p className="mt-1 text-sm text-white/45">
                    You haven't joined a World Cup bracket pool yet.
                  </p>
                  <p className="mt-1 text-xs text-white/30">
                    Create one and invite friends, or ask for an invite code.
                  </p>
                </div>
                <Link
                  href="/brackets/world-cup/create"
                  className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-2.5 text-sm font-black text-black"
                >
                  <Plus className="h-4 w-4" />
                  Create World Cup Pool
                </Link>
              </div>
            )
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-6">
              <p className="text-sm text-white/60">
                Sign in to create or join a World Cup bracket pool.
              </p>
              <Link
                href="/login?next=/brackets/world-cup"
                className="mt-4 inline-flex rounded-xl bg-cyan-300 px-5 py-2.5 text-sm font-black text-black"
              >
                Sign In to Get Started
              </Link>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}
