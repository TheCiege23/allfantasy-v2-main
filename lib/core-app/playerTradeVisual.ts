import 'server-only'

import { prisma } from '@/lib/prisma'
import { getMarketValues, playerValue, type MarketValuesPayload } from '@/lib/trade-intel/marketValueService'
import {
  findPackages,
  type DiscoveryPlayer,
  type DiscoveryRoster,
  type FairnessBand,
  type TradePackage,
} from '@/lib/trade-discovery/redraftTradeDiscovery'
import { buildTeamProfile } from '@/lib/trade-value/teamProfile'
import type { TeamStance } from '@/lib/trade-value/types'
import { runTradeAnalysis } from '@/lib/engine/trade'
import type { TradeEngineRequest, TradePlayerAsset } from '@/lib/engine/trade-types'
import type { LeagueContextEnvelope } from '@/lib/league-context/leagueContextService'
import type { SectionState } from './leagueHome'
import { leagueDisplayName } from './leagueHome'
import { normalizePosition } from './positionNormalization'

/**
 * "Trade for him" — the visual, not the link.
 *
 * Guap's call (2026-09-02): when another manager has the player in the held
 * league, show what it would take and what we recommend, with the hand-off to
 * the platform inside the visual. This composes three things that already exist
 * and adds none of its own numbers:
 *
 *   1. AllFantasy market values (`getMarketValues`, DB-first, the FantasyCalc /
 *      DynastyProcess blend) under this league's format — dynasty vs redraft,
 *      1QB vs superflex, PPR weight, team count.
 *   2. The deterministic package finder (`findPackages`), told the target, which
 *      builds give/get packages from your surplus positions and bands their
 *      fairness on those values.
 *   3. The trade engine (`runTradeAnalysis`) on the recommended package, for the
 *      verdict, fairness score, starter-points delta and acceptance odds — under
 *      a time budget, and reported as unavailable rather than guessed when it
 *      cannot answer.
 *
 * ⚠ THE PACKAGE FINDER'S OWN LOADER ONLY READS NATIVE REDRAFT LEAGUES
 * (`assembleDiscoveryLeague` keys on `redraftSeason`), and the Player Finder's
 * leagues are mostly imported. So this builds the two `DiscoveryRoster`s from
 * `Roster.playerData` itself — the same rows every other read on the screen
 * uses — and hands them to the same pure engine. Nothing here proposes,
 * sends or accepts anything.
 */

export type TradeVisualAsset = {
  kind: 'player' | 'faab'
  playerId: string | null
  name: string
  position: string | null
  value: number | null
}

export type TradeVisualPackage = {
  id: string
  give: TradeVisualAsset[]
  receive: TradeVisualAsset[]
  giveTotal: number
  receiveTotal: number
  /** receive minus give, in market-value units. Positive favours you. */
  delta: number
  fairness: FairnessBand
  confidence: number
  reasons: string[]
  warnings: string[]
}

export type TradeVisualGrade = {
  verdict: 'accept' | 'reject' | 'counter'
  verdictConfidence: 'high' | 'medium' | 'low'
  fairnessScore: number
  fairnessDelta: number
  /** Projected starter points gained (positive) or lost by your lineup. */
  starterDeltaPts: number
  lineupNote: string
  /** 0–1, the engine's estimate that the partner accepts. */
  acceptance: number | null
  explanations: string[]
}

export type TradeVisualSide = {
  teamName: string
  ownerName: string | null
  stance: TeamStance
  needs: string[]
  surpluses: string[]
}

export type PlayerTradeVisual = {
  leagueId: string
  leagueName: string
  platform: string
  platformLeagueId: string | null
  season: number | null
  target: { sleeperId: string; name: string; position: string | null; value: number | null }
  you: TradeVisualSide
  partner: TradeVisualSide
  values: { mode: 'dynasty' | 'redraft'; source: string; fetchedAt: string; ppr: number; numQbs: 1 | 2 }
  packages: TradeVisualPackage[]
  /** The package we would open with, or null when none is balanced enough to suggest. */
  recommended: TradeVisualPackage | null
  grade: SectionState<TradeVisualGrade>
}

