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

/**
 * ── 🛑 A SLICE MAY NOT EXCEED THE BUDGET IT LIVES INSIDE, AND THIS ONE DID BY 150% ──────────
 *
 * These were 4500 and 3000, awaited in sequence — 7500ms worst case, inside a chat route whose
 * ENTIRE grounding ceiling is 3000ms. One slice could blow the whole budget on its own, and no
 * amount of parallelising the other nine could prevent it.
 *
 * Measured on a live account (2026-09-01) via the 5.1 proof surface: `portfolio` cost 4500ms —
 * exactly `getCommandCenter`'s old timeout, which is what a timeout firing looks like, not a slow
 * success — and returned nothing, pushing the packet's total to 6203ms.
 *
 * ⚠ AND THE TIMEOUT WAS INDISTINGUISHABLE FROM AN EMPTY RESULT, WHICH IS THE WORSE HALF. Both
 * paths returned `null`, so the packet graded it `not_computed` — "No cross-league snapshot is
 * available. Fix: Import at least one league and it appears." The account has 543 imported
 * leagues. The remedy was wrong because the reason was wrong: it did not find nothing, it never
 * finished looking. That is the same shape as the roster whose every name was its own player id,
 * and the provider lookup that reported a cache hit as live — a failure wearing the face of a
 * benign absence.
 *
 * ⚠ These budgets do NOT fix the underlying hang; they bound it and make it say so. Why
 * `getCommandCenter` does not complete for a large account is a separate, open question, and it
 * presumably affects the dashboard this shares its payload with.
 *
 * ── 🛑 CUT AGAIN, 1500/800 -> 600/400, BECAUSE THE WAIT WAS BUYING NOTHING ──────────────────
 *
 * Re-measured 2026-09-01 after the packet was parallelised. The slices now overlap properly —
 * 3,992ms of slice work completing in 1,545ms of wall clock — which left exactly one thing on
 * the critical path:
 *
 *     buildMs        1545
 *     portfolio      1500   <- its budget to the millisecond. a timeout, not a duration.
 *     next longest    523   (the whole context engine; devy 511 dominates it)
 *
 * 1545 - 1500 = 45. Portfolio was 97% of the wall clock and contributed zero bytes to the
 * packet. Every other slice finished inside its shadow.
 *
 * ⚠ THE REASON A SMALLER BUDGET LOSES ALMOST NOTHING IS STRUCTURAL, NOT OPTIMISM.
 * `getCommandCenter` walks up to 12 leagues in a sequential `for…of` with six timeout-bounded
 * calls each (~23s per league worst case, see docs/decision-os/SLEEPER_HISTORY_SCOPE.md §1).
 * From a COLD cache no budget in this range saves it. From a warm 10-min `sportsDataCache` it
 * is an ordinary read. There is very little in between, so the 1500ms was mostly spent
 * discovering the cache was cold — slowly.
 *
 * The honest cost, stated rather than buried: a warm read that genuinely takes 600-1500ms is
 * now dropped where it used to land. 600 rather than the ~250 the arithmetic invites is the
 * margin for that, since a 543-league payload is not a small row.
 *
 * ⚠ AND THE CAREER CARD HAD TO COME DOWN WITH IT OR THE CUT DOES NOTHING ON THE WARM PATH.
 * It only runs AFTER the command centre succeeds (see the early return below), so the slice's
 * true worst case is the SUM. At 1500/800 a warm-but-slow account still spent ~1400ms and the
 * critical path never moved. Bounded together the slice cannot exceed 600 + 400 = 1000ms, and
 * the measured typical case is ~570ms of build — the engine, which is where the floor should
 * be.
 */
const COMMAND_CENTER_BUDGET_MS = 600
const CAREER_CARD_BUDGET_MS = 400

const TIMED_OUT: unique symbol = Symbol('portfolio-grounding-timeout')

function withTimeout<T>(p: Promise<T | null>, ms: number): Promise<T | null | typeof TIMED_OUT> {
  return Promise.race([
    p.catch(() => null),
    new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), ms)),
  ])
}

/**
 * `empty` and `timeout` are separate members on purpose — collapsing them to `null` is precisely
 * the bug above. A caller that cannot tell them apart cannot give the user a true reason.
 */
export type PortfolioGroundingOutcome =
  | { status: 'ok'; text: string }
  | { status: 'timeout'; budgetMs: number }
  | { status: 'empty' }

export async function resolvePortfolioGrounding(args: {
  userId?: string | null
}): Promise<PortfolioGroundingOutcome> {
  try {
    const userId = args.userId?.trim()
    if (!userId) return { status: 'empty' }
    const center = await withTimeout(getCommandCenter(userId), COMMAND_CENTER_BUDGET_MS)
    if (center === TIMED_OUT) return { status: 'timeout', budgetMs: COMMAND_CENTER_BUDGET_MS }
    if (!center || center.leaguesScanned === 0) return { status: 'empty' }

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
    // A career-card timeout is NOT fatal to the slice: everything above it is already gathered,
    // so this degrades to a snapshot without the career line rather than to nothing.
    const career = await withTimeout(getCareerCard(userId), CAREER_CARD_BUDGET_MS)
    if (career && career !== TIMED_OUT) {
      lines.push(
        `Career (Legacy engines): all-time ${career.allTime.wins}-${career.allTime.losses}, ${career.allTime.titles} title${career.allTime.titles === 1 ? '' : 's'} across ${career.leaguesIncluded} leagues; trade résumé net ${career.trades.totalNet > 0 ? '+' : ''}${career.trades.totalNet.toFixed(0)} pts over ${career.trades.graded} graded trades; ${career.recordsHeld.length} league record${career.recordsHeld.length === 1 ? '' : 's'} held.`,
      )
    }
    lines.push(
      'These synced facts are the ONLY cross-league truths — cite them when relevant; for deeper answers about one league, that league page carries full grounding. Never invent standings, values, or trades beyond these.',
    )
    return { status: 'ok', text: lines.join('\n') }
  } catch {
    return { status: 'empty' } // never break the chat turn
  }
}
