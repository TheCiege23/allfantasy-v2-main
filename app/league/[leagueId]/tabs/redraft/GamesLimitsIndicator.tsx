'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { GamesLimitsSummary } from '@/lib/redraft/gamesLimits'
import { gamesLimitsCopy, inningsFromOuts } from '@/lib/redraft/gamesLimitsCopy'

/** The `gamesLimits` summary the scorer stored on this side of `lineupSnapshots.redraftScoring`, if any. */
export function readGamesLimitsSummary(scoring: Record<string, unknown> | null, side: 'home' | 'away'): GamesLimitsSummary | null {
  const team = scoring?.[side]
  if (!team || typeof team !== 'object' || Array.isArray(team)) return null
  const summary = (team as Record<string, unknown>).gamesLimits
  return summary && typeof summary === 'object' && !Array.isArray(summary) ? (summary as GamesLimitsSummary) : null
}

/**
 * "X of Y games used" / "Goalie starts 2 of 3" / innings, under the week's matchup score. Renders nothing
 * for a league without games limits — the scorer only writes the summary when a limit is on.
 */
export function GamesLimitsIndicator({ summary }: { summary: GamesLimitsSummary | null }) {
  const { language } = useOptionalLanguage()
  if (!summary) return null
  const copy = gamesLimitsCopy(language)
  const lines: { text: string; warn: boolean }[] = []
  for (const c of summary.caps ?? []) lines.push({ text: copy.capUsage(c.slot, c.used, c.cap), warn: c.used >= c.cap })
  if (summary.goalieStarts) {
    const g = summary.goalieStarts
    lines.push({ text: copy.goalieUsage(g.count, g.min, g.met), warn: !g.met })
  }
  if (summary.innings) {
    const i = summary.innings
    lines.push({
      text: copy.inningsUsage(
        inningsFromOuts(i.outs),
        i.minOuts != null ? inningsFromOuts(i.minOuts) : null,
        i.maxOuts != null ? inningsFromOuts(i.maxOuts) : null,
        i.minMet,
        i.maxReached,
      ),
      warn: i.minMet === false || i.maxReached === true,
    })
  }
  if (!lines.length) return null
  return (
    <div className="mt-3 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2" data-testid="games-limits-indicator">
      <p className="text-[11px] uppercase tracking-[0.15em] text-white/35">{copy.indicatorTitle}</p>
      <ul className="mt-1 space-y-0.5">
        {lines.map((l) => (
          <li key={l.text} className={`text-[11px] ${l.warn ? 'text-amber-100' : 'text-white/60'}`}>
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  )
}