const IDP_SLOTS = new Set(['DL', 'LB', 'DB', 'IDP_FLEX', 'DE', 'DT', 'CB', 'S'])
const GRADE_BUDGET_MS = 6000

function asIds(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).filter(Boolean) : []
}

function allIds(pd: Record<string, unknown>): string[] {
  return [...new Set([...asIds(pd.players), ...asIds(pd.starters), ...asIds(pd.reserve), ...asIds(pd.taxi)])]
}

function contains(pd: Record<string, unknown>, id: string): boolean {
  return allIds(pd).includes(id)
}

/** The market-value context the value service keys its cache on, from the league's own settings. */
export function marketContextFor(
  settings: unknown,
  leagueType: string | null,
  teams: number
): Pick<LeagueContextEnvelope, 'variant' | 'scoring' | 'teams'> {
  const s = (settings ?? {}) as Record<string, unknown>
  const rawScoring = (s.scoring_settings ?? {}) as Record<string, unknown>
  const scoringSettings: Record<string, number> = {}
  for (const [k, v] of Object.entries(rawScoring)) {
    const n = Number(v)
    if (Number.isFinite(n)) scoringSettings[k] = n
  }
  const rec = scoringSettings.rec ?? 0
  const positions = Array.isArray(s.roster_positions) ? s.roster_positions.map((p) => String(p).toUpperCase()) : []
  const type = (leagueType ?? '').toLowerCase()
  return {
    teams,
    variant: {
      idp: positions.some((p) => IDP_SLOTS.has(p)),
      superflex: positions.some((p) => p === 'SUPER_FLEX' || p === 'SUPERFLEX'),
      dynasty: type.includes('dynasty'),
      keeper: type.includes('keeper'),
      bestBall: type.includes('best ball') || type.includes('bestball'),
    },
    scoring: {
      settings: scoringSettings,
      receptionWeight: rec,
      format: rec >= 0.75 ? 'ppr' : rec >= 0.25 ? 'half_ppr' : 'std',
      idp: { present: false, tacklePts: 0, sackPts: 0, intPts: 0, emphasis: null },
    },
  }
}

function toAssets(list: TradePackage['giveAssets']): TradeVisualAsset[] {
  return list.map((a) => ({
    kind: a.kind,
    playerId: a.playerId ?? null,
    name: a.kind === 'faab' ? `$${a.faabAmount ?? 0} FAAB` : (a.playerName ?? 'Unknown player'),
    position: a.position ?? null,
    value: a.value,
  }))
}

function toPackage(p: TradePackage): TradeVisualPackage {
  return {
    id: p.packageId,
    give: toAssets(p.giveAssets),
    receive: toAssets(p.receiveAssets),
    giveTotal: Math.round(p.myTotalValue),
    receiveTotal: Math.round(p.partnerTotalValue),
    delta: Math.round(p.partnerTotalValue - p.myTotalValue),
    fairness: p.fairnessBand,
    confidence: p.confidence,
    reasons: p.reasons,
    warnings: p.warningFlags,
  }
}

const OPENABLE: FairnessBand[] = ['balanced', 'slight edge you']

