'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { BarChart3, Brackets, Crown, Percent, Target, Trophy } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { CompositeProfile } from '@/lib/legacy/overview-scoring'
import { RANK_LEVELS, getLevelFromXp, getLevelIcon } from '@/lib/rank/levels'
import { RankingFaqPanel } from '@/components/rankings/RankingFaqPanel'
import { LegacyRankingsImportPanel } from '@/components/rankings/LegacyRankingsImportPanel'
import type { RankLevelApiPayload } from '@/lib/rank/rank-level-payload'
import {
  AfRankingsAiPanel,
  AfRankingsHeroPremium,
  AfRankingsHistoryPlaceholder,
  AfRankingsLeaderboardPlaceholder,
  AfRankingsPerformanceSummary,
  AfRankingsTierLadder,
  AfRankingsXpBreakdown,
  RankSnapshotCardPremium,
} from '@/components/rankings/AfRankingsPageSections'

/** Split AF Legacy overview chunks so the rankings route initial bundle stays smaller. */
const OverviewReportCard = dynamic(() => import('@/components/legacy/OverviewReportCard'), {
  loading: () => (
    <div
      className="h-64 animate-pulse rounded-2xl border border-white/8 bg-white/[0.03]"
      aria-hidden
    />
  ),
})
const OverviewInsights = dynamic(() => import('@/components/legacy/OverviewInsights'), {
  loading: () => (
    <div
      className="h-44 animate-pulse rounded-2xl border border-white/8 bg-white/[0.03]"
      aria-hidden
    />
  ),
})
const OverviewLanes = dynamic(() => import('@/components/legacy/OverviewLanes'), {
  loading: () => (
    <div
      className="h-52 animate-pulse rounded-2xl border border-white/8 bg-white/[0.03]"
      aria-hidden
    />
  ),
})

interface PlayerRank {
  careerTier: number
  careerTierName: string
  careerLevel: number
  careerXp: string
  aiReportGrade: string | null
  aiScore: number | null
  aiInsight: string
  winRate: number | null
  playoffRate: number | null
  championshipCount: number
  seasonsPlayed: number
  totalWins?: number
  totalLosses?: number
  totalTies?: number
  playoffAppearances?: number
  importedAt: string | null
}

interface RankResponse {
  imported: boolean
  rank: PlayerRank | null
  overviewProfile?: CompositeProfile | null
  legacyUsername?: string | null
  tier?: string | null
  tierName?: string | null
  xpTotal?: number | null
  xpLevel?: number | null
  level?: number | null
  levelName?: string | null
  tierGroup?: number | null
  color?: string | null
  bgColor?: string | null
  xpIntoLevel?: number | null
  xpForLevel?: number | null
  progressPct?: number | null
  nextLevelName?: string | null
  careerWins?: number | null
  careerLosses?: number | null
  careerChampionships?: number | null
  careerPlayoffAppearances?: number | null
  careerSeasonsPlayed?: number | null
  careerLeaguesPlayed?: number | null
  rankProcessing?: boolean
  rankCalculatedAt?: string | null
  error?: string
  careerStats?: {
    seasonsPlayed: number
    totalWins: number
    totalLosses: number
    championships: number
    playoffAppearances: number
    leaguesPlayed: number
  } | null
  stats?: RankResponse['careerStats']
}

function rankLevelPayloadFromResponse(data: RankResponse): RankLevelApiPayload | null {
  const xp = data.xpTotal ?? (data.rank != null ? Number(data.rank.careerXp) : 0) ?? 0
  const lv = getLevelFromXp(xp)
  const hasRankSignal =
    Boolean(data.tier?.trim()) || typeof data.level === 'number' || data.rank != null
  if (!hasRankSignal) return null
  const level = lv.level
  const row = RANK_LEVELS.find((r) => r.level === level) ?? lv
  return {
    tier: data.tier?.trim() || row.tier,
    level,
    levelName: data.levelName?.trim() ?? row.name,
    tierGroup:
      typeof data.tierGroup === 'number' && Number.isFinite(data.tierGroup)
        ? data.tierGroup
        : Number(data.tierGroup) || row.tierGroup,
    color: data.color ?? row.color,
    bgColor: data.bgColor ?? row.bgColor,
    xpTotal: xp,
    xpIntoLevel: data.xpIntoLevel ?? lv.xpIntoLevel,
    xpForLevel: data.xpForLevel ?? lv.xpForLevel,
    progressPct: data.progressPct ?? lv.progressPct,
    nextLevelName: data.nextLevelName ?? lv.nextLevel?.name ?? null,
    careerWins: data.careerWins ?? data.careerStats?.totalWins ?? null,
    careerLosses: data.careerLosses ?? data.careerStats?.totalLosses ?? null,
    careerChampionships: data.careerChampionships ?? data.careerStats?.championships ?? null,
    careerPlayoffAppearances: data.careerPlayoffAppearances ?? data.careerStats?.playoffAppearances ?? null,
    careerSeasonsPlayed: data.careerSeasonsPlayed ?? data.careerStats?.seasonsPlayed ?? null,
    careerLeaguesPlayed: data.careerLeaguesPlayed ?? data.careerStats?.leaguesPlayed ?? null,
    rankCalculatedAt: data.rankCalculatedAt ?? null,
  }
}

