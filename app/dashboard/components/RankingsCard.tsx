'use client'

import Link from 'next/link'
import { ArrowRight, BarChart3, Brackets, CalendarDays, Crown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { RANK_LEVELS, getLevelFromXp, getLevelIcon } from '@/lib/rank/levels'
import { getTierTheme } from '@/lib/rank/tier-theme'
import { getChimmyChatHrefWithPrompt } from '@/lib/ai-product-layer/UnifiedChimmyEntryResolver'
import {
  AIGradeRing,
  RankingStatMiniCard,
  RankInsightBanner,
  RankMovementChip,
  RankPrestigeEmblem,
  RankingsCtaRow,
  XpProgressPremium,
} from '@/components/rankings/af-rankings-ui/AfRankingsUiKit'

type RankApiPayload = {
  imported: boolean
  level?: number | null
  levelName?: string | null
  tier?: string | null
  tierGroup?: number | null
  color?: string | null
  bgColor?: string | null
  xpTotal?: number | null
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
  rankCalculatedAt?: string | null
  rank?: {
    careerXp: string
    aiReportGrade: string | null
    aiScore: number | null
    aiInsight?: string
    careerTierName: string
    careerLevel: number
    totalWins?: number | null
    totalLosses?: number | null
    totalTies?: number | null
  } | null
}

type RankingsCardProps = {
  onAskChimmy?: () => void
  rankRefreshKey?: number
  onImportNow?: () => void
  /** From dashboard RSC — skip initial loading skeleton when present. */
  initialRankPayload?: Record<string, unknown> | null
}

export function RankingsCard({
  onAskChimmy,
  rankRefreshKey = 0,
  onImportNow,
  initialRankPayload = null,
}: RankingsCardProps) {
  const { t } = useLanguage()
  const [data, setData] = useState<RankApiPayload | null>(() =>
    initialRankPayload != null ? (initialRankPayload as RankApiPayload) : null,
  )
  const [loading, setLoading] = useState(() => initialRankPayload == null)

  useEffect(() => {
    if (rankRefreshKey === 0 && initialRankPayload != null) {
      setData(initialRankPayload as RankApiPayload)
      setLoading(false)
      return
    }
    setLoading(true)
    fetch('/api/user/rank', { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: RankApiPayload) => setData(d))
      .catch(() => setData({ imported: false }))
      .finally(() => setLoading(false))
  }, [rankRefreshKey, initialRankPayload])

  if (loading) {
    return (
      <div
        className="h-64 animate-pulse rounded-2xl border border-cyan-500/15 bg-gradient-to-br from-[#0a1228]/80 to-[#070a14]"
        data-testid="dashboard-rankings-card-skeleton"
      />
    )
  }

  if (!data?.imported || (!data.rank && data.xpTotal == null)) {
    return (
      <div className="rounded-2xl border border-white/8 border-l-2 border-l-cyan-500 bg-[#0c0c1e] p-5">
        <div className="text-2xl">🏆</div>
        <p className="mt-3 text-sm font-semibold text-white">{t('dashboard.rankings.emptyTitle')}</p>
        <p className="mt-1 text-xs text-white/40">{t('dashboard.rankings.emptyBody')}</p>
        {onImportNow ? (
          <button
            type="button"
            onClick={onImportNow}
            className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-cyan-300 transition-colors hover:text-cyan-200"
          >
            {t('dashboard.rankings.importNow')} <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <Link
            href="/import"
            className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-cyan-300 transition-colors hover:text-cyan-200"
          >
            {t('dashboard.rankings.importNow')} <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    )
  }

  const xpTotal = data.xpTotal ?? Number(data.rank?.careerXp ?? 0)
  const lv = getLevelFromXp(xpTotal)
  const level = data.level ?? lv.level
  const levelName = data.levelName ?? lv.name
  const xpIntoLevel = data.xpIntoLevel ?? lv.xpIntoLevel
  const xpForLevel = data.xpForLevel ?? lv.xpForLevel
  const progressPct = data.progressPct ?? lv.progressPct
  const nextLevelName = data.nextLevelName ?? lv.nextLevel?.name ?? null
  const rawTg = data.tierGroup
  const tierGroup =
    typeof rawTg === 'number' && Number.isFinite(rawTg)
      ? rawTg
      : Number(rawTg) || lv.tierGroup
  const theme = getTierTheme(tierGroup)
  const emoji = getLevelIcon(tierGroup)

  const wins = data.careerWins ?? data.rank?.totalWins ?? 0
  const losses = data.careerLosses ?? data.rank?.totalLosses ?? 0
  const ties = data.rank?.totalTies ?? 0
  const games = wins + losses + ties
  const recordStr =
    games > 0 ? `${wins}-${losses}${ties > 0 ? `-${ties}` : ''}` : t('dashboard.rankings.emptyRecord')
  const championships = data.careerChampionships ?? 0
  const seasons = data.careerSeasonsPlayed ?? 0
  const playoffApps = data.careerPlayoffAppearances ?? 0

  const aiGrade = data.rank?.aiReportGrade ?? '—'
  const aiScore = data.rank?.aiScore ?? null
  const insight = data.rank?.aiInsight?.trim() ?? ''

  const nextRow = RANK_LEVELS.find((r) => r.level === level + 1)
  const xpToNext = nextRow ? Math.max(0, nextRow.minXp - xpTotal) : 0

  const chimmyWhyHref = getChimmyChatHrefWithPrompt(
    `Explain my AF rank (level ${level}, ${levelName}) and Chimmy grade ${aiGrade} using only my imported stats.`,
    { source: 'dashboard_rankings' },
  )

  return (
    <section data-testid="dashboard-rankings-card">
      <div
        className={`relative overflow-hidden rounded-2xl border p-5 shadow-[0_0_40px_rgba(0,0,0,0.35)] sm:p-6 ${theme.shimmerClass ?? ''}`}
        style={{
          borderColor: `${theme.borderGlow}`,
          background: `linear-gradient(155deg, #0a1020 0%, #070a12 50%, ${theme.chipBg})`,
          boxShadow: `0 0 32px ${theme.glow}`,
        }}
      >
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-25 blur-3xl"
          style={{ background: theme.glow }}
        />

        {/* Top bar */}
        <div className="relative mb-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">
              {t('dashboard.rankings.myRanking')}
            </p>
            <RankMovementChip movement={null} />
          </div>
          <div className="flex items-center gap-2">
            {onAskChimmy ? (
              <button
                type="button"
                onClick={onAskChimmy}
                className="text-[11px] font-bold text-cyan-300 transition hover:text-cyan-200"
                data-testid="dashboard-rankings-ask-chimmy-header"
              >
                {t('dashboard.rankings.askChimmy')}
              </button>
            ) : null}
          </div>
        </div>

        {/* Main: emblem + rank + AI ring */}
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-1 items-start gap-4">
            <RankPrestigeEmblem theme={theme} level={level} emoji={emoji} />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: theme.accent }}>
                {data.tier ?? lv.tier}
              </p>
              <p className="mt-0.5 text-4xl font-black tabular-nums leading-none text-white">{level}</p>
              <p className="mt-1 text-sm font-bold text-white/90">{levelName}</p>
              <p className="mt-1 text-[11px] text-white/40">{t('dashboard.rankings.tierSubtitle')}</p>
            </div>
          </div>
          <div className="flex justify-center sm:justify-end">
            <AIGradeRing grade={aiGrade} score={aiScore} theme={theme} compact />
          </div>
        </div>

        {insight ? (
          <div className="relative mt-4">
            <RankInsightBanner text={insight} />
          </div>
        ) : null}

        <div className="relative mt-5 border-t border-white/[0.08] pt-4">
          <XpProgressPremium
            xpIntoLevel={xpIntoLevel}
            xpForLevel={xpForLevel}
            progressPct={progressPct}
            xpTotal={xpTotal}
            nextLevelName={nextLevelName}
            xpToNext={xpToNext}
            theme={theme}
            helperText={t('dashboard.rankings.xpHelper')}
          />
        </div>

        <div className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <RankingStatMiniCard
            icon={<BarChart3 className="h-3.5 w-3.5" />}
            label={t('dashboard.rankings.stat.record')}
            value={games > 0 ? recordStr : t('dashboard.rankings.stat.noGames')}
          />
          <RankingStatMiniCard
            icon={<Crown className="h-3.5 w-3.5" />}
            label={t('dashboard.rankings.stat.titles')}
            value={championships > 0 ? String(championships) : t('dashboard.rankings.stat.noTitles')}
          />
          <RankingStatMiniCard
            icon={<Brackets className="h-3.5 w-3.5" />}
            label={t('dashboard.rankings.stat.playoffs')}
            value={playoffApps > 0 ? String(playoffApps) : t('dashboard.rankings.stat.noPlayoffs')}
          />
          <RankingStatMiniCard
            icon={<CalendarDays className="h-3.5 w-3.5" />}
            label={t('dashboard.rankings.stat.seasons')}
            value={seasons > 0 ? String(seasons) : t('dashboard.rankings.stat.firstSeason')}
          />
        </div>

        {data.rankCalculatedAt ? (
          <p className="relative mt-3 text-[10px] text-white/30">
            {t('dashboard.rankings.updated')}{' '}
            {new Date(data.rankCalculatedAt).toLocaleString()}
          </p>
        ) : null}

        <div className="relative mt-4">
          <RankingsCtaRow
            fullRankingsHref="/af-rankings"
            viewFullLabel={t('dashboard.rankings.viewFull')}
            chimmyWhyLabel={t('dashboard.rankings.chimmyWhy')}
            xpExplainerLabel={t('dashboard.rankings.howXp')}
            onAskChimmy={onAskChimmy}
            chimmyHref={chimmyWhyHref}
            xpExplainerHref="/af-rankings#af-xp-breakdown"
          />
        </div>
      </div>
    </section>
  )
}
