import 'server-only'

/**
 * Portfolio grounding for Chimmy — the DASHBOARD-level counterpart of the
 * per-league intelligence grounding. When a chat turn has NO league attached,
 * Chimmy still knows the user's whole world: every imported league, what needs
 * their call, this week's win probabilities, and portfolio value — all from
 * the SAME Command Center payload the dashboard renders (10-min cache), so the
 * chat and the UI can never disagree.
 *
 * Same contract as the other groundings: never throws, null on any miss,
 * timeout-bounded so a cold cache can't stall a chat turn.
 */

import { getCommandCenter } from '@/lib/dashboard-intel/commandCenterService'
import { getCareerCard } from '@/lib/dashboard-intel/careerCardService'

function withTimeout<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

export async function resolvePortfolioGrounding(args: {
  userId?: string | null
}): Promise<string | null> {
  try {
    const userId = args.userId?.trim()
    if (!userId) return null
    const center = await withTimeout(getCommandCenter(userId), 4500)
    if (!center || center.leaguesScanned === 0) return null

    const lines: string[] = []
    lines.push(
      `Cross-league snapshot (${center.leaguesScanned} imported leagues, synced ${center.fetchedAt}):`,
    )
    if (center.feed.length > 0) {
      const top = center.feed.slice(0, 5)
      lines.push(
        `Needs attention (ranked): ${top
          .map((f) => `${f.leagueName} — ${f.title} [${f.engine}]`)
          .join('; ')}.`,
      )
    } else {
      lines.push('Nothing urgent across any league right now.')
    }
    if (center.week.projectedCount > 0) {
      lines.push(
        `This week: favored in ${center.week.favoredCount} of ${center.week.projectedCount} projected matchups. ${center.week.matchups
          .filter((m) => m.winProb != null)
          .map((m) => `${m.leagueName}: ${m.winProb?.toFixed(0)}% vs ${m.oppName}${m.pirate ? ' (PIRATE league — a loss forfeits a player)' : ''}`)
          .join('; ')}.`,
      )
    }
    if (center.portfolio.leagues.length > 0) {
      const movers = [...center.portfolio.risers.slice(0, 2), ...center.portfolio.fallers.slice(0, 2)]
      lines.push(
        `Portfolio: total roster market value ${center.portfolio.totalValue.toLocaleString()} across ${center.portfolio.leagues.length} leagues (${center.portfolio.source}). ${
          movers.length > 0
            ? `Movers (30d): ${movers.map((m) => `${m.name} ${m.trend30Day > 0 ? '+' : ''}${m.trend30Day}`).join(', ')}.`
            : ''
        }`,
      )
    }
    if (center.exposure.rows.length > 0) {
      const multi = center.exposure.rows.filter((r) => r.count > 1).slice(0, 4)
      if (multi.length > 0) {
        lines.push(
          `Exposure: ${multi
            .map((r) => `${r.name} in ${r.count} of ${center.exposure.rostersCounted} rosters (${r.exposurePct}%)${r.injury ? ` [INJURY: ${r.injury.status}]` : ''}`)
            .join('; ')}.`,
        )
      }
    }
    const career = await withTimeout(getCareerCard(userId), 3000)
    if (career) {
      lines.push(
        `Career (Legacy engines): all-time ${career.allTime.wins}-${career.allTime.losses}, ${career.allTime.titles} title${career.allTime.titles === 1 ? '' : 's'} across ${career.leaguesIncluded} leagues; trade résumé net ${career.trades.totalNet > 0 ? '+' : ''}${career.trades.totalNet.toFixed(0)} pts over ${career.trades.graded} graded trades; ${career.recordsHeld.length} league record${career.recordsHeld.length === 1 ? '' : 's'} held.`,
      )
    }
    lines.push(
      'These synced facts are the ONLY cross-league truths — cite them when relevant; for deeper answers about one league, that league page carries full grounding. Never invent standings, values, or trades beyond these.',
    )
    return lines.join('\n')
  } catch {
    return null // never break the chat turn
  }
}
