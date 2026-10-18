'use client'

import Link from 'next/link'
import { Users } from 'lucide-react'
import type { SurvivorSummary } from './types'
import { SurvivorShareCard } from './SurvivorShareCard'
import { JuryFinale } from './late/JuryFinale'
import { TribeBuff } from './late/TribeBuff'

export interface SurvivorMergeJuryViewProps {
  leagueId: string
  summary: SurvivorSummary
  names: Record<string, string>
  onRefresh?: () => Promise<void> | void
}

/**
 * Merge / Jury View: merge status, then Final Tribal Council (jury bench, finalist records,
 * sealed jury vote and the reveal). The jury tally is never shown here before the vote is
 * complete — JuryFinale reads a server view that withholds it.
 */
export function SurvivorMergeJuryView({ leagueId, summary, names }: SurvivorMergeJuryViewProps) {
  const { merged, config, finale } = summary
  const mergeWeek = config.mergeWeek ?? 0

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Users className="h-5 w-5 text-amber-400" />
          Merge status
        </h2>
        {merged ? (
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3">
            <img src="/survivor/late/merge-banner.svg" alt="" className="h-28 w-auto object-contain" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium text-amber-200">The tribes are now one.</p>
              <p className="text-sm text-white/60">
                Immunity goes to the top single score each week, everyone voted out from here on joins the jury, and everyone wears the gold merge buff.
              </p>
              <Link href={`/survivor/${leagueId}/merge`} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-amber-300 hover:underline">
                Open the merge
              </Link>
            </div>
            <TribeBuff merge className="w-24" label="Merge buff" />
          </div>
        ) : (
          <p className="text-sm text-white/70">
            The merge happens at week <strong className="text-white">{mergeWeek}</strong> (or by player count if configured). Before it, one tribe attends Elimination Council each week.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#07080d] p-4 sm:p-6">
        <JuryFinale leagueId={leagueId} />
      </section>

      {finale?.closed && finale.winnerRosterId && <SurvivorShareCard moment="champion" sport={summary.seasonCalendar?.sport ?? 'NFL'} leagueName={summary.config.seasonThemeLabel ?? 'Survivor League'} week={summary.currentWeek} headline={`${names[finale.winnerRosterId] ?? 'A manager'} is the last one standing`} caption="The jury has crowned this season’s winner." />}
    </div>
  )
}
