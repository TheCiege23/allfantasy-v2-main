import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  callerTradeSeat,
  readLeagueTradeRows,
  readTradePlayerRows,
  rosterSlotsOf,
  teamForTradeRoster,
  toDiscoveryPlayers,
  toDiscoveryRoster,
  tradeRosterPlayerIds,
  type LeagueTradeRoster,
} from '@/lib/core-app/playerTradeVisual'
import { leagueTypeBasis } from '@/lib/league/leagueTypeGrading'
import { loadLeagueForTrade } from '@/lib/trade-value-console/league-loader'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { findPackages, findPartners, type DiscoveryRoster, type PackageAsset, type TradePackage } from '@/lib/trade-discovery/redraftTradeDiscovery'
import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'
import { marketContextFor } from '@/lib/trade-intel/marketContext'
import { getMarketValues } from '@/lib/trade-intel/marketValueService'
import { createLeagueTradeGrader, type LeagueTradeGrader } from './leagueTradeGrader'
import { marketLetterOf, marketView } from './tradeGrade'
import {
  agentLeagueRefusal,
  dealKeyOf,
  qualifyDeal,
  rankSuggestions,
  type AgentAsset,
  type AgentSuggestion,
} from './tradeAgentRules'
import { saveTradeAgentSuggestions } from './tradeAgentStore'

/**
 * The nightly trade agent for ONE league (design build step 9; rules in `./tradeAgentRules.ts`).
 *
 * For every AllFantasy manager in the league: the partners `findPartners` ranks as the best fits, the
 * packages `findPackages` builds with each, and THE one grade on each package — from the manager's side
 * with need priced for their roster, then from the partner's side with need priced for the partner's.
 * A deal both sides read as C, on which both rosters gain, is kept; the best three are saved.
 *
 * ⚠ THE FINDER ONLY PROPOSES; THE GRADE DECIDES. `findPackages` bands its packages on its own scale, and
 * that band is used only to skip packages it already calls lopsided — nothing it computes reaches a
 * suggestion. Every number saved comes from the grade.
 *
 * ⚠ EVERY PLAYER IS PRICED BY ID. Roster ids here are Sleeper ids (the NFL id space), passed as a
 * Sleeper `providerIdentity`, so a shared name cannot price the wrong man.
 *
 * Suggest only. Nothing here proposes a trade or tells the partner.
 */

/** Partners tried per manager, best fit first. */
const PARTNERS_PER_MANAGER = 4
/** Packages asked of the finder per partner. */
const PACKAGES_PER_PARTNER = 2
/** The same cap the Chimmy finder applies to one league's player read. */
const MAX_LEAGUE_PLAYER_IDS = 1200

const OPEN_ROSTER = /^(open-slot|orphan)-/

export type TradeAgentLeagueResult = {
  leagueId: string
  skipped?: string
  managers: number
  graded: number
  saved: number
  /** True when the budget ran out part-way; nothing for the unfinished managers was written. */
  partial: boolean
}

export type TradeAgentDeps = {
  /** Stop between grades when true. */
  shouldStop?: () => boolean
  save?: typeof saveTradeAgentSuggestions
  createGrader?: typeof createLeagueTradeGrader
}

function toAgentAssets(assets: readonly PackageAsset[]): AgentAsset[] | null {
  const out: AgentAsset[] = []
  for (const a of assets) {
    if (a.kind !== 'player' || !a.playerId || !a.playerName) return null
    out.push({ playerId: a.playerId, name: a.playerName, position: a.position ?? '' })
  }
  return out.length ? out : null
}

const toInputs = (assets: readonly AgentAsset[]): TradeAssetInput[] =>
  assets.map((a) => ({ kind: 'player', name: a.name, providerIdentity: { provider: 'sleeper', id: a.playerId, position: a.position || undefined } }))

/** A package the finder itself calls lopsided or unpriced is not worth a grade. */
const worthGrading = (pkg: TradePackage) => pkg.fairnessBand !== 'lopsided' && pkg.fairnessBand !== 'low confidence'

