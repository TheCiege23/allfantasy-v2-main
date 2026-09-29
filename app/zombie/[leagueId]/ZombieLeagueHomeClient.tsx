'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  AlertTriangle,
  ArrowUpRight,
  Biohazard,
  Bomb,
  Crosshair,
  FlaskConical,
  Globe,
  MessageSquare,
  Shield,
  Skull,
  Sparkles,
  Swords,
  Trophy,
  Wallet,
} from 'lucide-react'
import { ZombieStatusBadge } from '@/app/zombie/components/ZombieStatusBadge'
import { ZombieEventFeed } from '@/app/zombie/components/ZombieEventFeed'
import { ZombieHordeBar } from '@/app/zombie/components/ZombieHordeBar'
import { ZombieWhispererCard } from '@/app/zombie/components/ZombieWhispererCard'
import { LeagueClipOverlayHost } from '@/components/league/LeagueClipOverlayHost'
import { ZombieCommandHero } from '@/components/zombie/ZombieCommandHero'
import { type ZombieDangerLevel } from '@/components/zombie/ZombieDangerMeter'
import { ZombieGlassPanel } from '@/components/zombie/ZombieGlassPanel'
import { ZombiePaymentStrip } from '@/components/zombie/ZombiePaymentStrip'
import { ZombieQuickAction } from '@/components/zombie/ZombieQuickAction'
import { getFanCredPublicUrl } from '@/lib/legal/fancredPublicUrl'
import { zombieRoleAccentClasses } from '@/lib/zombie/zombie-visual-system'
import { ZombieIntroModal } from '@/components/zombie/ZombieIntroModal'
import { getZombieTheme } from '@/lib/zombie/zombieBackgroundThemes'

const LEAGUE_SAFE_URL = 'https://www.leaguesafe.com'

type TeamRow = {
  rosterId: string
  status: string
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst?: number
  fantasyTeamName: string | null
  displayName: string | null
  riskScore?: number | null
  weeklyScore?: number | null
  weeklyWinnings?: number | null
  totalWinnings?: number | null
}

type Pack = {
  league: {
    name: string | null
    sport?: string | null
    logoUrl?: string | null
    currentWeek: number
    isPaid: boolean
    potTotal: number
    whispererIsPublic: boolean
    universeId: string | null
    status?: string | null
    level?: {
      name?: string | null
      rankOrder?: number | null
      tierLabel?: string | null
      tierTheme?: string | null
    } | null
    counts?: {
      survivor?: number
      zombie?: number
      whisperer?: number
      revived?: number
      alive?: number
      total?: number
      horde?: number
    } | null
    teams: TeamRow[]
    whispererRecord: {
      displayName: string
      ambushesRemaining: number
      isPubliclyRevealed: boolean
    } | null
    announcements: Array<{
      id: string
      type: string
      title: string
      content: string
      week: number | null
      createdAt: string
    }>
    latestResolution?: {
      status?: string | null
      resolvedAt?: string | null
    } | null
    topPerformers?: TeamRow[]
    dangerZone?: TeamRow[]
    recentInfections?: Array<{ id: string }>
    recentBashings?: Array<{ id: string }>
    recentMaulings?: Array<{ id: string }>
    backgroundTheme?: string | null
  }
  hordeSize: number
  survivorCount: number
  myTeam: TeamRow | null
  myActiveItemCount?: number
  myPendingItemCount?: number
  myResources?: {
    serums?: number
    weapons?: number
    activeItems?: number
    pendingItems?: number
  } | null
}

type FeedAnimation = {
  id: string
  animationType: string
  week: number
  metadata: unknown
  createdAt: string
}

function teamName(team: TeamRow | null | undefined) {
  if (!team) return 'Unknown team'
  return team.fantasyTeamName || team.displayName || team.rosterId
}

function toDangerLevel(score?: number | null): ZombieDangerLevel {
  if ((score ?? 0) >= 80) return 'doomed'
  if ((score ?? 0) >= 55) return 'critical'
  if ((score ?? 0) >= 30) return 'exposed'
  return 'stable'
}

