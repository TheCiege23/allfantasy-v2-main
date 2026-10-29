'use client'

/**
 * Merged Devy / C2C (Campus to Canton) league Overview home. PROMPT 2/6.
 * Fetches summary from /api/leagues/[leagueId]/merged-devy-c2c/summary.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MergedDevyC2CCommissionerSettings } from './MergedDevyC2CCommissionerSettings'
import { C2CPromotionPanel } from './C2CPromotionPanel'
import { C2CCommissionerTools } from './C2CCommissionerTools'
import { C2CDraftCenter } from './C2CDraftCenter'
import { C2CBoard } from './C2CBoard'
import { SpecialtyShell } from '@/components/league/specialty/SpecialtyShell'
import { C2CSpecialtyHome, type C2CHomeBlock } from '@/components/league/specialty/c2c/C2CSpecialtyHome'

interface C2CSummary {
  leagueId: string
  sport: string
  sportAdapterId: string | null
  config: {
    startupFormat: string
    mergedStartupDraft: boolean
    separateStartupCollegeDraft: boolean
    collegeRosterSize: number
    collegeActiveLineupSlots: Record<string, number>
    taxiSize: number
    rookieDraftRounds: number
    collegeDraftRounds: number
    bestBallPro: boolean
    bestBallCollege: boolean
    standingsModel: string
    mergedRookieCollegeDraft: boolean
    startupDraftType: string
    rookieDraftType: string
    collegeDraftType: string
  }
  draftPhase: string | null
  draftPhaseInfo: { phase: string; status: string; description: string } | null
  sessionId: string | null
  /** Specialty home blocks (absent on older responses). */
  league?: C2CHomeBlock['league']
  my?: C2CHomeBlock['my']
  feed?: C2CHomeBlock['feed']
}

interface MergedDevyC2CHomeProps {
  leagueId: string
  isCommissioner?: boolean
  rosterId?: string
}

export function MergedDevyC2CHome({ leagueId, isCommissioner }: MergedDevyC2CHomeProps) {
  const [summary, setSummary] = useState<C2CSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function fetchSummary() {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/merged-devy-c2c/summary`, { cache: 'no-store' })
        if (!active) return
        if (!res.ok) {
          setError(res.status === 404 ? 'Not a C2C league' : 'Failed to load')
          setLoading(false)
          return
        }
        const data = await res.json()
        setSummary(data)
      } catch {
        if (active) setError('Failed to load')
      } finally {
        if (active) setLoading(false)
      }
    }
    fetchSummary()
    return () => { active = false }
  }, [leagueId])

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-white/10 bg-white/5 p-6">
        <span className="text-sm text-white/60">Loading C2C league…</span>
      </div>
    )
  }

  if (error || !summary) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
        {error ?? 'Summary not available'}
      </div>
    )
  }

  const { config, draftPhaseInfo, sport } = summary
  const adapterLabel = summary.sportAdapterId === 'nfl_c2c' ? 'NCAA Football' : summary.sportAdapterId === 'nba_c2c' ? 'NCAA Basketball' : 'College'

  const home: C2CHomeBlock = { league: summary.league ?? null, my: summary.my ?? null, feed: summary.feed ?? [] }

  return (
    <SpecialtyShell format="c2c" testId="c2c-specialty">
    <div className="space-y-4">
      <C2CSpecialtyHome
        sport={sport}
        standingsModel={config.standingsModel}
        mergedStartupDraft={config.mergedStartupDraft}
        home={home}
        lineupHref={`/league/${leagueId}?tab=Roster`}
        draftHref={`/league/${leagueId}?tab=Draft`}
      />
      <p className="text-xs text-white/50">
        {adapterLabel} college roster {config.collegeRosterSize} · taxi {config.taxiSize} · {config.rookieDraftRounds} rookie rounds · {config.collegeDraftRounds} college rounds
        {config.bestBallPro ? ' · best ball (pro)' : ''}
        {config.bestBallCollege ? ' · best ball (college)' : ''}. College assets score only in college contests until promotion.
      </p>

      {draftPhaseInfo && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-sm font-medium text-white">Draft</h3>
          <p className="mt-1 text-sm text-white/70">{draftPhaseInfo.description}</p>
          <p className="mt-1 text-xs text-white/50">Status: {draftPhaseInfo.status}</p>
          <Link
            href={`/league/${leagueId}?tab=Draft`}
            className="mt-3 inline-block rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/15"
          >
            Go to Draft
          </Link>
        </div>
      )}

      <C2CDraftCenter
        leagueId={leagueId}
        mergedStartupDraft={config.mergedStartupDraft}
        separateStartupCollegeDraft={config.separateStartupCollegeDraft}
        mergedRookieCollegeDraft={config.mergedRookieCollegeDraft}
      />

      <C2CBoard leagueId={leagueId} sport={sport} />

      <Link
        href={`/league/${leagueId}?tab=Roster`}
        className="block rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80 hover:bg-white/10"
      >
        Pro &amp; college roster
      </Link>

      <C2CPromotionPanel leagueId={leagueId} isCommissioner={isCommissioner} />

      {config.standingsModel !== 'unified' && (
        <Link
          href={`/league/${leagueId}?tab=Standings%20%2F%20Playoffs`}
          className="block rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80 hover:bg-white/10"
        >
          {config.standingsModel === 'hybrid' ? 'Hybrid standings' : 'College & pro standings'}
        </Link>
      )}

      {isCommissioner && <MergedDevyC2CCommissionerSettings leagueId={leagueId} />}

      {isCommissioner && <C2CCommissionerTools leagueId={leagueId} />}

      <Link
        href={`/league/${leagueId}?tab=Settings`}
        className="block rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80 hover:bg-white/10"
      >
        League settings
      </Link>
    </div>
    </SpecialtyShell>
  )
}
