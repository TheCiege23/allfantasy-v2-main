import 'server-only'

import type { LeagueTradeAsset, LeagueTradeHistoryItem } from '@/components/league/types'
import { loadGradedLeagueTradeRows } from '@/lib/core-app/leagueTradeRowGrades'
import { pickAssets, type TradeAsset } from '@/lib/core-app/tradePicks'
import type { ArchivedPick } from '@/lib/core-app/archivedTradeGrade'
import { receiptIdForGrade } from '@/lib/decision-os/trade/recordTradeGrade'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { sleeperPlayerHeadshot } from '@/lib/sports-data/headshots'

/**
 * The Trade Center's completed trades on an ESPN, Yahoo, MFL or Fleaflicker league (2026-11-17).
 *
 * 🛑 THESE LEAGUES' HISTORY TAB LISTED ONLY TRADES MADE INSIDE ALLFANTASY. Their real, completed trades
 * were synced into `LeagueTrade`, graded and frozen (Trade OS, #3729), and shown on /core Trades — but
 * the Trade Center read only `AfLeagueTrade`, so the same manager saw their trades on one screen and an
 * empty history on the other. Sleeper never had this gap: its rows come from the live scan.
 *
 * ── WHY THIS READS THROUGH `loadGradedLeagueTradeRows` ─────────────────────────────────────────────
 * It is the /core Trades read itself — the same rows, the same viewer copy of each trade, the same
 * provider identity map and the same frozen original. A second read here would be a second place for one
 * trade's letter to drift, and the frozen table is earliest-wins.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────────────────────────────
 *  - It lists only the VIEWER'S trades. Each `LeagueTrade` row is one manager's copy; another manager's
 *    copy is from their side, and laying it out as "You sent / You received" would put the viewer's name
 *    on someone else's deal. With no linked provider account there is no "you" to match, so it lists none.
 *  - It claims no direction. A `LeagueTrade` row does not record who proposed, so the row is
 *    `direction: 'complete'` and stays out of the "received" / "sent" filters rather than guessing.
 *  - It calls no provider. DB-first; a league whose sync wrote no rows answers [] (Fantrax writes none).
 */
export async function buildProviderCompletedHistory(
  args: {
    leagueId: string
    userId: string
    platform: string
    platformLeagueId: string | null
    sport: string | null
    /** The viewer's account id on the provider (`LeagueTeam.platformUserId` of their claimed team). */
    viewerPlatformUserId: string | null
  },
  deps: {
    load?: typeof loadGradedLeagueTradeRows
    receiptFor?: typeof receiptIdForGrade
  } = {},
): Promise<LeagueTradeHistoryItem[]> {
  const viewer = args.viewerPlatformUserId?.trim() || null
  if (!viewer || !args.platformLeagueId) return []
  const platform = args.platform.trim().toLowerCase()
  const load = deps.load ?? loadGradedLeagueTradeRows
  const receiptFor = deps.receiptFor ?? receiptIdForGrade

  const loaded = await load({
    leagueId: args.leagueId,
    platformLeagueId: args.platformLeagueId,
    viewerPlatformUserId: viewer,
    sport: args.sport,
    platform,
  })
  if (!loaded.available) return []

  const mine = loaded.rows.filter((r) => r.history.sleeperUsername === viewer)

  const playerAsset = (id: string, i: number, accent: 'blue' | 'teal'): LeagueTradeAsset => {
    const name = loaded.nameOf(id)
    return {
      id: `${id}:${i}`,
      // An unnamed player is said to be unnamed — never shown as a raw provider id.
      label: name ?? 'Unidentified player',
      sublabel: loaded.positionOf(id),
      // ⚠ SLEEPER IDS ONLY. A provider's player id fed to Sleeper's CDN is a different player's face.
      headshotUrl: loaded.providerIds ? null : sleeperPlayerHeadshot(id),
      playerId: loaded.providerIds ? null : id,
      accent,
    }
  }
  const pickAsset = (p: TradeAsset & { drafted?: string | null }, i: number, accent: 'blue' | 'teal'): LeagueTradeAsset => {
    const round = Number(p.pickRound)
    const season = Number(p.pickSeason)
    return {
      id: `${p.id}:${i}`,
      label: p.name,
      sublabel: p.drafted ? `Drafted ${p.drafted}` : 'Draft pick',
      headshotUrl: null,
      accent,
      ...(Number.isInteger(round) && round > 0
        ? { pick: { season: Number.isInteger(season) ? season : null, round, originalRosterId: null, fromRosterId: null } }
        : {}),
    }
  }
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

  return Promise.all(
    mine.map(async (t): Promise<LeagueTradeHistoryItem> => {
      const row = loaded.graded.get(t.transactionId)
      const grade: TradeGradeView = row?.grade ?? { graded: false, reason: 'This trade could not be graded just now.', basis: null }
      const picksOut: Array<TradeAsset | ArchivedPick> = row?.picksOut ?? pickAssets(t.picksGiven)
      const picksIn: Array<TradeAsset | ArchivedPick> = row?.picksIn ?? pickAssets(t.picksReceived)
      const at = t.tradeDate ? new Date(t.tradeDate) : null
      const timestamp = at && Number.isFinite(at.getTime()) ? at.toISOString() : ''
      const receiptId = row
        ? await receiptFor({
            surface: 'trades-panel',
            leagueId: args.leagueId,
            userId: args.userId,
            give: row.give,
            get: row.get,
            viewerSide: false,
            grade,
          }).catch(() => null)
        : null
      return {
        id: `${platform}:${t.transactionId}`,
        receiptId,
        direction: 'complete',
        partnerName: t.partnerName?.trim() || 'the other team',
        timestamp,
        executedAt: timestamp || undefined,
        sent: [...ids(t.playersGiven).map((id, i) => playerAsset(id, i, 'blue')), ...picksOut.map((p, i) => pickAsset(p, i, 'blue'))],
        received: [...ids(t.playersReceived).map((id, i) => playerAsset(id, i, 'teal')), ...picksIn.map((p, i) => pickAsset(p, i, 'teal'))],
        status: `completed_on_${platform}`,
        /*
         * THE grade is the frozen original from the viewer's side, with today's re-evaluation as
         * `current` — exactly what /core Trades shows for this trade. A completed trade has no "Then"
         * (nothing graded it when it was proposed on the provider) and no accept/decline advice.
         */
        leagueGrade: grade,
        leagueGradeSide: 'viewer',
        decisionAction: undefined,
        decisionRecommendation: null,
        proposalGrade: null,
        proposalValueGiven: null,
        proposalValueReceived: null,
        currentGrade: grade.graded ? grade.current?.letter ?? grade.letter : null,
        currentValueGiven: grade.graded ? grade.current?.giveValue ?? grade.giveValue : null,
        currentValueReceived: grade.graded ? grade.current?.getValue ?? grade.getValue : null,
      }
    }),
  )
}