function summaryLine(data: Pack['league'], pack: Pack) {
  const infections = data.recentInfections?.length ?? 0
  const bashings = data.recentBashings?.length ?? 0
  const maulings = data.recentMaulings?.length ?? 0
  const living = data.counts?.alive ?? pack.survivorCount
  const horde = data.counts?.horde ?? pack.hordeSize

  return `${living} alive, ${horde} in the horde, ${infections} new infections, ${bashings} bashings, ${maulings} maulings.`
}

export function ZombieLeagueHomeClient({ leagueId, userId }: { leagueId: string; userId: string | null }) {
  const [data, setData] = useState<Pack | null>(null)
  const [anims, setAnims] = useState<FeedAnimation[]>([])
  const [showIntroVideo, setShowIntroVideo] = useState(false)

  useEffect(() => {
    fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Pack | null) => setData(d))
      .catch(() => setData(null))
  }, [leagueId])

  useEffect(() => {
    if (data?.league?.backgroundTheme && userId) {
      setShowIntroVideo(true)
    }
  }, [data?.league?.backgroundTheme, userId])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      const r = await fetch(`/api/zombie/event-feed?leagueId=${encodeURIComponent(leagueId)}`, {
        credentials: 'include',
      }).catch(() => null)
      if (!r?.ok || cancelled) return
      const j = (await r.json()) as { animations?: FeedAnimation[] }
      if (j.animations) setAnims(j.animations)
    }
    void tick()
    const iv = setInterval(tick, 20_000)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [leagueId])

  const topPerformers = useMemo(() => {
    if (!data?.league?.topPerformers?.length) return []
    return data.league.topPerformers.slice(0, 3)
  }, [data])

  const winnings = useMemo(() => {
    const teams = data?.league?.teams ?? []
    let weekly = 0
    let season = 0
    for (const t of teams) {
      weekly += t.weeklyWinnings ?? 0
      season += t.totalWinnings ?? 0
    }
    return { weekly, season }
  }, [data?.league?.teams])

  if (!data?.league) {
    return <p className="text-[13px] text-[var(--zombie-text-dim)]">Loading island...</p>
  }

  const z = data.league
  const my = data.myTeam
  const displayName = teamName(my)
  const whispererRevealed = z.whispererIsPublic && (z.whispererRecord?.isPubliclyRevealed ?? true)
  const lastUpdate = z.announcements.find((a) => a.type === 'weekly_update' || a.type === 'weekly_recap')
  const hordeCount = z.counts?.horde ?? data.hordeSize
  const survivorCount = z.counts?.alive ?? data.survivorCount
  const myDanger = toDangerLevel(my?.riskScore)
  const hasUrgentRisk = myDanger === 'critical' || myDanger === 'doomed'
  const inventory = data.myResources ?? {}
  const chompinNames = (z.dangerZone?.length ? z.dangerZone : z.teams)
    .filter((team) => {
      const status = String(team.status ?? '').toLowerCase()
      return status.includes('survivor') || status.includes('revived')
    })
    .sort((a, b) => {
      if (a.wins !== b.wins) return a.wins - b.wins
      if (a.pointsFor !== b.pointsFor) return a.pointsFor - b.pointsFor
      return (b.pointsAgainst ?? 0) - (a.pointsAgainst ?? 0)
    })
    .slice(0, 3)
    .map((t) => teamName(t))

  const commissionerNote = z.announcements.find(
    (a) =>
      /commissioner|commission/i.test(a.type) ||
      /commissioner|commission|note from the commish/i.test(a.title),
  )

  const fanCredUrl = getFanCredPublicUrl()

  const quickActions = (
    <>
      <ZombieQuickAction
        href={`/zombie/${leagueId}/chat`}
        label="DM @Chimmy"
        icon={MessageSquare}
        kind="chat"
        data-testid="zombie-quick-chimmy"
      />
      <ZombieQuickAction
        href={`/zombie/${leagueId}/items`}
        label="Serums & antidotes"
        icon={FlaskConical}
        kind="serum"
        data-testid="zombie-quick-serum"
      />
      <ZombieQuickAction
        href={`/zombie/${leagueId}/items`}
        label="Weapons lab"
        icon={Swords}
        kind="weapon"
        data-testid="zombie-quick-weapon"
      />
      <ZombieQuickAction
        href={`/zombie/${leagueId}/items`}
        label="Bombs & overrides"
        icon={Bomb}
        kind="bomb"
        data-testid="zombie-quick-bomb"
      />
      <ZombieQuickAction
        href={`/zombie/${leagueId}/matchups`}
        label="Ambush & matchups"
        icon={Crosshair}
        kind="ambush"
        data-testid="zombie-quick-ambush"
      />
      {z.universeId ? (
        <ZombieQuickAction
          href={`/app/zombie-universe/${z.universeId}`}
          label="Universe tracker"
          icon={Globe}
          kind="universe"
          data-testid="zombie-quick-universe"
        />
      ) : null}
      {z.isPaid ? (
        <>
          <ZombieQuickAction href={LEAGUE_SAFE_URL} label="Pay LeagueSafe" icon={Wallet} kind="pay" data-testid="zombie-quick-leaguesafe" />
          <ZombieQuickAction href={fanCredUrl} label="Pay FanCred" icon={Wallet} kind="pay" data-testid="zombie-quick-fancred" />
        </>
      ) : null}
      <ZombieQuickAction
        href={`/zombie/${leagueId}/matchups`}
        label={hasUrgentRisk ? 'Risk: matchups' : 'Open matchups'}
        icon={hasUrgentRisk ? AlertTriangle : Crosshair}
        kind="neutral"
        data-testid="zombie-quick-matchups"
      />
    </>
  )

  const backgroundTheme = getZombieTheme(data?.league?.backgroundTheme)

  return (
    <>
      <ZombieIntroModal
        leagueId={leagueId}
        userId={userId ?? ''}
        leagueName={data?.league?.name ?? 'Zombie League'}
        backgroundTheme={data?.league?.backgroundTheme}
        enabled={showIntroVideo}
        onClose={() => setShowIntroVideo(false)}
      />
      <LeagueClipOverlayHost leagueId={leagueId} variant="zombie" enabled={Boolean(userId)} />
      <div
        className="min-h-screen transition-all duration-500"
        style={{
          backgroundImage: backgroundTheme
            ? `linear-gradient(135deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.88) 100%)`
            : undefined,
        }}
      >
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 lg:px-6">
        <ZombieCommandHero
          leagueName={z.name}
          logoUrl={z.logoUrl}
          sport={z.sport}
          week={z.currentWeek}
          level={z.level}
          survivorCount={survivorCount}
          hordeCount={hordeCount}
          whispererCount={z.counts?.whisperer ?? 0}
          potTotal={z.potTotal ?? 0}
          isPaid={z.isPaid}
          chompinNames={chompinNames}
          riskScore={my?.riskScore}
          dangerLevel={myDanger}
          whispererPanel={
            <ZombieWhispererCard
              revealed={whispererRevealed}
              displayName={z.whispererRecord?.displayName}
              ambushesRemaining={z.whispererRecord?.ambushesRemaining ?? 0}
              hordeSize={hordeCount}
            />
          }
          quickActions={quickActions}
        />

        <div className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
          <section className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <ZombieGlassPanel
                variant="tactical"
                title={displayName}
                eyebrow="Your survival card"
                icon={my ? <ZombieStatusBadge compact status={my.status} dangerLevel={myDanger} /> : undefined}
                shine
              >

                {my ? (
                  <>
                    <p className="mt-4 text-sm text-white/70">
                      Record {my.wins}-{my.losses} with {my.pointsFor.toFixed(1)} season points.
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Serums</p>
                        <p className="mt-2 text-sm font-bold text-teal-100">{inventory.serums ?? 0}</p>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Weapons</p>
                        <p className="mt-2 text-sm font-bold text-amber-100">{inventory.weapons ?? 0}</p>
                      </div>
                    </div>
                    <div
                      className={clsx(
                        'mt-4 rounded-2xl border p-4',
                        hasUrgentRisk ? 'border-red-500/30 bg-red-500/10' : 'border-emerald-500/22 bg-emerald-500/8',
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <AlertTriangle
                          className={clsx('mt-0.5 h-4 w-4 shrink-0', hasUrgentRisk ? 'text-red-200' : 'text-emerald-200')}
                        />
                        <div>
                          <p className="text-sm font-semibold text-white">
                            {hasUrgentRisk
                              ? 'You are at real infection risk this week.'
                              : 'You are not in the hottest danger pocket right now.'}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-white/65">
                            {hasUrgentRisk
                              ? 'Open Matchups and Chat before lock. The UI is treating your status as urgent based on current team risk and outbreak pressure.'
                              : 'Keep watching the feed, inventory, and Whisperer activity. The danger board updates as events land.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="mt-4 text-sm text-white/65">
                    Join this league to unlock your personal survival card, danger tracking, and inventory actions.
                  </p>
                )}
              </ZombieGlassPanel>

              <div className="space-y-4">
                <ZombieGlassPanel title="Inventory snapshot" eyebrow="Loadout" icon={<FlaskConical className="h-4 w-4 text-teal-200" />}>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Active</p>
                      <p className="mt-2 text-lg font-black text-white">{inventory.activeItems ?? data.myActiveItemCount ?? 0}</p>
                    </div>
                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Pending</p>
                      <p className="mt-2 text-lg font-black text-white">{inventory.pendingItems ?? data.myPendingItemCount ?? 0}</p>
                    </div>
                  </div>
                  <Link
                    href={`/zombie/${leagueId}/items`}
                    className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/85 transition hover:bg-white/[0.08]"
                  >
                    Open inventory
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </ZombieGlassPanel>

                {z.isPaid ? (
                  <ZombieGlassPanel variant="reward" title="Dues & payouts" eyebrow="Paid league" icon={<Wallet className="h-4 w-4 text-amber-200" />}>
                    <p className="text-sm text-white/65">
                      AllFantasy does not hold funds — use LeagueSafe or FanCred for real-money leagues.
                    </p>
                    <div className="mt-4">
                      <ZombiePaymentStrip />
                    </div>
                  </ZombieGlassPanel>
                ) : null}

                <ZombieGlassPanel title="Winnings pulse" eyebrow="Economy" icon={<Trophy className="h-4 w-4 text-amber-200" />} variant="reward">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/8 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Week paid out</p>
                      <p className="mt-1 text-lg font-black text-amber-50">${winnings.weekly.toFixed(0)}</p>
                    </div>
                    <div className="rounded-2xl border border-amber-500/15 bg-black/30 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Season tracked</p>
                      <p className="mt-1 text-lg font-black text-white">${winnings.season.toFixed(0)}</p>
                    </div>
                  </div>
                </ZombieGlassPanel>
              </div>
            </div>

            <ZombieGlassPanel title="Horde growth tracker" eyebrow="Pressure" icon={<Skull className="h-5 w-5 text-red-200" />} variant="danger">
              <ZombieHordeBar hordeCount={hordeCount} survivorCount={survivorCount} />
              <p className="mt-4 text-sm text-white/65">{summaryLine(z, data)}</p>
            </ZombieGlassPanel>

            <div className="grid gap-4 lg:grid-cols-2">
              <ZombieGlassPanel title="Managers under pressure" eyebrow="Danger zone" icon={<Crosshair className="h-5 w-5 text-red-200" />} variant="danger">
                <div className="space-y-3">
                  {(z.dangerZone?.length ? z.dangerZone : z.teams).slice(0, 4).map((team, index) => {
                    const role = zombieRoleAccentClasses(team.status)
                    return (
                      <div
                        key={team.rosterId}
                        className={clsx(
                          'flex items-center justify-between gap-3 rounded-2xl border bg-white/[0.03] px-4 py-3',
                          role.border,
                          role.glow,
                        )}
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Hot seat {index + 1}</p>
                          <p className="truncate text-sm font-semibold text-white">{teamName(team)}</p>
                        </div>
                        <ZombieStatusBadge status={team.status} dangerLevel={toDangerLevel(team.riskScore)} />
                      </div>
                    )
                  })}
                </div>
              </ZombieGlassPanel>

              <ZombieGlassPanel title="Command summary" eyebrow="Weekly update" icon={<Sparkles className="h-5 w-5 text-amber-200" />}>
                {lastUpdate ? (
                  <>
                    <p className="text-sm font-semibold text-white">Week {lastUpdate.week ?? z.currentWeek}</p>
                    <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-sm leading-6 text-white/70">{lastUpdate.content}</p>
                  </>
                ) : (
                  <p className="text-sm text-white/60">
                    No weekly recap has been posted yet. The home screen is still tracking live events below.
                  </p>
                )}
                {z.latestResolution?.status ? (
                  <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-xs text-white/60">
                    Latest resolution status: <span className="capitalize text-white/85">{z.latestResolution.status}</span>
                  </div>
                ) : null}
              </ZombieGlassPanel>
            </div>

            {commissionerNote ? (
              <ZombieGlassPanel title={commissionerNote.title || 'Commissioner note'} eyebrow="Desk" icon={<Shield className="h-5 w-5 text-sky-200" />}>
                <p className="whitespace-pre-wrap text-sm leading-6 text-white/72">{commissionerNote.content}</p>
              </ZombieGlassPanel>
            ) : null}
          </section>

          <aside className="space-y-4">
            <ZombieGlassPanel title="Outbreak timeline" eyebrow="Feed" icon={<Swords className="h-5 w-5 text-red-200" />} variant="danger">
              <ZombieEventFeed
                animations={anims}
                announcements={z.announcements}
                maxItems={5}
                compact
                leagueId={leagueId}
                leagueName={z.name}
              />
              <Link
                href={`/zombie/${leagueId}/history`}
                className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/85 transition hover:bg-white/[0.08]"
              >
                Open full history
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </ZombieGlassPanel>

            <ZombieGlassPanel title="Leaders this week" eyebrow="Top performers" icon={<Trophy className="h-5 w-5 text-amber-200" />} variant="reward">
              <div className="space-y-3">
                {(topPerformers.length ? topPerformers : z.teams.slice(0, 3)).map((team, index) => {
                  const role = zombieRoleAccentClasses(team.status)
                  return (
                    <div
                      key={team.rosterId}
                      className={clsx('rounded-2xl border bg-white/[0.03] px-4 py-3', role.border, role.glow)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Performer {index + 1}</p>
                          <p className="truncate text-sm font-semibold text-white">{teamName(team)}</p>
                        </div>
                        <ZombieStatusBadge status={team.status} />
                      </div>
                      <p className="mt-2 text-xs text-white/60">
                        Season points {team.pointsFor.toFixed(1)}
                        {typeof team.weeklyScore === 'number' ? ` | Week score ${team.weeklyScore.toFixed(1)}` : ''}
                      </p>
                    </div>
                  )
                })}
              </div>
            </ZombieGlassPanel>

            <ZombieGlassPanel title="Jump to live surfaces" eyebrow="Navigation" icon={<ArrowUpRight className="h-5 w-5 text-cyan-200" />}>
              <div className="grid gap-2">
                <Link
                  href={`/zombie/${leagueId}/standings`}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/85 transition hover:bg-white/[0.08]"
                >
                  Standings and status map
                </Link>
                <Link
                  href={`/zombie/${leagueId}/matchups`}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/85 transition hover:bg-white/[0.08]"
                >
                  Matchups and infection risk
                </Link>
                <Link
                  href={`/zombie/${leagueId}/chat`}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/85 transition hover:bg-white/[0.08]"
                >
                  League chat and @Chimmy
                </Link>
                {z.universeId ? (
                  <Link
                    href={`/app/zombie-universe/${z.universeId}`}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/85 transition hover:bg-white/[0.08]"
                  >
                    Universe war room
                  </Link>
                ) : null}
              </div>
            </ZombieGlassPanel>
          </aside>
        </div>
        </div>
      </div>
    </>
  )
}
