'use client'

import { useMemo } from 'react'
import { RANK_LEVELS } from '@/lib/rank/levels'
import {
  RANK_XP_LEAGUE_SIZE_MULTIPLIER,
  RANK_XP_PER_CHAMPIONSHIP,
  RANK_XP_PER_DISTINCT_SEASON,
  RANK_XP_PER_IMPORT_WIN,
  RANK_XP_PER_PLAYOFF_APPEARANCE,
} from '@/lib/rank/rank-xp-constants'

type RankingFaqPanelProps = {
  /** Current 1–25 rank level (from XP ladder) to highlight in the table. */
  currentLevel?: number
}

const detailClass =
  'group rounded-xl border border-white/10 bg-[#0a1220]/80 px-3 py-2 text-left [&_summary]:cursor-pointer [&_summary]:list-none [&_summary::-webkit-details-marker]:hidden'

export function RankingFaqPanel({ currentLevel }: RankingFaqPanelProps) {
  const highlight = useMemo(
    () => Math.min(25, Math.max(1, Math.round(Number(currentLevel)) || 1)),
    [currentLevel]
  )

  return (
    <div
      className="rounded-2xl border border-white/10 bg-[#081124] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      data-testid="ranking-faq-panel"
    >
      <div className="mb-4 flex items-center gap-2">
        <span className="text-lg" aria-hidden>
          📖
        </span>
        <p className="text-xs font-bold uppercase tracking-widest text-white/55">Ranking FAQ</p>
      </div>

      <div className="space-y-2 text-sm text-white/70">
        <details className={detailClass}>
          <summary className="flex items-center justify-between gap-2 text-[13px] font-semibold text-violet-100/95">
            How does AllFantasy rank XP work?
            <span className="text-[10px] font-normal text-white/35 group-open:rotate-180">▼</span>
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-white/55">
            Your <strong className="text-white/80">rank level (1–25)</strong> comes from{' '}
            <strong className="text-white/80">total XP</strong> on a fixed ladder. XP is earned from{' '}
            <strong className="text-white/80">imported Sleeper league history</strong> (wins, playoffs, titles, season
            coverage, and league size). It is recalculated when your imports refresh. Losses do not reduce XP.
          </p>
        </details>

        <details className={detailClass}>
          <summary className="flex items-center justify-between gap-2 text-[13px] font-semibold text-violet-100/95">
            What is each win, playoff, or title worth?
            <span className="text-[10px] font-normal text-white/35 group-open:rotate-180">▼</span>
          </summary>
          <ul className="mt-2 list-inside list-disc space-y-1.5 text-xs leading-relaxed text-white/55">
            <li>
              <strong className="text-emerald-300/90">{RANK_XP_PER_IMPORT_WIN} XP</strong> per imported win
            </li>
            <li>
              <strong className="text-emerald-300/90">{RANK_XP_PER_PLAYOFF_APPEARANCE} XP</strong> per season you made
              playoffs (imported)
            </li>
            <li>
              <strong className="text-emerald-300/90">{RANK_XP_PER_CHAMPIONSHIP} XP</strong> per championship (imported)
            </li>
            <li>
              <strong className="text-emerald-300/90">{RANK_XP_PER_DISTINCT_SEASON} XP</strong> per distinct season in
              your imported history
            </li>
            <li>
              <strong className="text-emerald-300/90">+{RANK_XP_LEAGUE_SIZE_MULTIPLIER} XP</strong> for each team over 10
              in a league (per imported league season), e.g. 14-team adds (14 − 10) × {RANK_XP_LEAGUE_SIZE_MULTIPLIER} ={' '}
              {4 * RANK_XP_LEAGUE_SIZE_MULTIPLIER} XP for that row.
            </li>
            <li className="list-none pl-0 text-white/40">
              Imported <strong className="text-white/55">losses</strong> are shown on your profile but are{' '}
              <strong className="text-white/70">not</strong> subtracted from XP.
            </li>
          </ul>
        </details>

        <details className={detailClass}>
          <summary className="flex items-center justify-between gap-2 text-[13px] font-semibold text-violet-100/95">
            How do I level up?
            <span className="text-[10px] font-normal text-white/35 group-open:rotate-180">▼</span>
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-white/55">
            Earn more total XP to cross the next threshold on the ladder. Import additional seasons or providers, win more
            games in imported leagues, make playoffs, win titles, and play in larger leagues (bonus above 10 teams). Use{' '}
            <strong className="text-white/75">Recalculate</strong> on this page after new imports so your rank cache
            updates.
          </p>
        </details>

        <details className={detailClass} open>
          <summary className="flex items-center justify-between gap-2 text-[13px] font-semibold text-violet-100/95">
            All 25 levels (min XP to reach)
            <span className="text-[10px] font-normal text-white/35 group-open:rotate-180">▼</span>
          </summary>
          <div className="mt-3 max-h-[min(50vh,320px)] overflow-auto rounded-lg border border-white/8">
            <table className="w-full min-w-[260px] border-collapse text-left text-[11px]">
              <thead className="sticky top-0 bg-[#0d1528] text-[10px] font-semibold uppercase tracking-wide text-white/40">
                <tr>
                  <th className="px-2 py-2">Lvl</th>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2 text-right">Min XP</th>
                </tr>
              </thead>
              <tbody>
                {RANK_LEVELS.map((row) => {
                  const isYou = row.level === highlight
                  return (
                    <tr
                      key={row.level}
                      className={
                        isYou
                          ? 'bg-violet-500/15 text-white ring-1 ring-violet-400/30'
                          : row.level % 2 === 0
                            ? 'bg-white/[0.02]'
                            : ''
                      }
                    >
                      <td className="px-2 py-1.5 font-mono tabular-nums text-white/80">{row.level}</td>
                      <td className="px-2 py-1.5 text-white/70">
                        {row.name}
                        {isYou ? (
                          <span className="ml-1.5 rounded bg-violet-500/25 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-200">
                            You
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-white/50">{row.minXp.toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-white/35">
            Level 25 (Dynasty) is reached at {RANK_LEVELS[24].minXp.toLocaleString()} XP. Beyond that, XP still accrues;
            progress within the top band is shown on your card.
          </p>
        </details>
      </div>
    </div>
  )
}