/** When API returns tier + stats but omits nested `rank` (older clients), build a display rank. */
function playerRankFromApiResponse(data: RankResponse): PlayerRank | null {
  if (data.rank) {
    const xpNum = Number(data.rank.careerXp) || data.xpTotal || 0
    const lv = getLevelFromXp(xpNum)
    const wr = data.rank.winRate
    const pr = data.rank.playoffRate
    return {
      ...data.rank,
      careerLevel: lv.level,
      careerTier: lv.tierGroup,
      careerTierName: lv.name,
      winRate: typeof wr === 'number' && Number.isFinite(wr) ? wr : Number(wr) || 0,
      playoffRate: typeof pr === 'number' && Number.isFinite(pr) ? pr : Number(pr) || 0,
    }
  }
  const cs = data.careerStats ?? data.stats ?? null
  const xpNum = data.xpTotal ?? 0
  const lv = getLevelFromXp(xpNum)
  if (data.tier?.trim() || typeof data.level === 'number') {
    const row = RANK_LEVELS.find((r) => r.level === lv.level) ?? lv
    return {
      careerTier: data.tierGroup ?? row.tierGroup,
      careerTierName: data.levelName?.trim() || data.tierName?.trim() || row.name,
      careerLevel: lv.level,
      careerXp: String(xpNum),
      aiReportGrade: 'B',
      aiScore: 70,
      aiInsight: 'Import your leagues to generate your AI insight.',
      winRate: 0,
      playoffRate: 0,
      championshipCount: cs?.championships ?? 0,
      seasonsPlayed: cs?.seasonsPlayed ?? 0,
      totalWins: cs?.totalWins,
      totalLosses: cs?.totalLosses,
      playoffAppearances: cs?.playoffAppearances,
      importedAt: data.rankCalculatedAt ?? null,
    }
  }
  return null
}

type ImportJobProgressResponse = {
  status: string
  progress: number
  currentSeason: number | null
  seasonsCompleted: number | null
  totalSeasons: number | null
  totalLeaguesSaved: number | null
  lastRankTier: string | null
  lastRankLevel: number | null
  lastXpTotal: number | null
  completedAt?: string | null
  seasons: Array<{
    season: number
    status: string
    leagueCount: number | null
    wins: number | null
    losses: number | null
    championships?: number | null
    rankAfter: string | null
    levelAfter: number | null
    xpEarned?: number | null
  }>
}

const RANK_API_TIMEOUT_MS = 15000

const statusIcon = (s: string) =>
  (
    ({
      complete: '✓',
      processing: '⟳',
      error: '✕',
      empty: '—',
      pending: '·',
    }) as Record<string, string>
  )[s] ?? '·'

const statusColor = (s: string) =>
  (
    ({
      complete: '#6EE7A0',
      processing: '#38BDF8',
      error: '#F87171',
      empty: '#94A3B8',
      pending: '#64748B',
    }) as Record<string, string>
  )[s] ?? '#64748B'

