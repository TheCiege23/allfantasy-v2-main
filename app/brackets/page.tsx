import Link from "next/link"
import Image from "next/image"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { areBracketChallengesEnabled, getEnabledSports } from "@/lib/feature-toggle"
import { Trophy, Plus, Users, ChevronRight, Star, Shield, Zap, Crown, ExternalLink, Sparkles, AlertTriangle, Scale, Heart, Globe2 } from "lucide-react"
import BracketShell from "@/components/bracket/BracketShell"
import EngagementEventTracker from "@/components/engagement/EngagementEventTracker"
import BracketHomeTabs from "@/components/bracket/BracketHomeTabs"
import MyPoolsTab from "@/components/bracket/MyPoolsTab"
import BracketAICoachTab from "@/components/bracket/BracketAICoachTab"
import CreatePoolTab from "@/components/bracket/CreatePoolTab"
import PlayoffChallengeTab from "@/components/bracket/PlayoffChallengeTab"
import JoinPoolTab from "@/components/bracket/JoinPoolTab"
import StandingsTab from "@/components/bracket/StandingsTab"
import BracketHistoryTab from "@/components/bracket/BracketHistoryTab"
import {
  buildLoginHrefWithIntent,
  buildSignupHrefWithIntent,
} from "@/lib/auth/PostAuthIntentRouter"
import { SUPPORTED_SPORTS } from "@/lib/sport-scope"
import { resolveBracketChallengeLabel, resolveBracketSportUI } from "@/lib/bracket-challenge"

export const dynamic = "force-dynamic"

type SessionUser = { id?: string; email?: string | null; name?: string | null }