export async function getPlayerTradeVisual(
  leagueId: string,
  targetSleeperId: string,
  userId: string | null
): Promise<SectionState<PlayerTradeVisual>> {
  if (!userId) return { available: false, reason: 'sign in to build a trade for him' }

  const league = await prisma.league
    .findUnique({
      where: { id: leagueId },
      select: {
        id: true,
        name: true,
        platform: true,
        platformLeagueId: true,
        season: true,
        settings: true,
        leagueType: true,
      },
    })
    .catch(() => null)
  if (!league) return { available: false, reason: 'league not found' }

  const [teams, rosters] = await Promise.all([
    prisma.leagueTeam
      .findMany({
        where: { leagueId },
        select: {
          externalId: true,
          platformUserId: true,
          claimedByUserId: true,
          ownerName: true,
          teamName: true,
          wins: true,
          losses: true,
          ties: true,
          pointsFor: true,
        },
      })
      .catch(() => []),
    prisma.roster
      .findMany({ where: { leagueId }, select: { platformUserId: true, playerData: true } })
      .catch(() => []),
  ])

  const yours = teams.find((t) => t.claimedByUserId === userId) ?? null
  const yourIds = new Set([yours?.platformUserId, yours?.externalId, userId].filter((x): x is string => Boolean(x)))
  const myRoster = rosters.find((r) => yourIds.has(r.platformUserId)) ?? null
  if (!myRoster) return { available: false, reason: 'you need a claimed team in this league to build a trade' }

  const holder = rosters.find((r) => contains((r.playerData ?? {}) as Record<string, unknown>, targetSleeperId)) ?? null
  if (!holder) return { available: false, reason: 'he is not on any roster we can read here — claim him instead of trading for him' }
  if (holder.platformUserId === myRoster.platformUserId) {
    return { available: false, reason: 'he is already on your roster in this league' }
  }
  const partnerTeam =
    teams.find((t) => t.platformUserId === holder.platformUserId) ??
    teams.find((t) => t.externalId === holder.platformUserId) ??
    null

  const leagueSize = rosters.length || 12
  const values: MarketValuesPayload | null = await getMarketValues(
    marketContextFor(league.settings, league.leagueType, leagueSize)
  ).catch(() => null)
  if (!values) {
    return { available: false, reason: 'no market values are loaded for this league’s format yet, so a package cannot be priced' }
  }

  const myPd = (myRoster.playerData ?? {}) as Record<string, unknown>
  const theirPd = (holder.playerData ?? {}) as Record<string, unknown>
  const ids = [...new Set([...allIds(myPd), ...allIds(theirPd)])]
  const rows = await prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: ids } },
      select: { sleeperId: true, name: true, position: true },
      distinct: ['sleeperId'],
    })
    .catch(() => [] as Array<{ sleeperId: string | null; name: string; position: string | null }>)
  const byId = new Map(rows.filter((r) => r.sleeperId).map((r) => [r.sleeperId as string, r]))

  const toPlayers = (pd: Record<string, unknown>): DiscoveryPlayer[] =>
    allIds(pd).flatMap((id) => {
      const row = byId.get(id)
      if (!row) return []
      return [
        {
          playerId: id,
          playerName: row.name,
          position: row.position ? normalizePosition(row.position) : 'UNK',
          value: playerValue(values, id),
          isLocked: false,
        },
      ]
    })

  const settings = (league.settings ?? {}) as Record<string, unknown>
  const rosterSlots = Array.isArray(settings.roster_positions) ? settings.roster_positions.map(String) : null

  const side = (
    team: (typeof teams)[number] | null,
    rosterId: string,
    players: DiscoveryPlayer[],
    fallbackName: string
  ): DiscoveryRoster => {
    const profile = buildTeamProfile({
      rosterId,
      wins: team?.wins ?? 0,
      losses: team?.losses ?? 0,
      ties: team?.ties ?? 0,
      pointsFor: team?.pointsFor ?? 0,
      playoffSeed: null,
      leagueSize,
      positions: players.map((p) => p.position),
      rosterSlots,
    })
    return {
      rosterId,
      teamName: team?.teamName ?? fallbackName,
      managerDisplayName: team?.ownerName ?? null,
      stance: profile.stance,
      weakPositions: profile.weakPositions,
      strongPositions: profile.strongPositions,
      players,
    }
  }

  const me = side(yours, myRoster.platformUserId, toPlayers(myPd), 'Your team')
  const partner = side(partnerTeam, holder.platformUserId, toPlayers(theirPd), 'Another manager')

  const targetRow = byId.get(targetSleeperId)
  const packages = findPackages({
    myRoster: me,
    partnerRoster: partner,
    sport: 'NFL',
    faabSupported: false,
    draftPickTrading: false,
    targetPlayerId: targetSleeperId,
    max: 3,
  }).map(toPackage)

  const recommended = packages.find((p) => OPENABLE.includes(p.fairness)) ?? packages[0] ?? null

  /*
   * The engine's grade of the package we would open with. Budgeted: the engine
   * prices both rosters and runs a championship-odds simulation, and a page
   * view cannot wait on it forever. A miss is said, never filled in.
   */
  let grade: SectionState<TradeVisualGrade> = {
    available: false,
    reason: recommended ? 'the trade engine did not answer in time' : 'no package to grade',
  }
  if (recommended) {
    const ctx = marketContextFor(league.settings, league.leagueType, leagueSize)
    const format: TradeEngineRequest['format'] = ctx.variant.dynasty ? 'dynasty' : ctx.variant.keeper ? 'keeper' : 'redraft'
    const asset = (a: TradeVisualAsset) =>
      a.kind === 'player' && a.playerId
        ? ({ type: 'player', player: { id: a.playerId, name: a.name, pos: a.position ?? undefined } } as const)
        : ({ type: 'faab', faab: { amount: a.value ?? 0 } } as const)
    const rosterAssets = (players: DiscoveryPlayer[]): TradePlayerAsset[] =>
      players.map((p) => ({ id: p.playerId, name: p.playerName, pos: p.position }))
    const req: TradeEngineRequest = {
      sport: 'NFL',
      format,
      leagueId: league.id,
      numTeams: leagueSize,
      assetsA: recommended.give.map(asset),
      assetsB: recommended.receive.map(asset),
      rosterA: rosterAssets(me.players),
      rosterB: rosterAssets(partner.players),
      teamAName: me.teamName,
      teamBName: partner.teamName,
    }
    try {
      const res = await Promise.race([
        runTradeAnalysis(req),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), GRADE_BUDGET_MS)),
      ])
      if (res) {
        grade = {
          available: true,
          data: {
            verdict: res.verdict,
            verdictConfidence: res.verdictConfidence,
            fairnessScore: Math.round(res.fairness.score),
            fairnessDelta: Math.round(res.fairness.delta),
            starterDeltaPts: Math.round(res.lineupImpact.starterDeltaPts * 10) / 10,
            lineupNote: res.lineupImpact.note,
            acceptance: typeof res.acceptanceProbability?.final === 'number' ? res.acceptanceProbability.final : null,
            explanations: (res.fairness.explanations ?? []).slice(0, 3),
          },
        }
      }
    } catch {
      grade = { available: false, reason: 'the trade engine could not grade this package' }
    }
  }

  const stanceOf = (r: DiscoveryRoster): TradeVisualSide => ({
    teamName: r.teamName,
    ownerName: r.managerDisplayName ?? null,
    stance: r.stance,
    needs: r.weakPositions,
    surpluses: r.strongPositions,
  })

  return {
    available: true,
    data: {
      leagueId: league.id,
      leagueName: leagueDisplayName(league.name),
      platform: String(league.platform ?? 'manual').toLowerCase(),
      platformLeagueId: league.platformLeagueId ?? null,
      season: league.season ?? null,
      target: {
        sleeperId: targetSleeperId,
        name: targetRow?.name ?? 'this player',
        position: targetRow?.position ? normalizePosition(targetRow.position) : null,
        value: playerValue(values, targetSleeperId),
      },
      you: stanceOf(me),
      partner: stanceOf(partner),
      values: { mode: values.mode, source: values.source, fetchedAt: values.fetchedAt, ppr: values.ppr, numQbs: values.numQbs },
      packages,
      recommended,
      grade,
    },
  }
}
