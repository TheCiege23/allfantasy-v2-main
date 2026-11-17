/**
 * ONE MANAGER'S RECORD — every Competitive Edge fact about one leaguemate in one object: their trades,
 * their waiver claims and FAAB this season, and their past drafts. Pure: the loader
 * (./managerRecordLoader.ts) supplies the league's history and the manager.
 *
 * Owner's decision, 2026-11-16 (re-score item 11): Manager Psychology returns as FACTS ONLY, PAID —
 * "traded 9 times, usually sells RBs", never a label, never a prediction about a person, behind the
 * Competitive Edge tier. Three surfaces read this one record: Chimmy, the manager card, and the
 * commissioner's Managers screen. One record means they cannot disagree about a manager.
 *
 * 🛑 NO NEW RULE AND NO NEW SENTENCE. Each section is the existing builder's own output — the trade
 * record (`buildTradeRecord`), a waiver rival (`buildWaiverEdge`), draft history (`draftHistoryFacts`)
 * — so a manager reads identically here, in the Trade Center, on the Waivers screen and in Draft HQ.
 * The contract those carry (lib/competitive-edge/tradeEdge.ts, Milestone 32) is therefore this one's:
 *   - FACTS, NEVER LABELS: counts a reader can check.
 *   - NO PREDICTIONS: nothing says what anyone will do next.
 *   - COVERAGE IS PART OF THE ANSWER: below each floor no pattern is shown, and a section that could
 *     not be read says why rather than reading as a quiet manager.
 */
import type { SectionState } from '@/lib/core-app/leagueHome'
import { buildTradeRecord, type EdgeFact, type EdgeTrade, type TradeEdge } from './tradeEdge'
import { buildWaiverEdge, type EdgeWaiverClaim, type WaiverEdgeFact } from './waiverEdge'
import { draftHistoryFacts, type EdgeDraftPick } from './draftEdge'

export type ManagerRecordWaivers = {
  season: number
  usesFaab: boolean
  claims: number
  /** Only in a FAAB league. */
  faabRemaining: number | null
  sufficient: boolean
  facts: WaiverEdgeFact[]
  asOf: string | null
  stale: boolean
}

export type ManagerRecordDrafts = {
  /** This manager's drafts on file. */
  drafts: number
  picks: number
  sufficient: boolean
  facts: EdgeFact[]
  /** Seasons whose picks are matched to their managers, league-wide. */
  seasons: number[]
  /** Seasons with picks not matched to a manager — this manager's count may omit some. */
  unattributedSeasons: number[]
}

export type ManagerRecord = {
  manager: { name: string; teamExternalId: string }
  trades: SectionState<TradeEdge>
  waivers: SectionState<ManagerRecordWaivers>
  drafts: SectionState<ManagerRecordDrafts>
}

export type ManagerRecordInput = {
  manager: {
    name: string
    teamExternalId: string
    /** The stable person id the history is keyed on (Sleeper: the user id). Null when unmatched. */
    ownerId: string | null
  }
  /** The viewer's person id, for "N of them with you". */
  viewerOwnerId: string | null
  trades: SectionState<{ trades: EdgeTrade[]; seasonsScanned: string[]; historyGaps: string[]; asOf: string; stale: boolean }>
  waivers: SectionState<{
    season: number
    usesFaab: boolean
    /** The league's winning claims this season; this manager's are picked out by team. */
    claims: EdgeWaiverClaim[]
    faabRemaining: number | null
    asOf: string | null
    stale: boolean
  }>
  drafts: SectionState<{ picks: EdgeDraftPick[]; unattributedSeasons: number[] }>
}

const UNMATCHED = "We can't match this team to one person across seasons, so there is no history to read for them."

export function buildManagerRecord(input: ManagerRecordInput): ManagerRecord {
  const { name, teamExternalId, ownerId } = input.manager

  const trades: SectionState<TradeEdge> = !input.trades.available
    ? input.trades
    : !ownerId
      ? { available: false, reason: UNMATCHED }
      : {
          available: true,
          data: buildTradeRecord({
            trades: input.trades.data.trades,
            managerOwnerId: ownerId,
            managerName: name,
            teamExternalId,
            viewerOwnerId: input.viewerOwnerId,
            seasonsScanned: input.trades.data.seasonsScanned,
            historyGaps: input.trades.data.historyGaps,
            asOf: input.trades.data.asOf,
            stale: input.trades.data.stale,
          }),
        }

  let waivers: SectionState<ManagerRecordWaivers>
  if (!input.waivers.available) {
    waivers = input.waivers
  } else {
    const w = input.waivers.data
    // The waiver edge's own rival, with no viewer: the lines that compare budgets to yours belong to
    // a waiver decision, not to a manager's record.
    const edge = buildWaiverEdge({
      season: w.season,
      usesFaab: w.usesFaab,
      claims: w.claims,
      managers: [{ teamExternalId, name, faabRemaining: w.faabRemaining }],
      viewerTeamExternalId: null,
      asOf: w.asOf,
      stale: w.stale,
    })
    const rival = edge.rivals[0]!
    waivers = {
      available: true,
      data: {
        season: w.season,
        usesFaab: w.usesFaab,
        claims: rival.claims,
        faabRemaining: rival.faabRemaining,
        sufficient: rival.sufficient,
        facts: rival.facts,
        asOf: w.asOf,
        stale: w.stale,
      },
    }
  }

  let drafts: SectionState<ManagerRecordDrafts>
  if (!input.drafts.available) {
    drafts = input.drafts
  } else if (!ownerId) {
    drafts = { available: false, reason: UNMATCHED }
  } else {
    const d = input.drafts.data
    const h = draftHistoryFacts({ name, ownerSleeperId: ownerId, picks: d.picks })
    drafts = {
      available: true,
      data: {
        drafts: h.drafts,
        picks: d.picks.filter((p) => p.ownerSleeperId === ownerId).length,
        sufficient: h.sufficient,
        facts: h.facts,
        seasons: [...new Set(d.picks.map((p) => p.season))].sort((a, b) => a - b),
        unattributedSeasons: [...new Set(d.unattributedSeasons)].sort((a, b) => a - b),
      },
    }
  }

  return { manager: { name, teamExternalId }, trades, waivers, drafts }
}
