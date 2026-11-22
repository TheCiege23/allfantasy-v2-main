'use client'

/**
 * "Renew league" entry for commissioners when the season is over (all sports).
 * Tournament feeder leagues link to the tournament hub — renewal is coordinated there.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { LeagueLifecycleState } from '@prisma/client'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { RenewLeagueModal } from '@/components/league-settings/RenewLeagueModal'
import { isSeasonOverForRenewal } from '@/lib/leagues/renewalPolicy'
import { isImportedPlatform } from '@/lib/league/isNativeLeague'

interface Props {
  leagueId: string
  currentSeason: number
  isCommissioner: boolean
  leagueStatus?: string
  /** Merged from settings (dynasty / generic season phase) */
  seasonPhase?: string
  lifecycleState?: LeagueLifecycleState | string | null
  /**
   * 🛑 AN IMPORTED LEAGUE IS RENEWED ON ITS PLATFORM, NEVER HERE. This banner showed to every
   * commissioner whose season was over, and renewing an imported Sleeper league moved the row to next
   * season while it still pointed at last season's Sleeper league — after which every sync refused it
   * for a season mismatch. Sleeper renewals are now followed automatically (followRenewedLeagues.ts).
   */
  platform?: string | null
}

export function RenewLeagueBanner({
  leagueId,
  currentSeason,
  isCommissioner,
  leagueStatus,
  seasonPhase,
  lifecycleState,
  platform,
}: Props) {
  const { t } = useLanguage()
  const [showModal, setShowModal] = useState(false)
  const [renewed, setRenewed] = useState(false)
  const [tournamentHubPath, setTournamentHubPath] = useState<string | null>(null)
  const [nextSeasonFromApi, setNextSeasonFromApi] = useState(currentSeason + 1)

  const nextSeason = nextSeasonFromApi

  const imported = isImportedPlatform(platform)
  const isSeasonOver = !imported && isSeasonOverForRenewal({
    status: leagueStatus,
    dynastySeasonPhase: seasonPhase,
    seasonPhase,
    lifecycleState,
  })

  useEffect(() => {
    if (!isSeasonOver || !isCommissioner) return
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/renew`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.renewalCompleted) setRenewed(true)
        if (data.tournamentFeeder?.renewFromHubPath) {
          setTournamentHubPath(String(data.tournamentFeeder.renewFromHubPath))
        }
        if (typeof data.nextSeason === 'number' && Number.isFinite(data.nextSeason)) {
          setNextSeasonFromApi(data.nextSeason)
        }
      })
      .catch(() => {})
  }, [leagueId, isSeasonOver, isCommissioner])

  const handleRenewed = useCallback(() => {
    setRenewed(true)
    setShowModal(false)
  }, [])

  if (!isSeasonOver || !isCommissioner || renewed) return null

  if (tournamentHubPath) {
    return (
      <div className="shrink-0 px-4 py-3">
        <Link
          href={tournamentHubPath}
          className="mx-auto flex w-full max-w-md items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-8 py-3.5 text-[14px] font-bold uppercase tracking-wider text-[var(--badge-text-cyan)] shadow-lg shadow-cyan-900/20 transition hover:border-cyan-400/60 hover:bg-cyan-500/15"
        >
          {t('renew.tournamentHubCta').replace('{{year}}', String(nextSeason))}
        </Link>
        <p className="mx-auto mt-2 max-w-md text-center text-[11px] text-white/40">{t('renew.tournamentHubHint')}</p>
      </div>
    )
  }

  return (
    <>
      <div className="shrink-0 px-4 py-3">
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="mx-auto flex w-full max-w-md items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-8 py-3.5 text-[14px] font-bold uppercase tracking-wider text-white shadow-lg shadow-cyan-500/25 transition hover:from-cyan-400 hover:to-emerald-400 hover:shadow-cyan-500/35 active:scale-[0.98]"
        >
          {t('renew.buttonLabel').replace('{{year}}', String(nextSeason))}
        </button>
      </div>

      <RenewLeagueModal
        leagueId={leagueId}
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onRenewed={handleRenewed}
      />
    </>
  )
}