function ImportProgressPanel({
  job,
  loading,
  error,
}: {
  job: ImportJobProgressResponse | null
  loading: boolean
  error: string | null
}) {
  const seasonsSorted = job?.seasons?.length ? [...job.seasons].sort((a, b) => a.season - b.season) : []
  const pct = Math.min(100, Math.max(0, job?.progress ?? 0))

  return (
    <div data-testid="import-progress-panel">
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes import-season-spin { to { transform: rotate(360deg); } }`,
        }}
      />
      <div
        style={{
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 16,
          padding: 24,
          background: 'linear-gradient(145deg, rgba(10,18,40,0.95), rgba(7,7,26,0.98))',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#f8fafc' }}>Importing your legacy history</h3>
        {error ? <p style={{ marginTop: 10, fontSize: 14, color: '#fca5a5' }}>{error}</p> : null}
        {loading && !job ? (
          <p style={{ marginTop: 16, fontSize: 13, color: 'rgba(248,250,252,0.5)' }}>Loading job status…</p>
        ) : null}

        {job ? (
          <>
            <div style={{ margin: '16px 0 8px', height: 10, background: 'rgba(255,255,255,0.08)', borderRadius: 5 }}>
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, #185FA5, #7c3aed)',
                  borderRadius: 5,
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
                color: 'rgba(248,250,252,0.45)',
                marginBottom: 20,
              }}
            >
              <span>
                {job.seasonsCompleted ?? 0} of {job.totalSeasons ?? seasonsSorted.length} seasons
              </span>
              <span>{pct}%</span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {seasonsSorted.map((s) => {
                const st = s.status
                const bg =
                  st === 'complete'
                    ? 'rgba(59, 109, 17, 0.2)'
                    : st === 'processing'
                      ? 'rgba(24, 95, 165, 0.2)'
                      : st === 'error'
                        ? 'rgba(226, 75, 74, 0.15)'
                        : 'rgba(241, 239, 232, 0.06)'
                return (
                  <div
                    key={s.season}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 10px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 500,
                      background: bg,
                      color: statusColor(st),
                      border: st === 'processing' ? '1px solid #185FA5' : '1px solid transparent',
                    }}
                  >
                    <span
                      style={
                        st === 'processing'
                          ? { display: 'inline-block', animation: 'import-season-spin 1s linear infinite' }
                          : {}
                      }
                    >
                      {statusIcon(st)}
                    </span>
                    {s.season}
                    {st === 'complete' && (s.leagueCount ?? 0) > 0 ? (
                      <span style={{ opacity: 0.6 }}>·{s.leagueCount}</span>
                    ) : null}
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
              {[
                { label: 'Leagues saved', val: job.totalLeaguesSaved ?? 0 },
                { label: 'Current level', val: job.lastRankLevel ?? '—' },
                { label: 'XP earned', val: (job.lastXpTotal ?? 0).toLocaleString() },
              ].map((row) => (
                <div
                  key={row.label}
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    borderRadius: 8,
                    padding: 12,
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <div style={{ fontSize: 20, fontWeight: 600, color: '#f8fafc' }}>{row.val}</div>
                  <div style={{ fontSize: 11, color: 'rgba(248,250,252,0.45)', marginTop: 2 }}>{row.label}</div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

type TierVisual = {
  tier: number
  name: string
  color: string
  glow: string
  badge: string
  desc: string
}

function getTierConfigByLevel(level: number): TierVisual {
  const clamped = Math.max(1, Math.min(25, level))
  const row = RANK_LEVELS.find((e) => e.level === clamped) ?? RANK_LEVELS[0]
  const glow = `${row.color}55`
  return {
    tier: row.level,
    name: row.name,
    color: row.color,
    glow,
    badge: getLevelIcon(row.tierGroup),
    desc: row.tier,
  }
}

function getTierConfig(rank: Pick<PlayerRank, 'careerTier' | 'careerTierName' | 'careerLevel' | 'careerXp'>) {
  if (rank.careerLevel >= 1 && rank.careerLevel <= 25) return getTierConfigByLevel(rank.careerLevel)
  const xp = Number(rank.careerXp) || 0
  return getTierConfigByLevel(getLevelFromXp(xp).level)
}

function CareerStats({ rank }: { rank: PlayerRank }) {
  const cfg = getTierConfig(rank)
  const wins = rank.totalWins ?? 0
  const losses = rank.totalLosses ?? 0
  const ties = rank.totalTies ?? 0
  const winRateSafe = Number.isFinite(Number(rank.winRate)) ? Number(rank.winRate) : 0
  const playoffRateSafe = Number.isFinite(Number(rank.playoffRate)) ? Number(rank.playoffRate) : 0
  const recordLabel = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`
  const stats = [
    {
      icon: <BarChart3 className="h-4 w-4 text-cyan-300/80" aria-hidden />,
      label: 'Record',
      value: wins + losses + ties > 0 ? recordLabel : 'No games yet',
      sub: 'Imported leagues (connected providers)',
    },
    {
      icon: <Percent className="h-4 w-4 text-emerald-300/80" aria-hidden />,
      label: 'Win rate',
      value: `${winRateSafe.toFixed(1)}%`,
      sub: 'Career average',
    },
    {
      icon: <Brackets className="h-4 w-4 text-violet-300/80" aria-hidden />,
      label: 'Playoffs',
      value: rank.playoffAppearances != null ? String(rank.playoffAppearances) : 'No playoff runs yet',
      sub: 'Qualified seasons',
    },
    {
      icon: <Target className="h-4 w-4 text-sky-300/80" aria-hidden />,
      label: 'Playoff rate',
      value: `${playoffRateSafe.toFixed(0)}%`,
      sub: 'Of league seasons',
    },
    {
      icon: <Trophy className="h-4 w-4 text-amber-300/80" aria-hidden />,
      label: 'Titles',
      value: rank.championshipCount > 0 ? String(rank.championshipCount) : 'No titles yet',
      sub: 'Championships',
    },
    {
      icon: <Crown className="h-4 w-4 text-amber-200/70" aria-hidden />,
      label: 'Seasons',
      value: rank.seasonsPlayed > 0 ? String(rank.seasonsPlayed) : 'First season',
      sub: 'Distinct seasons played',
    },
  ]

  return (
    <div className="rounded-2xl border border-white/8 bg-[#0d0d1f] p-5 sm:p-6">
      <p className="mb-5 text-xs font-semibold uppercase tracking-widest text-white/40">Career stats</p>
      <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2 xl:grid-cols-3 sm:gap-5">
        {stats.map((item) => (
          <div
            key={item.label}
            className="flex min-w-0 flex-col rounded-xl border border-white/6 bg-white/[0.03] px-4 py-4 sm:px-5 sm:py-5"
          >
            <div className="mb-2 flex items-center gap-2 text-white/45">
              {item.icon}
              <span className="text-[10px] font-bold uppercase tracking-wide">{item.label}</span>
            </div>
            <div
              className="text-[clamp(1.25rem,3.2vw,2rem)] font-extrabold tabular-nums leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-[clamp(1.35rem,2.8vw,2.25rem)]"
              style={{ color: cfg.color }}
            >
              {item.value}
            </div>
            <div className="mt-2 text-[11px] leading-relaxed text-white/45">{item.sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function LeagueAccessRules({ rank }: { rank: PlayerRank }) {
  const cfg = getTierConfig(rank)
  const tierUp = getTierConfigByLevel(Math.max(1, rank.careerLevel - 1))
  const tierDown = getTierConfigByLevel(Math.min(25, rank.careerLevel + 1))

  return (
    <div
      className="rounded-2xl border p-5"
      style={{ borderColor: `${cfg.color}30`, background: `radial-gradient(ellipse at top left, ${cfg.glow}, #0d0d1f)` }}
    >
      <div className="flex items-center gap-2 mb-4">
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
          style={{ background: cfg.glow, border: `1px solid ${cfg.color}` }}
        >
          🔒
        </div>
        <p className="text-xs font-bold text-white/60 uppercase tracking-widest">League Access</p>
      </div>

      <div className="space-y-2.5">
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3">
          <div className="text-[11px] font-bold text-green-400 uppercase tracking-wide mb-1.5">You Can Request to Join</div>
          <div className="flex flex-wrap gap-1.5">
            {[tierUp, cfg, tierDown].map((tier) => (
              <span
                key={tier.tier}
                className="rounded-lg px-2.5 py-1 text-xs font-semibold"
                style={{ background: tier.glow, color: tier.color, border: `1px solid ${tier.color}40` }}
              >
                {tier.badge} {tier.name}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
          <div className="text-[11px] font-bold text-cyan-400 uppercase tracking-wide mb-1">Invitations</div>
          <p className="text-xs text-white/50">
            Anyone can invite you to any tier league. Rank limits only apply when you are requesting access.
          </p>
        </div>

        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <div className="text-[11px] font-bold text-white/30 uppercase tracking-wide mb-1">Rank Up for Higher Leagues</div>
          <p className="text-xs text-white/30">
            Requests are limited to leagues within 1 tier of your current rank. Earn XP through imports, play, and results to move up.
          </p>
        </div>
      </div>
    </div>
  )
}

function ProcessingImportState() {
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-cyan-500/20 bg-gradient-to-br from-[#0a1228] to-[#07071a] p-10 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-500/35 border-t-cyan-400" />
        </div>
        <h2 className="text-xl font-black text-white">Import in progress</h2>
        <p className="mt-2 text-sm text-white/50">
          Syncing rosters and brackets from Sleeper, then calculating your rank. This page updates automatically.
        </p>
      </div>
    </div>
  )
}

function CalculatingRankState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="space-y-6" data-testid="rank-calculating-state">
      <div className="rounded-3xl border border-violet-500/20 bg-gradient-to-br from-[#0a1228] to-[#07071a] p-10 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-violet-500/35 border-t-violet-300" />
        </div>
        <h2 className="text-xl font-black text-white">Calculating your rank…</h2>
        <p className="mt-2 text-sm text-white/50">
          Your leagues are imported. We&apos;re finishing your tier and XP snapshot — this usually takes a few seconds.
        </p>
        <button
          type="button"
          onClick={() => void onRetry()}
          className="mt-6 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-white/80 hover:border-cyan-500/35 hover:text-white"
        >
          Refresh now
        </button>
      </div>
    </div>
  )
}

function RankImportTimeoutState() {
  const router = useRouter()
  return (
    <div className="space-y-6" data-testid="rank-import-timeout">
      <div className="rounded-3xl border border-amber-500/25 bg-gradient-to-br from-[#0a1228] to-[#07071a] p-10 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <p className="text-sm text-white/90">
          Import didn&apos;t complete — this can happen due to a timeout.
        </p>
        <button
          type="button"
          onClick={() => router.push('/af-rankings')}
          className="mt-6 rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:border-cyan-400/50 hover:text-white"
        >
          Try importing again
        </button>
      </div>
    </div>
  )
}

function LevelJourneyStrip({
  currentLevel,
  cardBgColor,
  variant = 'light',
}: {
  currentLevel: number
  /** Matches rank card background so ring-offset reads as part of the card (e.g. lavender tier tints). */
  cardBgColor?: string
  /** Dark = AF Rankings page (premium night theme). */
  variant?: 'light' | 'dark'
}) {
  const lv = Math.min(25, Math.max(1, Math.round(Number(currentLevel)) || 1))
  const offsetBg = (cardBgColor && cardBgColor.trim()) || (variant === 'dark' ? '#07071a' : '#f1efe8')
  const dark = variant === 'dark'

  return (
    <div className="mt-6 w-full min-w-0 overflow-visible pb-1">
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2">
        <p
          className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${dark ? 'text-white/35' : 'text-[#0a0a12]/45'}`}
        >
          Level journey
        </p>
        <p className={`text-[11px] font-bold tabular-nums ${dark ? 'text-white/55' : 'text-[#0a0a12]/80'}`}>
          You are{' '}
          <span className={dark ? 'text-cyan-200/95' : 'text-[#0a0a12]'}>Level {lv}</span>
        </p>
      </div>

      <div
        className="flex w-full min-w-0 gap-0.5 sm:gap-1"
        role="list"
        aria-label={`Levels 1 through 25, current level ${lv}`}
      >
        {RANK_LEVELS.map((row) => {
          const done = row.level < lv
          const active = row.level === lv
          return (
            <div
              key={row.level}
              role="listitem"
              title={`${row.level}. ${row.name}`}
              aria-current={active ? 'step' : undefined}
              className={`relative flex min-h-[2.35rem] min-w-0 flex-1 flex-col items-center justify-center rounded-md border text-[9px] font-extrabold leading-none transition-all duration-200 sm:min-h-[2.75rem] sm:rounded-lg sm:text-[11px] ${
                dark
                  ? active
                    ? 'z-[1] border-white/20 shadow-lg'
                    : 'border-white/[0.08]'
                  : active
                    ? 'z-[1] border-[#0a0a12]/30 shadow-lg'
                    : 'border-black/10'
              }`}
              style={
                dark
                  ? {
                      background: done
                        ? `${row.color}44`
                        : active
                          ? `${row.color}cc`
                          : 'rgba(255,255,255,0.06)',
                      color: active ? '#0a0a12' : done ? 'rgba(248,250,252,0.92)' : 'rgba(248,250,252,0.28)',
                      boxShadow: active
                        ? `0 0 0 1px ${row.color}, 0 0 0 3px ${offsetBg}, 0 0 0 4px rgba(0,0,0,0.35), 0 8px 18px -4px ${row.color}aa`
                        : undefined,
                      transform: active ? 'translateY(-2px) scale(1.07)' : undefined,
                    }
                  : {
                      background: done
                        ? `${row.color}55`
                        : active
                          ? `${row.color}dd`
                          : 'rgba(255,255,255,0.4)',
                      color: active ? '#0a0a12' : done ? 'rgba(10,10,18,0.88)' : 'rgba(10,10,18,0.3)',
                      boxShadow: active
                        ? `0 0 0 1px ${row.color}, 0 0 0 3px ${offsetBg}, 0 0 0 4px rgba(10,10,18,0.22), 0 8px 18px -4px ${row.color}99`
                        : undefined,
                      transform: active ? 'translateY(-2px) scale(1.07)' : undefined,
                    }
              }
            >
              <span className="tabular-nums">{row.level}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RankingSystemOverview() {
  const tierGroups = useMemo(() => {
    const order: string[] = []
    const map = new Map<string, (typeof RANK_LEVELS)[number][]>()
    for (const row of RANK_LEVELS) {
      if (!map.has(row.tier)) {
        order.push(row.tier)
        map.set(row.tier, [])
      }
      map.get(row.tier)!.push(row)
    }
    return { order, map }
  }, [])

  return (
    <div className="rounded-2xl border border-white/8 bg-[#0d0d1f] p-5 max-h-[min(70vh,560px)] overflow-y-auto">
      <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">The Ranking System</p>
      <div className="space-y-5">
        {tierGroups.order.map((tierName) => (
          <div key={tierName}>
            <p className="text-[11px] font-bold text-cyan-300/90 mb-2 flex items-center gap-2">
              <span>{getLevelIcon((tierGroups.map.get(tierName) ?? [])[0]?.tierGroup ?? 1)}</span>
              {tierName}
            </p>
            <ul className="space-y-1.5">
              {tierGroups.map.get(tierName)?.map((row) => (
                <li
                  key={row.level}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/6 bg-white/[0.03] px-2.5 py-1.5 text-[11px]"
                >
                  <span className="font-mono text-white/50 w-6 shrink-0">{row.level}</span>
                  <span className="flex-1 text-white/80 truncate">{row.name}</span>
                  <span className="text-[10px] text-white/35 shrink-0">{row.minXp.toLocaleString()} XP</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptyRankState({ onImported }: { onImported: () => void }) {
  return (
    <div className="space-y-6">
      <div className="relative rounded-3xl overflow-hidden border border-white/8 bg-gradient-to-br from-[#12082a] to-[#07071a] p-8 text-center">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 80%, rgba(124,58,237,0.4) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(6,182,212,0.3) 0%, transparent 50%)',
          }}
        />
        <div className="relative">
          <div className="text-6xl mb-4">🏆</div>
          <h2 className="text-2xl sm:text-3xl font-black text-white mb-2">
            Turn your fantasy history into a{' '}
            <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">Legacy Profile</span>
          </h2>
          <p className="text-white/50 text-sm max-w-md mx-auto mb-2">
            Import your career data to unlock your rank badge, AI insight, league access tier, and progression path.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <LegacyRankingsImportPanel onImportSuccess={onImported} />

        <div className="space-y-4">
          <RankingSystemOverview />
        </div>
      </div>

      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-5">
        <div className="flex items-start gap-4">
          <div className="text-3xl">🔒</div>
          <div>
            <h3 className="font-bold text-white mb-1">League Access Rules</h3>
            <p className="text-sm text-white/60">
              You can request leagues within 1 tier of your current rank. Commissioners and invite links can still bring you into any tier.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function FullRankView({
  rank,
  levelRank,
  username,
  overviewProfile,
  onReimport,
  onRecalculate,
  recalculateLoading,
}: {
  rank: PlayerRank
  levelRank: RankLevelApiPayload | null
  username: string
  overviewProfile: CompositeProfile | null
  onReimport: () => void
  onRecalculate?: () => void
  recalculateLoading?: boolean
}) {
  return (
    <div className="space-y-8">
      <AfRankingsHeroPremium rank={rank} username={username} />

      {levelRank ? (
        <div className="space-y-4">
          <RankSnapshotCardPremium payload={levelRank} />
          <LevelJourneyStrip currentLevel={levelRank.level} cardBgColor="#07071a" variant="dark" />
        </div>
      ) : null}

      <AfRankingsTierLadder currentLevel={rank.careerLevel} />

      <AfRankingsPerformanceSummary rank={rank} />

      <AfRankingsAiPanel rank={rank} />

      <AfRankingsXpBreakdown id="af-xp-breakdown" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <CareerStats rank={rank} />
          {overviewProfile ? (
            <>
              <OverviewReportCard
                profile={overviewProfile}
                tierName={rank.careerTierName}
                tierLevel={rank.careerLevel}
                careerXp={Number(rank.careerXp)}
              />
              <OverviewInsights profile={overviewProfile} lanes={overviewProfile.lanes} />
              <OverviewLanes lanes={overviewProfile.lanes} />
            </>
          ) : (
            <div className="rounded-2xl border border-white/8 bg-[#0d0d1f] p-5 text-sm text-white/60">
              Import more legacy history to unlock the AF Legacy overview cards on this page.
            </div>
          )}

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between shadow-[0_2px_8px_rgba(0,0,0,0.25)]">
            <div>
              <p className="text-sm font-semibold text-white">Refresh your legacy profile</p>
              <p className="text-xs text-white/40">
                {rank.importedAt
                  ? `Last calculated ${new Date(rank.importedAt).toLocaleString()}`
                  : 'Run another import to recalculate your rank.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              {onRecalculate ? (
                <button
                  type="button"
                  disabled={recalculateLoading}
                  onClick={onRecalculate}
                  className="rounded-xl px-4 py-2 text-xs font-bold border border-cyan-500/35 text-cyan-200 hover:border-cyan-400/50 hover:text-white transition-all disabled:opacity-40"
                  data-testid="rank-recalculate-button"
                >
                  {recalculateLoading ? 'Recalculating…' : 'Recalculate'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onReimport}
                className="rounded-xl px-4 py-2 text-xs font-bold border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-all"
              >
                Reimport
              </button>
            </div>
          </div>

          <AfRankingsHistoryPlaceholder />
          <AfRankingsLeaderboardPlaceholder />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <LeagueAccessRules rank={rank} />
          <RankingFaqPanel currentLevel={rank.careerLevel} />
        </aside>
      </div>
    </div>
  )
}

/** Immediate chrome + skeletons so the tab feels fast while `/api/user/rank` runs. */
function RankingsLoadingShell() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#07071a] to-[#0d0d1f] text-white">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="group mb-5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-white/35 transition-colors hover:text-cyan-300"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3 w-3 transition-transform group-hover:-translate-x-0.5"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Dashboard
          </Link>
          <h1 className="mt-2 text-3xl font-black text-white sm:text-4xl">AF Rankings</h1>
          <p className="mt-3 max-w-3xl text-sm text-white/65 sm:text-base">
            Your prestige tier, AI grade, XP progression, and career stats — built from real imported league history.
          </p>
        </div>

        <div className="flex flex-col items-center gap-3 pb-6 sm:flex-row sm:justify-center sm:pb-8">
          <div className="h-10 w-10 shrink-0 animate-spin rounded-full border-2 border-violet-500/40 border-t-violet-500" />
          <p className="text-sm text-white/45">Loading your rank…</p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="h-36 animate-pulse rounded-2xl border border-white/8 bg-white/[0.03]" />
            <div className="h-44 animate-pulse rounded-2xl border border-white/8 bg-white/[0.03]" />
          </div>
          <div className="space-y-4">
            <div className="h-56 animate-pulse rounded-2xl border border-white/8 bg-white/[0.03]" />
            <div className="h-36 animate-pulse rounded-2xl border border-white/8 bg-white/[0.03]" />
            <div className="h-32 animate-pulse rounded-2xl border border-white/8 bg-white/[0.03]" />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Rank hero + cards skeleton — page chrome (back link, title) is already visible above. */
function RankingsRankBlockSkeleton() {
  return (
    <>
      <div className="flex flex-col items-center gap-3 pb-6 sm:flex-row sm:justify-center sm:pb-8">
        <div className="h-10 w-10 shrink-0 animate-spin rounded-full border-2 border-violet-500/40 border-t-violet-500" />
        <p className="text-sm text-white/45">Loading your rank…</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="h-36 animate-pulse rounded-2xl border border-white/8 bg-white/[0.03]" />
          <div className="h-44 animate-pulse rounded-2xl border border-white/8 bg-white/[0.03]" />
        </div>
        <div className="space-y-4">
          <div className="h-56 animate-pulse rounded-2xl border border-white/8 bg-white/[0.03]" />
          <div className="h-36 animate-pulse rounded-2xl border border-white/8 bg-white/[0.03]" />
          <div className="h-32 animate-pulse rounded-2xl border border-white/8 bg-white/[0.03]" />
        </div>
      </div>
    </>
  )
}

function MyRankingsPageInner() {
  const { data: session } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [rank, setRank] = useState<PlayerRank | null>(null)
  const [overviewProfile, setOverviewProfile] = useState<CompositeProfile | null>(null)
  const [legacyUsername, setLegacyUsername] = useState<string | null>(null)
  const [rankBlockLoading, setRankBlockLoading] = useState(true)
  const [importProcessing, setImportProcessing] = useState(false)
  const [rankFetchError, setRankFetchError] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importBannerDismissed, setImportBannerDismissed] = useState(false)
  const [recalculateLoading, setRecalculateLoading] = useState(false)
  const [apiImported, setApiImported] = useState(false)
  const [apiTier, setApiTier] = useState<string | null>(null)
  const [levelRank, setLevelRank] = useState<RankLevelApiPayload | null>(null)
  const justImported = searchParams?.get('imported') === 'true'
  const importDone = searchParams?.get('done') === 'true'
  const jobIdParam = searchParams?.get('jobId')
  const [jobProgress, setJobProgress] = useState<ImportJobProgressResponse | null>(null)
  const [jobProgressError, setJobProgressError] = useState<string | null>(null)
  const [importPhasedSuccess, setImportPhasedSuccess] = useState<{
    totalLeagues: number
    totalSeasons: number
    finalLevel: number | null
  } | null>(null)
  const [importPhasedBannerDismissed, setImportPhasedBannerDismissed] = useState(false)
  const [showLevelUpBurst, setShowLevelUpBurst] = useState(false)
  const [importStuck, setImportStuck] = useState(false)
  const completedJobHandledRef = useRef<string | null>(null)
  const importPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const initialImportLevelRef = useRef<number | null>(null)

  const loadRank = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!silent) setRankBlockLoading(true)
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), RANK_API_TIMEOUT_MS)
    try {
      const response = await fetch('/api/user/rank', {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      })
      const data = (await response.json().catch(() => ({}))) as RankResponse
      if (response.ok) {
        setRankFetchError(false)
        setImportProcessing(data.rankProcessing === true)
        setApiImported(data.imported === true)
        setApiTier(data.tier ?? null)
        setLevelRank(rankLevelPayloadFromResponse(data))
        const displayRank = playerRankFromApiResponse(data)
        if (displayRank) {
          setRank(displayRank)
          setOverviewProfile(data.overviewProfile ?? null)
          setLegacyUsername(data.legacyUsername ?? null)
        } else {
          setRank(null)
          setOverviewProfile(null)
          setLegacyUsername(data.legacyUsername ?? null)
        }
      } else {
        setRankFetchError(true)
        setRank(null)
        setOverviewProfile(null)
        setLegacyUsername(null)
        setImportProcessing(false)
        setApiImported(false)
        setApiTier(null)
        setLevelRank(null)
      }
    } catch {
      setRankFetchError(true)
      setRank(null)
      setOverviewProfile(null)
      setLegacyUsername(null)
      setImportProcessing(false)
      setApiImported(false)
      setApiTier(null)
      setLevelRank(null)
    } finally {
      window.clearTimeout(timeoutId)
      if (!silent) setRankBlockLoading(false)
    }
  }, [])

  const handleRecalculate = useCallback(async () => {
    setRecalculateLoading(true)
    try {
      await fetch('/api/user/rank?recalculate=true', { cache: 'no-store', credentials: 'include' })
      await loadRank({ silent: true })
    } finally {
      setRecalculateLoading(false)
    }
  }, [loadRank])

  useEffect(() => {
    void loadRank()
  }, [loadRank])

  /** After client-side import, force recalculate from DB and show rank without endless polling. */
  useEffect(() => {
    if (!justImported || !importDone) return
    let cancelled = false
    ;(async () => {
      try {
        await fetch('/api/user/rank?recalculate=true', { cache: 'no-store', credentials: 'include' })
        if (cancelled) return
        await loadRank({ silent: true })
      } finally {
        if (!cancelled) {
          router.replace('/af-rankings', { scroll: false })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [justImported, importDone, loadRank, router])

  useEffect(() => {
    if (!jobIdParam) {
      setJobProgress(null)
      setJobProgressError(null)
      return
    }
    completedJobHandledRef.current = null
    initialImportLevelRef.current = null
    const jobId = jobIdParam
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch(`/api/leagues/import/progress/${encodeURIComponent(jobId)}`, {
          cache: 'no-store',
          credentials: 'include',
        })
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok) {
          if (!cancelled) {
            setJobProgressError(typeof data.error === 'string' ? data.error : 'Could not load import progress')
          }
          return
        }
        if (!cancelled) {
          setJobProgressError(null)
          setJobProgress(data as ImportJobProgressResponse)
        }
        const jp = data as ImportJobProgressResponse
        if (jp && (jp.status === 'complete' || jp.status === 'error')) {
          if (importPollRef.current) {
            clearInterval(importPollRef.current)
            importPollRef.current = null
          }
        }
      } catch {
        if (!cancelled) setJobProgressError('Could not load import progress')
      }
    }

    void poll()
    importPollRef.current = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void poll()
    }, 2500)

    return () => {
      cancelled = true
      if (importPollRef.current) {
        clearInterval(importPollRef.current)
        importPollRef.current = null
      }
    }
  }, [jobIdParam])

  useEffect(() => {
    if (!jobIdParam || !jobProgress) return
    if (jobProgress.status !== 'complete') return
    if (completedJobHandledRef.current === jobIdParam) return
    completedJobHandledRef.current = jobIdParam
    const finalLv = jobProgress.lastRankLevel ?? null
    setImportPhasedSuccess({
      totalLeagues: jobProgress.totalLeaguesSaved ?? 0,
      totalSeasons: jobProgress.totalSeasons ?? 0,
      finalLevel: finalLv,
    })
    router.replace('/af-rankings', { scroll: false })
    window.setTimeout(() => {
      void loadRank({ silent: false })
      if (
        initialImportLevelRef.current != null &&
        finalLv != null &&
        finalLv > initialImportLevelRef.current
      ) {
        setShowLevelUpBurst(true)
        window.setTimeout(() => setShowLevelUpBurst(false), 2200)
      }
    }, 1500)
  }, [jobIdParam, jobProgress, loadRank, router])

  useEffect(() => {
    if (!jobIdParam) return
    if (levelRank && initialImportLevelRef.current === null) {
      initialImportLevelRef.current = levelRank.level
    }
  }, [jobIdParam, levelRank])

  useEffect(() => {
    if (!justImported) return
    if (!importProcessing) return
    const id = window.setInterval(() => void loadRank({ silent: true }), 5000)
    return () => window.clearInterval(id)
  }, [justImported, importProcessing, loadRank])

  useEffect(() => {
    const waitingForTier = !rank && apiImported && !apiTier && !rankFetchError
    if (!waitingForTier) {
      setImportStuck(false)
      return
    }
    setImportStuck(false)
    const timeoutId = window.setTimeout(() => setImportStuck(true), 45000)
    return () => window.clearTimeout(timeoutId)
  }, [rank, apiImported, apiTier, rankFetchError])

  /** Tier pending after import: poll /api/user/rank (max 10 tries, 3s apart). */
  useEffect(() => {
    if (rank) return
    if (!apiImported || apiTier) return
    if (rankFetchError) return
    let tries = 0
    const id = window.setInterval(() => {
      tries += 1
      void loadRank({ silent: true })
      if (tries >= 10) window.clearInterval(id)
    }, 3000)
    return () => window.clearInterval(id)
  }, [rank, apiImported, apiTier, rankFetchError, loadRank])

  const username =
    legacyUsername ||
    session?.user?.username ||
    session?.user?.name ||
    'Manager'

  const hideRankForPhasedImport = Boolean(jobIdParam) && jobProgress?.status !== 'complete' && !jobProgressError

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#07071a] to-[#0d0d1f] text-white">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        {justImported && !importBannerDismissed ? (
          <div
            className={`mb-6 flex flex-col gap-2 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
              rankFetchError
                ? 'border-amber-500/35 bg-amber-500/10'
                : importProcessing
                  ? 'border-cyan-500/35 bg-cyan-500/10'
                  : rank
                    ? 'border-emerald-500/30 bg-emerald-500/10'
                    : 'border-white/15 bg-white/[0.04]'
            }`}
          >
            <div className="flex items-start gap-3">
              {importProcessing && !rankFetchError ? (
                <div className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-300" />
              ) : null}
              <p
                className={`text-sm font-semibold ${
                  rankFetchError
                    ? 'text-amber-100'
                    : importProcessing
                      ? 'text-cyan-100'
                      : rank
                        ? 'text-emerald-100'
                        : 'text-white/70'
                }`}
              >
                {rankFetchError
                  ? 'Could not load your rank (server error). Try refreshing the page or try again in a moment.'
                  : importProcessing
                    ? 'Import in progress — syncing Sleeper history and calculating your rank…'
                    : rank
                      ? 'Import complete! Your rank has been calculated.'
                      : 'Import finished — rank data is still updating. This page refreshes automatically.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setImportBannerDismissed(true)
                router.replace('/af-rankings', { scroll: false })
              }}
              className={`shrink-0 text-xs font-semibold underline-offset-2 hover:underline ${
                rankFetchError
                  ? 'text-amber-200/80 hover:text-amber-50'
                  : importProcessing
                    ? 'text-cyan-200/80 hover:text-cyan-50'
                    : rank
                      ? 'text-emerald-200/80 hover:text-emerald-50'
                      : 'text-white/40 hover:text-white/70'
              }`}
            >
              Dismiss
            </button>
          </div>
        ) : null}
        {importPhasedSuccess && !importPhasedBannerDismissed ? (
          <div className="mb-6 flex flex-col gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-emerald-100">
              Import complete! {importPhasedSuccess.totalLeagues} leagues across {importPhasedSuccess.totalSeasons}{' '}
              seasons
              {importPhasedSuccess.finalLevel != null ? (
                <span className="text-emerald-200/90"> — Level {importPhasedSuccess.finalLevel}</span>
              ) : null}
            </p>
            <button
              type="button"
              onClick={() => setImportPhasedBannerDismissed(true)}
              className="shrink-0 text-xs font-semibold text-emerald-200/80 underline-offset-2 hover:underline"
            >
              Dismiss
            </button>
          </div>
        ) : null}
        {showLevelUpBurst ? (
          <div
            className="pointer-events-none fixed inset-x-0 top-24 z-[60] flex justify-center"
            aria-live="polite"
          >
            <div className="animate-bounce rounded-2xl border border-amber-400/40 bg-amber-500/20 px-6 py-3 text-lg font-black text-amber-100 shadow-lg shadow-amber-500/20">
              Level up!
            </div>
          </div>
        ) : null}
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="group mb-5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-white/35 transition-colors hover:text-cyan-300"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3 w-3 transition-transform group-hover:-translate-x-0.5"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Dashboard
          </Link>
          <h1 className="mt-2 text-3xl font-black text-white sm:text-4xl">AF Rankings</h1>
          <p className="mt-3 max-w-3xl text-sm text-white/65 sm:text-base">
            Your prestige tier, AI grade, XP progression, and career stats — built from real imported league history.
          </p>
        </div>

        {jobIdParam && jobProgress?.status !== 'complete' ? (
          <ImportProgressPanel
            job={jobProgress}
            loading={jobProgress == null && !jobProgressError}
            error={jobProgressError}
          />
        ) : null}

        {hideRankForPhasedImport ? null : rankBlockLoading && !rank && !rankFetchError ? (
          <RankingsRankBlockSkeleton />
        ) : showImport ? (
          <EmptyRankState
            onImported={() => {
              setShowImport(false)
              void loadRank()
            }}
          />
        ) : rank ? (
          <FullRankView
            rank={rank}
            levelRank={levelRank}
            username={username}
            overviewProfile={overviewProfile}
            onReimport={() => setShowImport(true)}
            onRecalculate={handleRecalculate}
            recalculateLoading={recalculateLoading}
          />
        ) : !rank && importProcessing && justImported && !rankFetchError ? (
          <ProcessingImportState />
        ) : apiImported && !apiTier && !rankFetchError ? (
          importStuck ? (
            <RankImportTimeoutState />
          ) : (
            <CalculatingRankState
              onRetry={() => {
                setImportStuck(false)
                void loadRank({ silent: true })
              }}
            />
          )
        ) : !apiImported ? (
          <EmptyRankState
            onImported={() => {
              setShowImport(false)
              void loadRank()
            }}
          />
        ) : (
          <EmptyRankState
            onImported={() => {
              setShowImport(false)
              void loadRank()
            }}
          />
        )}
      </div>
    </div>
  )
}

export default function MyRankingsPage() {
  return (
    <Suspense fallback={<RankingsLoadingShell />}>
      <MyRankingsPageInner />
    </Suspense>
  )
}

