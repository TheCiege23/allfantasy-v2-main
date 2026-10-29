'use client'

/**
 * Devy Dynasty league Overview home. PROMPT 2/6 + 3/6.
 * Fetches summary from /api/leagues/[leagueId]/devy/summary; promotion panel and commissioner tools.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { DevyPromotionPanel } from './DevyPromotionPanel'
import { DevyCommissionerTools } from './DevyCommissionerTools'
import { DevyDraftCenter } from './DevyDraftCenter'
import { DevyLeagueHomeCards } from './DevyLeagueHomeCards'
import { SpecialtyShell } from '@/components/league/specialty/SpecialtyShell'
import { DevySpecialtyHome, type DevyHomeBlock } from '@/components/league/specialty/devy/DevySpecialtyHome'
import { DevyPromotionMoment } from '@/components/league/specialty/devy/DevyPromotionMoment'
import type { DevyStashItem } from '@/lib/devy/devyHomeView'

interface DevySummary {
  leagueId: string
  sport: string
  sportAdapterId: string | null
  config: {
    devySlotCount: number
    taxiSize: number
    rookieDraftRounds: number
    devyDraftRounds: number
    startupVetRounds?: number | null
    bestBallEnabled: boolean
    startupDraftType: string
    rookieDraftType: string
    devyDraftType: string
  }
  draftPhase: string | null
  draftPhaseInfo: { phase: string; status: string; description: string } | null
  sessionId: string | null
  promotionEligibleCount?: number
  /** Specialty home blocks (absent on older responses). */
  league?: DevyHomeBlock['league']
  my?: DevyHomeBlock['my']
  feed?: DevyHomeBlock['feed']
}

interface DevyHomeProps {
  leagueId: string
  isCommissioner?: boolean
  rosterId?: string
}

export function DevyHome({ leagueId, isCommissioner, rosterId }: DevyHomeProps) {
  const [summary, setSummary] = useState<DevySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [promoting, setPromoting] = useState<DevyStashItem | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    async function fetchSummary() {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/devy/summary`, { cache: 'no-store' })
        if (!active) return
        if (!res.ok) {
          setError(res.status === 404 ? 'Not a devy league' : 'Failed to load')
          setLoading(false)
          return
        }
        const data = await res.json()
        setSummary(data)
      } catch {
        if (active) {
          setError('Failed to load')
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    fetchSummary()
    return () => { active = false }
  }, [leagueId, reloadKey])

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-white/10 bg-white/5 p-6">
        <span className="text-sm text-white/60">Loading devy league…</span>
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

  const { config, draftPhase, draftPhaseInfo, sport } = summary
  const adapterLabel = summary.sportAdapterId === 'nfl_devy' ? 'NCAA Football' : summary.sportAdapterId === 'nba_devy' ? 'NCAA Basketball' : 'Devy'

  const home: DevyHomeBlock = { league: summary.league ?? null, my: summary.my ?? null, feed: summary.feed ?? [] }
  const devySlots = { used: home.my?.stash.length ?? 0, total: config.devySlotCount }
  const proRoster = { used: home.my?.proRosterCount ?? 0, total: home.league?.rosterSize ?? null }

  if (promoting) {
    return (
      <SpecialtyShell format="devy" testId="devy-specialty">
        <DevyPromotionMoment
          leagueId={leagueId}
          item={promoting}
          devySlots={devySlots}
          proRoster={proRoster}
          onBack={() => setPromoting(null)}
          onPromoted={() => setReloadKey((k) => k + 1)}
        />
      </SpecialtyShell>
    )
  }

  return (
    <SpecialtyShell format="devy" testId="devy-specialty">
    <div className="space-y-4">
      <DevySpecialtyHome
        leagueId={leagueId}
        sport={sport}
        config={config}
        home={home}
        onOpenPromotion={setPromoting}
        draftHref={`/league/${leagueId}?tab=Draft`}
      />
      <p className="text-xs text-white/50">
        {adapterLabel} devy pool · {config.devyDraftRounds} devy rounds · {config.rookieDraftRounds} rookie rounds
        {config.bestBallEnabled ? ' · Best ball on: your highest-scoring legal lineup counts each week.' : ''}
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

      <DevyDraftCenter
        leagueId={leagueId}
        startupRounds={summary.config.startupVetRounds ?? undefined}
        rookieRounds={summary.config.rookieDraftRounds}
        devyRounds={summary.config.devyDraftRounds}
        startupType={summary.config.startupDraftType}
        rookieType={summary.config.rookieDraftType}
        devyType={summary.config.devyDraftType}
        devySlotsUsed={0}
        devySlotCount={summary.config.devySlotCount}
        bestBallEnabled={summary.config.bestBallEnabled}
      />

      <DevyLeagueHomeCards
        leagueId={leagueId}
        promotionEligibleCount={summary.promotionEligibleCount ?? 0}
      />

      <DevyPromotionPanel leagueId={leagueId} rosterId={rosterId} isCommissioner={isCommissioner} />

      {isCommissioner && <DevyCommissionerTools leagueId={leagueId} />}

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