export default async function BracketsHomePage() {
  let session: { user?: SessionUser } | null = null
  try {
    session = (await getServerSession(authOptions as any)) as {
      user?: SessionUser
    } | null
  } catch (e) {
    console.error("[brackets] session error:", e)
  }

  const user = session?.user as SessionUser | undefined
  const userId = user?.id

  const bracketsEnabled = await areBracketChallengesEnabled()
  if (!bracketsEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="rounded-xl border p-6 max-w-md text-center" style={{ borderColor: "var(--border)" }}>
          <AlertTriangle className="h-10 w-10 mx-auto mb-3" style={{ color: "var(--muted)" }} />
          <h1 className="text-lg font-semibold mb-2" style={{ color: "var(--text)" }}>Bracket challenges are temporarily disabled</h1>
          <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>This feature has been turned off by the platform. Check back later.</p>
          <Link href="/dashboard" className="text-sm font-medium" style={{ color: "var(--accent)" }}>Back to dashboard</Link>
        </div>
      </div>
    )
  }

  const myLeagues = userId
    ? await (prisma as any).bracketLeagueMember.findMany({
        where: { userId },
        include: {
          league: {
            select: {
              id: true,
              name: true,
              joinCode: true,
              scoringRules: true,
              tournament: { select: { name: true, season: true, sport: true } },
              _count: { select: { members: true, entries: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      })
    : []

  const bracketSignupHref = buildSignupHrefWithIntent("/brackets")
  const bracketLoginHref = buildLoginHrefWithIntent("/brackets")
  const enabledSports = await getEnabledSports()
  const visibleSports = enabledSports.length > 0 ? enabledSports : SUPPORTED_SPORTS
  const playoffSports = visibleSports.map((sport) => ({
    sport,
    ui: resolveBracketSportUI(sport),
  }))

  return (
    <div className="min-h-screen mode-surface mode-readable">
      <EngagementEventTracker
        eventType="bracket_view"
        enabled={Boolean(userId)}
        oncePerDayKey="brackets_home"
        meta={{ product: "bracket" }}
      />
      <div className="relative overflow-hidden" style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--panel2) 92%, transparent) 0%, var(--bg) 100%)' }}>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full" style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)' }} />
          <div className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full" style={{ background: 'radial-gradient(circle, rgba(251,146,60,0.06) 0%, transparent 70%)' }} />
        </div>

        <div className="relative max-w-2xl mx-auto px-4 sm:px-6 pt-6 pb-10">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <Image src="/af-crest.png" alt="AllFantasy" width={40} height={40} className="rounded-xl" />
              <div>
                <h1 className="text-xl font-bold">Bracket Challenges</h1>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Multi-sport playoff and tournament pools</p>
              </div>
            </div>
            <Link
              href="/dashboard"
              className="text-xs px-3 py-1.5 rounded-lg transition"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}
            >
              Home
            </Link>
          </div>

          <div className="flex flex-col items-center text-center mb-8">
            <div className="relative mb-4">
              <div className="w-28 h-28 rounded-3xl overflow-hidden" style={{ border: '2px solid rgba(59,130,246,0.2)', boxShadow: '0 0 40px rgba(59,130,246,0.1)' }}>
                <Image src="/af-robot-king.png" alt="Robot King" width={112} height={112} className="w-full h-full object-cover" />
              </div>
              <div className="absolute -bottom-2 -right-2 w-10 h-10 rounded-xl overflow-hidden" style={{ border: '2px solid #0d1117' }}>
                <Image src="/af-crest.png" alt="AF" width={40} height={40} className="w-full h-full object-cover" />
              </div>
            </div>
            <h2 className="text-2xl font-black mb-1">Fill Your Bracket</h2>
            <p className="text-sm max-w-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Powered by AllFantasy AI. Every bracket is <span className="font-bold" style={{ color: '#3b82f6' }}>100% free</span> &mdash; no hosting fees, no paid tiers, ever.
            </p>
          </div>

          {!userId ? (
            <div className="rounded-2xl p-6 text-center space-y-5 mb-6" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center justify-center gap-2">
                <Sparkles className="w-5 h-5" style={{ color: '#3b82f6' }} />
                <span className="font-bold text-lg">Get Started</span>
              </div>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Create a pool, invite friends, and fill out your bracket.
              </p>
              <div className="flex gap-3 justify-center">
                <Link
                  href={bracketSignupHref}
                  className="px-7 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                  style={{ background: '#3b82f6', boxShadow: '0 4px 14px rgba(59,130,246,0.3)' }}
                >
                  Sign Up Free
                </Link>
                <Link
                  href={bracketLoginHref}
                  className="px-7 py-2.5 rounded-xl text-sm font-semibold border transition-all"
                  style={{ borderColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)' }}
                >
                  Sign In
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4 mb-6">
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-5">
                <Link
                  href="/brackets/leagues/new"
                  className="flex min-h-[48px] touch-manipulation items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-center text-xs font-semibold text-white transition-all sm:text-sm"
                  style={{ background: '#3b82f6', boxShadow: '0 4px 14px rgba(59,130,246,0.25)' }}
                  data-testid="bracket-create-pool-button"
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  <span className="leading-tight">Create Pool</span>
                </Link>
                <Link
                  href="/brackets/join"
                  className="flex min-h-[48px] touch-manipulation items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-center text-xs font-semibold transition-all sm:text-sm"
                  style={{ borderColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)' }}
                  data-testid="bracket-join-pool-button"
                >
                  <Users className="h-4 w-4 shrink-0" />
                  <span className="leading-tight">Join Pool</span>
                </Link>
                <Link
                  href="/brackets/world-cup"
                  className="flex min-h-[48px] touch-manipulation items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-center text-xs font-semibold transition-all sm:text-sm"
                  style={{ borderColor: 'rgba(103,232,249,0.35)', color: 'rgba(207,250,254,0.95)', background: 'rgba(8,145,178,0.12)' }}
                  data-testid="world-cup-bracket-card"
                >
                  <Globe2 className="h-4 w-4 shrink-0" />
                  <span className="leading-tight">World Cup</span>
                </Link>
                <Link
                  href="/brackets/discover"
                  className="flex min-h-[48px] touch-manipulation items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-center text-xs font-semibold transition-all sm:text-sm"
                  style={{ borderColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)' }}
                  data-testid="bracket-discover-link"
                >
                  <span className="leading-tight">Discover leagues</span>
                </Link>
                <Link
                  href="/creators"
                  className="col-span-2 flex min-h-[48px] touch-manipulation items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-center text-xs font-semibold transition-all sm:text-sm md:col-span-1"
                  style={{ borderColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)' }}
                >
                  <span className="leading-tight">Creator leagues</span>
                </Link>
              </div>

              <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    Playoff Challenge by Sport
                  </h2>
                  <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {playoffSports.length} sports
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {playoffSports.map(({ sport, ui }) => (
                    <Link
                      key={sport}
                      href={`/brackets/leagues/new?sport=${encodeURIComponent(sport)}&challengeType=playoff_challenge`}
                      className="rounded-xl px-3 py-2 text-xs font-semibold text-center transition flex items-center justify-center gap-2"
                      style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.8)' }}
                      data-testid={`bracket-playoff-sport-${sport}`}
                    >
                      <span
                        className="inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-[9px] font-bold"
                        style={{ background: 'rgba(56,189,248,0.15)', color: 'rgba(186,230,253,0.95)' }}
                      >
                        {ui.badge}
                      </span>
                      <span>{ui.shortLabel}</span>
                    </Link>
                  ))}
                </div>
              </div>

              {myLeagues.length > 0 ? (
                <div className="space-y-2">
                  <h2 className="text-xs font-bold uppercase tracking-wider px-1" style={{ color: 'rgba(255,255,255,0.35)' }}>My Pools</h2>
                  {myLeagues.map((m: any) => {
                    const sportUI = resolveBracketSportUI(m.league.tournament?.sport ?? null)
                    const challengeLabel = resolveBracketChallengeLabel({
                      sport: m.league.tournament?.sport,
                      challengeType: m.league.scoringRules?.challengeType,
                      bracketType: m.league.scoringRules?.bracketType,
                    })
                    return (
                      <Link
                        key={m.league.id}
                        href={`/brackets/leagues/${m.league.id}`}
                        className="flex items-center gap-3 p-3.5 rounded-xl transition group"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                      >
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(59,130,246,0.12)' }}>
                          <span className="text-[10px] font-bold" style={{ color: '#7dd3fc' }}>{sportUI.badge}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm truncate group-hover:text-white transition">{m.league.name}</div>
                          <div className="text-[11px] mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
                            {challengeLabel}
                          </div>
                          <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                            {m.league._count.members} member{m.league._count.members !== 1 ? 's' : ''} &bull; {m.league._count.entries} bracket{m.league._count.entries !== 1 ? 's' : ''}
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'rgba(255,255,255,0.2)' }} />
                      </Link>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-2xl p-6 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)' }}>
                  <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    No pools yet. Create one or join a friend&apos;s pool to get started!
                  </p>
                </div>
              )}

              <div className="text-xs text-center" style={{ color: 'rgba(255,255,255,0.2)' }}>
                Signed in as {user?.name || user?.email || 'User'}
              </div>
            </div>
          )}
        </div>
      </div>
      <BracketShell>
        <div className="space-y-4">
          <BracketHomeTabs
            poolCount={myLeagues.length}
          />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <MyPoolsTab
              pools={myLeagues.map((m: any) => ({
                id: m.league.id,
                name: m.league.name,
                members: m.league._count.members,
                entries: m.league._count.entries,
                sport: m.league.tournament?.sport ?? "NFL",
                challengeType: m.league.scoringRules?.challengeType ?? null,
                bracketType: m.league.scoringRules?.bracketType ?? null,
              }))}
            />
            <BracketAICoachTab />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <CreatePoolTab />
            <PlayoffChallengeTab />
            <JoinPoolTab />
            <StandingsTab />
            <BracketHistoryTab
              pools={myLeagues.map((m: any) => ({
                id: m.league.id,
                name: m.league.name,
                entries: m.league._count.entries,
                sport: m.league.tournament?.sport ?? "NFL",
                challengeType: m.league.scoringRules?.challengeType ?? null,
                bracketType: m.league.scoringRules?.bracketType ?? null,
              }))}
            />
          </div>
        </div>
      </BracketShell>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pb-12 space-y-8">

        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="px-5 pt-5 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Star className="w-4 h-4" style={{ color: '#3b82f6' }} />
              <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#3b82f6' }}>AF March Madness Scoring</h3>
            </div>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Our headline scoring system rewards bold picks and smart strategy.
            </p>
          </div>
          <div className="px-5 pb-5">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
              {[
                { round: "R64", pts: "1" },
                { round: "R32", pts: "2" },
                { round: "S16", pts: "5" },
                { round: "E8", pts: "10" },
                { round: "F4", pts: "18" },
                { round: "CH", pts: "30" },
              ].map((r) => (
                <div key={r.round} className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.1)' }}>
                  <div className="text-[10px] font-bold uppercase" style={{ color: 'rgba(255,255,255,0.3)' }}>{r.round}</div>
                  <div className="text-lg font-black" style={{ color: '#3b82f6' }}>{r.pts}</div>
                  <div className="text-[9px]" style={{ color: 'rgba(255,255,255,0.2)' }}>pts</div>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <div className="flex items-start gap-2.5 rounded-lg p-2.5" style={{ background: 'rgba(192,132,252,0.04)' }}>
                <Zap className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#c084fc' }} />
                <div>
                  <span className="text-xs font-bold" style={{ color: '#c084fc' }}>Upset Delta Bonus</span>
                  <span className="text-xs ml-1" style={{ color: 'rgba(255,255,255,0.4)' }}>&mdash; Earn bonus points for correctly picking upsets. The bigger the seed difference, the bigger the bonus.</span>
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-lg p-2.5" style={{ background: 'rgba(251,146,60,0.04)' }}>
                <Crown className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#fb923c' }} />
                <div>
                  <span className="text-xs font-bold" style={{ color: '#fb923c' }}>Leverage Bonus</span>
                  <span className="text-xs ml-1" style={{ color: 'rgba(255,255,255,0.4)' }}>&mdash; Going against the consensus with a correct pick earns you a leverage multiplier.</span>
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-lg p-2.5" style={{ background: 'rgba(34,197,94,0.04)' }}>
                <Shield className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#22c55e' }} />
                <div>
                  <span className="text-xs font-bold" style={{ color: '#22c55e' }}>Insurance Token</span>
                  <span className="text-xs ml-1" style={{ color: 'rgba(255,255,255,0.4)' }}>&mdash; Protect one pick per round. If your insured pick loses, you keep partial points.</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="px-5 pt-5 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="w-4 h-4" style={{ color: '#fb923c' }} />
              <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>How It Works</h3>
            </div>
          </div>
          <div className="px-5 pb-5 space-y-3">
            {[
              { step: "1", title: "Create or Join a Pool", desc: "Start your own bracket pool or join a friend's with an invite code. Unlimited members, always free." },
              { step: "2", title: "Fill Out Your Bracket", desc: "Tap any matchup to open the pick wizard. Choose winners round by round. AI analysis helps you make smarter picks." },
              { step: "3", title: "Compete & Climb", desc: "Track your AF March Madness score on the live leaderboard. Earn upset bonuses, leverage multipliers, and bragging rights." },
              { step: "4", title: "Win Your Pool", desc: "The player with the most points at the end of the tournament wins. Global leaderboard rankings included." },
            ].map((item) => (
              <div key={item.step} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-black" style={{ background: 'rgba(251,146,60,0.12)', color: '#fb923c' }}>
                  {item.step}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">{item.title}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="px-5 pt-5 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4" style={{ color: '#22d3ee' }} />
              <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#22d3ee' }}>Bracket Preview</h3>
            </div>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Full 64-team bracket with 4 regions and AI-powered pick wizard.
            </p>
          </div>
          <div className="px-5 pb-5">
            <div className="rounded-xl p-4 sm:p-6" style={{ background: '#0f1a2e', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="rounded-xl p-3 mb-5 flex items-center gap-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="text-lg">&#9201;</span>
                <div>
                  <div className="text-sm font-bold text-white">Brackets open on March 17th</div>
                  <div className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>Waiting for Selection Sunday</div>
                </div>
              </div>

              <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 sm:gap-x-4 gap-y-3 items-center">
                <div className="space-y-1.5">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={`w-${i}`} className="flex gap-0.5">
                      <div className="h-3 rounded-sm flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                      <div className="h-3 rounded-sm flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    </div>
                  ))}
                  <div className="flex justify-center gap-0.5 pt-1">
                    <div className="h-3 w-8 rounded-sm" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    <div className="h-3 w-8 rounded-sm" style={{ background: 'rgba(255,255,255,0.08)' }} />
                  </div>
                  <div className="flex justify-center gap-0.5">
                    <div className="h-3 w-10 rounded-sm" style={{ background: 'rgba(255,255,255,0.1)' }} />
                    <div className="h-3 w-10 rounded-sm" style={{ background: 'rgba(255,255,255,0.1)' }} />
                  </div>
                  <div className="text-center">
                    <span className="text-[10px] font-bold tracking-wider" style={{ color: 'rgba(255,255,255,0.25)' }}>W</span>
                  </div>

                  <div className="mt-3" />
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={`e-${i}`} className="flex gap-0.5">
                      <div className="h-3 rounded-sm flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                      <div className="h-3 rounded-sm flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    </div>
                  ))}
                  <div className="flex justify-center gap-0.5 pt-1">
                    <div className="h-3 w-8 rounded-sm" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    <div className="h-3 w-8 rounded-sm" style={{ background: 'rgba(255,255,255,0.08)' }} />
                  </div>
                  <div className="flex justify-center gap-0.5">
                    <div className="h-3 w-10 rounded-sm" style={{ background: 'rgba(255,255,255,0.1)' }} />
                    <div className="h-3 w-10 rounded-sm" style={{ background: 'rgba(255,255,255,0.1)' }} />
                  </div>
                  <div className="text-center">
                    <span className="text-[10px] font-bold tracking-wider" style={{ color: 'rgba(255,255,255,0.25)' }}>E</span>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center gap-1 self-center">
                  <div className="h-4 w-10 rounded-sm" style={{ background: 'rgba(255,255,255,0.06)' }} />
                  <div className="h-4 w-10 rounded-sm" style={{ background: 'rgba(255,255,255,0.06)' }} />
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center my-1" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <Trophy className="w-5 h-5" style={{ color: 'rgba(255,255,255,0.3)' }} />
                  </div>
                  <div className="h-4 w-10 rounded-sm" style={{ background: 'rgba(255,255,255,0.06)' }} />
                  <div className="h-4 w-10 rounded-sm" style={{ background: 'rgba(255,255,255,0.06)' }} />
                </div>

                <div className="space-y-1.5">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={`s-${i}`} className="flex gap-0.5">
                      <div className="h-3 rounded-sm flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                      <div className="h-3 rounded-sm flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    </div>
                  ))}
                  <div className="flex justify-center gap-0.5 pt-1">
                    <div className="h-3 w-8 rounded-sm" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    <div className="h-3 w-8 rounded-sm" style={{ background: 'rgba(255,255,255,0.08)' }} />
                  </div>
                  <div className="flex justify-center gap-0.5">
                    <div className="h-3 w-10 rounded-sm" style={{ background: 'rgba(255,255,255,0.1)' }} />
                    <div className="h-3 w-10 rounded-sm" style={{ background: 'rgba(255,255,255,0.1)' }} />
                  </div>
                  <div className="text-center">
                    <span className="text-[10px] font-bold tracking-wider" style={{ color: 'rgba(255,255,255,0.25)' }}>S</span>
                  </div>

                  <div className="mt-3" />
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={`mw-${i}`} className="flex gap-0.5">
                      <div className="h-3 rounded-sm flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                      <div className="h-3 rounded-sm flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    </div>
                  ))}
                  <div className="flex justify-center gap-0.5 pt-1">
                    <div className="h-3 w-8 rounded-sm" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    <div className="h-3 w-8 rounded-sm" style={{ background: 'rgba(255,255,255,0.08)' }} />
                  </div>
                  <div className="flex justify-center gap-0.5">
                    <div className="h-3 w-10 rounded-sm" style={{ background: 'rgba(255,255,255,0.1)' }} />
                    <div className="h-3 w-10 rounded-sm" style={{ background: 'rgba(255,255,255,0.1)' }} />
                  </div>
                  <div className="text-center">
                    <span className="text-[10px] font-bold tracking-wider" style={{ color: 'rgba(255,255,255,0.25)' }}>MW</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.1)' }}>
                <div className="text-sm font-bold" style={{ color: '#3b82f6' }}>Tap to Pick</div>
                <div className="text-[10px] mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Select any matchup to open the pick wizard.</div>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.1)' }}>
                <div className="text-sm font-bold" style={{ color: '#22d3ee' }}>AI Analysis</div>
                <div className="text-[10px] mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Win probabilities and matchup breakdowns.</div>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(192,132,252,0.06)', border: '1px solid rgba(192,132,252,0.1)' }}>
                <div className="text-sm font-bold" style={{ color: '#c084fc' }}>Auto-Advance</div>
                <div className="text-[10px] mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Picks auto-cycle to the next matchup.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.06) 0%, rgba(192,132,252,0.04) 100%)', border: '1px solid rgba(59,130,246,0.12)' }}>
          <div className="px-5 py-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(59,130,246,0.12)' }}>
                <ExternalLink className="w-5 h-5" style={{ color: '#3b82f6' }} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold mb-1">League Dues & Payouts</h3>
                <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Want to play for real money? Use FanCred to collect league dues and manage payouts. AllFantasy brackets are always free &mdash; FanCred handles the money side separately.
                </p>
                <a
                  href="https://fancred.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
                  style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)' }}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Set Up on FanCred
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="px-5 pt-5 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.4)' }} />
              <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>Rules & Fair Play</h3>
            </div>
          </div>
          <div className="px-5 pb-5 space-y-2.5">
            {[
              "All brackets are 100% free. No hosting fees, no premium tiers.",
              "Each pool member gets one bracket entry per tournament.",
              "All picks must be submitted before the tournament tips off (First Four excluded).",
              "Picks lock per game at scheduled tip-off time. No changes after lock.",
              "AF March Madness scoring is used for all pools: R64=1, R32=2, S16=5, E8=10, F4=18, CH=30.",
              "Upset Delta Bonus: Correctly picking a lower seed earns bonus points equal to the seed difference.",
              "Leverage Bonus: Going against consensus (>60% ownership) with a correct pick earns a 1.5x multiplier.",
              "Insurance Tokens (if enabled): Protect one pick per round for partial credit if it loses.",
              "Tie-breaker: Championship game total score prediction. Closest without going over wins.",
              "Pool creators can toggle pick visibility (hidden until lock) and bracket copying.",
              "No collusion, bracket sharing before lock, or multi-accounting. Violations = removal from pool.",
            ].map((rule, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className="w-4 h-4 rounded flex items-center justify-center shrink-0 mt-0.5 text-[9px] font-bold" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.25)' }}>
                  {i + 1}
                </div>
                <span className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>{rule}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.06) 0%, rgba(251,146,60,0.04) 100%)', border: '1px solid rgba(239,68,68,0.12)' }}>
          <div className="px-5 py-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(239,68,68,0.12)' }}>
                <Heart className="w-5 h-5" style={{ color: '#ef4444' }} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold mb-1">Support AllFantasy</h3>
                <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  AllFantasy is 100% free. If you enjoy the platform, consider a small donation to help cover server costs, data feeds, and development. Every bit helps keep the lights on.
                </p>
                <Link
                  href="/donate"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
                  style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
                >
                  <Heart className="w-3.5 h-3.5" />
                  Support Us
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="px-5 pt-5 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Scale className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.35)' }} />
              <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>Legal Disclaimer</h3>
            </div>
          </div>
          <div className="px-5 pb-5 space-y-4">
            <div className="rounded-xl p-4" style={{ background: 'rgba(239,68,68,0.03)', border: '1px solid rgba(239,68,68,0.08)' }}>
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#ef4444' }} />
                <div>
                  <div className="text-xs font-bold mb-1" style={{ color: '#ef4444' }}>Not Gambling &mdash; No Prizes, No Wagering</div>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    AllFantasy does not promote, facilitate, or constitute gambling in any form. AllFantasy does not offer, award, distribute, or guarantee any prizes, monetary or otherwise. AllFantasy does not hold, manage, escrow, or custody any user funds, entry fees, or wagers at any time. No real money, cryptocurrency, or item of monetary value is at stake when participating in any bracket pool or challenge on this platform. Participation is entirely free and for entertainment purposes only.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ background: 'rgba(59,130,246,0.03)', border: '1px solid rgba(59,130,246,0.08)' }}>
              <div className="flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#3b82f6' }} />
                <div>
                  <div className="text-xs font-bold mb-1" style={{ color: '#3b82f6' }}>AI Features &mdash; Experimental, Not an Advantage</div>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    The artificial intelligence features provided within AllFantasy, including but not limited to matchup analysis, win probabilities, AI recommendations, and pick assistance, are experimental in nature and are provided solely for the purpose of exploring and testing the concept of AI-assisted sports analysis. These AI features do not provide any competitive advantage, guaranteed accuracy, or predictive reliability. AI-generated insights are for informational and entertainment purposes only and should not be relied upon for any decision-making, financial or otherwise. AllFantasy makes no representations or warranties regarding the accuracy, completeness, or reliability of any AI-generated content. Users acknowledge that AI outputs may be incorrect, incomplete, or misleading, and that all bracket selections are made solely at the user&apos;s own discretion.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ background: 'rgba(34,197,94,0.03)', border: '1px solid rgba(34,197,94,0.08)' }}>
              <div className="flex items-start gap-2.5">
                <Shield className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#22c55e' }} />
                <div>
                  <div className="text-xs font-bold mb-1" style={{ color: '#22c55e' }}>Donations &mdash; Voluntary & Non-Refundable</div>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    AllFantasy operates as a free platform. Any financial transactions processed through AllFantasy are strictly voluntary donations made by users to support the continued development and operation of the platform. Donations do not grant any additional features, advantages, access, or preferential treatment. Donations are non-refundable and are not tied to any product, service, or outcome. AllFantasy is not a payment processor for league dues or prize pools. Any league dues, side bets, or payout arrangements between users are handled entirely through third-party services (such as FanCred) and are solely the responsibility of the users involved. AllFantasy bears no liability for any third-party transactions.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ background: 'rgba(251,146,60,0.03)', border: '1px solid rgba(251,146,60,0.08)' }}>
              <div className="flex items-start gap-2.5">
                <ExternalLink className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#fb923c' }} />
                <div>
                  <div className="text-xs font-bold mb-1" style={{ color: '#fb923c' }}>Third-Party Services</div>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    AllFantasy may provide links to third-party services, including but not limited to FanCred (fancred.app), for the purpose of facilitating league dues and payouts between users. AllFantasy is not affiliated with, endorsed by, or responsible for any third-party service. Any transactions conducted through third-party platforms are governed by those platforms&apos; respective terms of service, privacy policies, and applicable laws. AllFantasy disclaims all liability for any losses, disputes, or damages arising from the use of third-party services.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="flex items-start gap-2.5">
                <Trophy className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }} />
                <div>
                  <div className="text-xs font-bold mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>Limitation of Liability</div>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    AllFantasy is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind, express or implied. To the fullest extent permitted by applicable law, AllFantasy, its operators, affiliates, and contributors shall not be liable for any direct, indirect, incidental, consequential, or punitive damages arising from the use of or inability to use this platform, including but not limited to reliance on AI-generated content, loss of data, or any financial losses incurred through third-party services. By using AllFantasy, you acknowledge that you have read, understood, and agree to be bound by this disclaimer.
                  </p>
                </div>
              </div>
            </div>

            <p className="text-[10px] text-center pt-1" style={{ color: 'rgba(255,255,255,0.2)' }}>
              Last updated: February 2026. AllFantasy reserves the right to modify this disclaimer at any time.
            </p>
          </div>
        </div>

        <div className="text-center pb-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Image src="/af-crest.png" alt="AF" width={20} height={20} className="rounded opacity-40" />
            <span className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.2)' }}>AllFantasy</span>
          </div>
          <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.15)' }}>
            Free forever. Built for fans, by fans.
          </p>
        </div>
      </div>
    </div>
  )
}










