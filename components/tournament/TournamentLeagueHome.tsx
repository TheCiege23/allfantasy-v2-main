'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Trophy, ExternalLink } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { KingBuffaloPresentedBy } from '@/components/tournament/KingBuffaloPresentedBy'

interface TournamentTheme {
  bannerUrl: string | null
  themePack: string
  accentColor: string | null
  glowAccent: string | null
  badgeStyle: string | null
}

interface TournamentConfig {
  tournamentId: string
  tournamentName: string
  conferenceName: string
  conferenceTheme: string
  roundIndex: number
  phase: string
  roundRules?: { benchSpots: number; faabReset: boolean; faabBudget: number }
  theme?: TournamentTheme | null
}

export function TournamentLeagueHome({ leagueId }: { leagueId: string }) {
  const { t, tInterpolate } = useLanguage()
  const [config, setConfig] = useState<TournamentConfig | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/tournament-context`, { cache: 'no-store' })
        if (!active) return
        const data = await res.json().catch(() => ({}))
        const t = data.tournament
        if (t?.tournamentId && t?.tournamentName) {
          setConfig({
            tournamentId: t.tournamentId,
            tournamentName: t.tournamentName,
            conferenceName: t.conferenceName ?? '—',
            conferenceTheme: t.conferenceTheme ?? 'black',
            roundIndex: typeof t.roundIndex === 'number' ? t.roundIndex : 0,
            phase: t.phase ?? 'qualification',
            roundRules: t.roundRules,
            theme: t.theme ?? null,
          })
        } else {
          setConfig(null)
        }
      } catch {
        if (active) setConfig(null)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [leagueId])

  if (loading || !config) return null

  const accentColor = config.theme?.accentColor ?? undefined
  const hasBanner = Boolean(config.theme?.bannerUrl)

  return (
    <div
      className="mb-4 overflow-hidden rounded-xl border border-amber-500/20 bg-amber-950/10 p-4"
      style={accentColor ? { borderColor: `${accentColor}40`, boxShadow: config.theme?.glowAccent ? `0 0 20px ${config.theme.glowAccent}20` : undefined } : undefined}
    >
      <div className="mb-3">
        <KingBuffaloPresentedBy variant="compact" />
      </div>
      {hasBanner && config.theme?.bannerUrl && (
        <div
          className="mb-3 h-20 w-full rounded-lg bg-cover bg-center"
          style={{ backgroundImage: `url(${config.theme.bannerUrl})` }}
          role="img"
          aria-label={t('tournament.leagueHome.bannerAria')}
        />
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-amber-500/20 px-2 py-0.5 font-medium text-amber-200">{t('tournament.leagueHome.badge')}</span>
        <span className="rounded bg-white/10 px-2 py-0.5 text-white/80">{config.conferenceName}</span>
        <span className="rounded bg-white/10 px-2 py-0.5 text-white/70">
          {tInterpolate('tournament.leagueHome.phaseRound', {
            phase: config.phase,
            round: String(config.roundIndex),
          })}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-950/30"
            style={accentColor ? { borderColor: `${accentColor}50` } : undefined}
          >
            <Trophy className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-amber-200">{config.tournamentName}</p>
            <p className="text-xs text-white/60">
              {tInterpolate('tournament.leagueHome.subtitle', {
                conference: config.conferenceName,
                phase: config.phase,
                round: String(config.roundIndex),
              })}
            </p>
          </div>
        </div>
        <Link
          href={`/tournament/${config.tournamentId}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-950/20 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-950/40"
        >
          {t('tournament.leagueHome.hubLink')} <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
      {config.roundRules && (
        <p className="mt-2 text-xs text-white/60">
          {tInterpolate('tournament.leagueHome.roundRules', {
            bench: String(config.roundRules.benchSpots),
            faab: config.roundRules.faabReset
              ? tInterpolate('tournament.leagueHome.roundRulesFaab', {
                  budget: String(config.roundRules.faabBudget),
                })
              : '',
          })}
        </p>
      )}
    </div>
  )
}
