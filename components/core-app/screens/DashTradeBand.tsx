import '@/components/core-app/af-core.css'
import '@/components/core-app/af-dash-trade.css'
import type { RecentTrade } from '@/lib/core-app/recentTrades'
import { DashTradeBandView, type TradeBandCard } from '@/components/core-app/screens/DashTradeBandView'

/**
 * Latest trade activity in your leagues.
 *
 * ⚠ THIS ANSWERS A QUESTION THE PRODUCT WAS TELLING USERS IT COULD NOT. The
 * home's coverage note said trades are not ingested and the league home
 * hard-coded its feed unavailable for the same stated reason — while the
 * trade-grade sweep was resolving both sides of every trade, down to the
 * individual draft picks, every thirty minutes. See lib/core-app/recentTrades.
 *
 * The sweep's result letter is retrospective — scored on points already
 * realised — while a new trade needs the expectation loader's market view.
 * Each side therefore labels its basis and explains which contextual inputs
 * were available. A zero-signal result never appears as an earned C.
 *
 * The verdict that IS shown is THE grade (lib/decision-os/trade/tradeGrade.ts)
 * for what each side received: the trade's FROZEN ORIGINAL, taken the first time
 * AllFantasy graded it on this league's values (`frozenCompletedGrade.ts`) — the
 * same frozen row the /core Trades history reads. The band says when with
 * `gradeMoment(t.gradedAt)`. ⚠ It once said "valued the day it was made", and that
 * is still not true: an imported trade is first graded when we first read it,
 * which can be long after the deal. It renders only when every asset on both
 * sides priced; absent means exactly that.
 *
 * ⚠ A PICK IS NAMED AS A PICK. "2027 4th", never the player it later became —
 * the two managers traded the pick, and resolving it would rewrite the deal
 * they actually made.
 *
 * Renders nothing when no trade landed in the last two weeks. A trade from
 * March is not news, and an empty "recent trades" band is furniture.
 */

const VISIBLE_ASSETS = 4

/**
 * The verdict, in names rather than the engine's A/B.
 *
 * A reader cannot act on "Slightly favors A" — they do not know which side the
 * engine called A, and nothing on the card tells them. The verdict already
 * carries the roster it favours, so the sentence can name the manager. The
 * view says it (DashTradeBandView `verdictText`).
 */
function verdictOf(t: RecentTrade): TradeBandCard['verdict'] {
  const v = t.verdict
  if (!v) return null
  if (v.favoursRosterId == null) return { kind: 'even' }
  // String-compared: a durable-feed side carries its roster id as a string, the verdict as a number.
  const side = t.sides.find((s) => String(s.rosterId) === String(v.favoursRosterId))
  const who = side ? side.teamName || side.managerName : null
  /* No name resolved: say the shape of the verdict, never a placeholder. */
  return who ? { kind: 'favours', strongly: v.verdict.toLowerCase().includes('strongly'), who } : { kind: 'unnamed' }
}

function agoLabel(iso: string, now: Date): string | null {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  const mins = Math.round((now.getTime() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function statusLabel(status?: string): string | null {
  if (!status) return null
  return ({
    pending: 'Proposed',
    awaiting_votes: 'Awaiting votes',
    awaiting_commissioner: 'Commissioner review',
    accepted: 'Accepted',
    scheduled: 'Scheduled',
    processed: 'Completed',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    countered: 'Countered',
    expired: 'Expired',
    vetoed: 'Vetoed',
    reversed: 'Reversed',
  } as Record<string, string>)[status] ?? status.replaceAll('_', ' ')
}

export function DashTradeBand({ trades, now }: { trades: RecentTrade[]; now: Date }) {
  if (!trades || trades.length === 0) return null

  /*
   * ⚠ THE WORDS ARE SAID IN THE CLIENT (2026-10-04). This band keeps the decisions — each trade's age
   * against the server's `now`, which side the verdict names, which assets show — and
   * DashTradeBandView says them in the reader's language.
   */
  return (
    <DashTradeBandView
      visibleAssets={VISIBLE_ASSETS}
      trades={trades.map((t) => ({
        key: `${t.platformLeagueId}:${t.id}`,
        leagueId: t.leagueId,
        href: `/league/${t.leagueId}?view=trades`,
        leagueName: t.leagueName,
        leagueAvatarUrl: t.leagueAvatarUrl,
        sport: t.sport ?? 'NFL',
        ago: agoLabel(t.acceptedAt, now),
        status: t.status ?? null,
        statusLabel: statusLabel(t.status),
        sides: t.sides.map((s) => ({
          rosterId: s.rosterId,
          name: s.teamName || s.managerName,
          avatarUrl: s.avatarUrl,
          received: s.received.slice(0, VISIBLE_ASSETS),
          receivedCount: s.received.length,
          grade: s.grade,
          gradeBasis: s.gradeBasis,
          gradeReason: s.gradeReason,
          gradeParts: s.gradeParts ?? null,
        })),
        verdict: verdictOf(t),
        confidence: t.verdict?.confidence ?? 0,
        moment: t.gradedMoment ?? { frozenAt: t.gradedAt },
      }))}
    />
  )
}