export async function runTradeAgentForLeague(leagueId: string, runDate: string, deps: TradeAgentDeps = {}): Promise<TradeAgentLeagueResult> {
  const result: TradeAgentLeagueResult = { leagueId, managers: 0, graded: 0, saved: 0, partial: false }
  const shouldStop = deps.shouldStop ?? (() => false)

  const league = await loadLeagueForTrade({ leagueId, userId: '', membershipPreverified: true }).catch(() => null)
  if (!league) return { ...result, skipped: 'the league could not be read' }
  const leagueType = leagueTypeBasis({ settings: league.settings, leagueType: league.leagueType, platform: league.platform ?? null })
  const concept = readFormatRules({ leagueType: league.leagueType, leagueVariant: league.leagueVariant, isDynasty: league.isDynasty, settings: league.settings }).concept
  const refusal = agentLeagueRefusal({ sport: league.sport, leagueType: leagueType.type, concept })
  if (refusal) return { ...result, skipped: refusal }

  const rows = await readLeagueTradeRows(leagueId)
  const managers = rows.teams.filter((t) => t.claimedByUserId).map((t) => t.claimedByUserId as string)
  if (managers.length === 0) return { ...result, skipped: 'no AllFantasy manager has claimed a team here' }

  const leagueSize = rows.rosters.length || league.leagueSize || 12
  const marketContext = marketContextFor(league.settings, league.leagueType, leagueSize)
  const values = await getMarketValues(marketContext).catch(() => null)
  if (!values) return { ...result, skipped: 'no market values are loaded for this league’s format' }

  const tradable = rows.rosters.filter((r) => r.platformUserId && !OPEN_ROSTER.test(r.platformUserId))
  const ids = [...new Set(tradable.flatMap(tradeRosterPlayerIds))].slice(0, MAX_LEAGUE_PLAYER_IDS)
  const byId = await readTradePlayerRows(ids)
  const shape = { leagueSize, rosterSlots: rosterSlotsOf(league.settings) }
  const discovery = new Map<string, DiscoveryRoster>()
  for (const r of tradable) {
    discovery.set(
      r.platformUserId,
      toDiscoveryRoster(teamForTradeRoster(rows.teams, r), r.platformUserId, toDiscoveryPlayers(r, byId, values, marketContext.scoring.settings), 'Another manager', shape),
    )
  }
  const rosterOf = new Map<string, LeagueTradeRoster>(tradable.map((r) => [r.platformUserId, r]))

  const grader: LeagueTradeGrader | null = await (deps.createGrader ?? createLeagueTradeGrader)({ leagueId, leagueRow: league, leagueNormCtx: null }).catch(() => null)
  if (!grader) return { ...result, skipped: 'the league’s values could not be loaded' }
  const save = deps.save ?? saveTradeAgentSuggestions

  for (const userId of managers) {
    if (shouldStop()) return { ...result, partial: true }
    const { myRoster } = callerTradeSeat(rows, userId)
    const me = myRoster ? discovery.get(myRoster.platformUserId) : undefined
    if (!myRoster || !me || me.players.length === 0) continue
    result.managers += 1

    const others = [...discovery.values()].filter((r) => r.rosterId !== me.rosterId && r.players.length > 0)
    const partners = findPartners({ myRoster: me, otherRosters: others, sport: 'NFL' }).slice(0, PARTNERS_PER_MANAGER)
    const found: AgentSuggestion[] = []
    let stopped = false

    for (const match of partners) {
      const partner = discovery.get(match.rosterId)
      const partnerRoster = rosterOf.get(match.rosterId)
      if (!partner || !partnerRoster) continue
      const pkgs = findPackages({ myRoster: me, partnerRoster: partner, sport: 'NFL', faabSupported: false, draftPickTrading: false, max: PACKAGES_PER_PARTNER })
      for (const pkg of pkgs.filter(worthGrading)) {
        if (shouldStop()) {
          stopped = true
          break
        }
        const give = toAgentAssets(pkg.giveAssets)
        const get = toAgentAssets(pkg.receiveAssets)
        if (!give || !get) continue
        const viewer = await grader.grade({ give: toInputs(give), get: toInputs(get), viewerSide: true, needRoster: { playerData: myRoster.playerData } })
        result.graded += 1
        // The cheap half first: most packages fail on the viewer's side, and need not be graded twice.
        // "Fair on paper" is the league-value letter, never the your-team headline (`qualifyDeal`).
        if (!viewer.graded || marketLetterOf(viewer) !== 'C' || !(viewer.rosterFit && viewer.rosterFit.percentDiff > 0)) continue
        const theirs = await grader.grade({ give: toInputs(get), get: toInputs(give), viewerSide: true, needRoster: { playerData: partnerRoster.playerData } })
        result.graded += 1
        const verdict = qualifyDeal(viewer, theirs)
        // A suggestion is stored on league value — its premise — and carries each side's fit beside it.
        const market = marketView(viewer)
        if (!verdict.ok || !market.graded) continue
        found.push({
          partnerRosterId: partner.rosterId,
          partnerName: partner.managerDisplayName ?? partner.teamName ?? null,
          give,
          get,
          dealKey: dealKeyOf(give, get),
          letter: market.letter,
          partnerLetter: market.partnerLetter,
          percentDiff: market.percentDiff,
          giveValue: market.giveValue,
          getValue: market.getValue,
          viewerFitPct: verdict.viewerFitPct,
          partnerFitPct: verdict.partnerFitPct,
          basis: viewer.basis,
        })
      }
      if (stopped) break
    }
    // A manager the budget interrupted keeps last night's list rather than a partial one.
    if (stopped) return { ...result, partial: true }
    result.saved += await save({ leagueId, userId, rosterId: myRoster.platformUserId, runDate, suggestions: rankSuggestions(found) })
  }
  return result
}

/** NFL leagues with at least one claimed team — the only leagues the agent can suggest in. */
export async function tradeAgentLeagueIds(): Promise<string[]> {
  const rows = await prisma.league
    .findMany({
      where: { sport: 'NFL', teams: { some: { claimedByUserId: { not: null } } } },
      select: { id: true },
      orderBy: { id: 'asc' },
    })
    .catch(() => [] as Array<{ id: string }>)
  return rows.map((r) => r.id)
}
