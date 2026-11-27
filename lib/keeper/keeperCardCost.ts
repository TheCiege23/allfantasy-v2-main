import 'server-only'

/**
 * The player card's keeper line in a KEEPER league: what keeping him costs under the league's rule, and
 * what that is worth (./keeperCardCostLine for the words).
 *
 * Shown only when:
 *   - the league is a keeper league (`leagueVariantFor(...).keeper`) — never in redraft / dynasty;
 *   - its COMMISSIONER holds AF Commissioner or AF Supreme (./keeperCommissionerPlan) — the commissioner's plan
 *     unlocks it for the whole league, so every member viewing the card sees it;
 *   - the league prices keepers by round (`round_based` / `inflation`; `free` says so; auction: absent).
 *
 * Native leagues: the eligibility engine's own derivation (./eligibilityEngine) — the round he last
 * cost (his keeper round if he was kept, else where he was drafted, else a pickup) through
 * `keeperCostRound`. Imported leagues: the imported keeper grid's pricing of the draft history the
 * import stored (`importedCost` below) — no provider call, and no line when that history is missing. The value is the Keepers tab's own measure (./keeperValueReport): his FantasyCalc
 * market rank, read DB-first (./keeperMarketValues), against the pick his round uses. NFL only.
 *
 * Never throws: a keeper line that cannot be read is absent, not an error on the card.
 */

import { prisma } from '@/lib/prisma'
import { leagueVariantFor } from '@/lib/core-app/valueBook'
import { keeperNameKey, keeperPlayerKeys } from './keeperPlayerKey'
import { keeperCostRound, resolveKeeperRules, type KeeperRules } from './keeperRules'
import { measureKeeperCostRule, type KeeperDraftPick } from './importedKeeperCost'
import { buildKeeperGrid, historyByPlayer } from '@/lib/import-assist/keeperGrid'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { commissionerHasKeeperAutomation } from './keeperCommissionerPlan'
import { loadKeeperMarketRanks } from './keeperMarketValues'
import { describeKeeperCardCost, type PlayerKeeperCost, type PlayerKeeperCostBasis } from './keeperCardCostLine'

export type { PlayerKeeperCost } from './keeperCardCostLine'

type Subject = { leagueId: string; sleeperId: string | null; externalId: string | null; name: string; position: string | null }

export async function loadPlayerKeeperCardCost(subject: Subject): Promise<PlayerKeeperCost | null> {
  try {
    const league = await prisma.league.findUnique({
      where: { id: subject.leagueId },
      select: {
        userId: true, sport: true, settings: true, leagueType: true, leagueSize: true, scoringPresetId: true,
        keeperCostSystem: true, keeperRoundPenalty: true, keeperInflationRate: true, keeperConflictRule: true,
        platform: true, season: true, keeperWaiverAllowed: true, keeperMaxYears: true,
      },
    })
    if (!league || !leagueVariantFor(league.settings, league.leagueType).keeper) return null
    if (!(await commissionerHasKeeperAutomation(league.userId))) return null

    const rules = resolveKeeperRules(league)
    if (rules.costSystem === 'auction_value') return null
    if (rules.costSystem === 'free') {
      return { costRound: null, canKeep: true, headline: 'Keeper cost: free', detail: 'This league charges no pick to keep a player', value: null }
    }

    const priced = isNativePlatform(league.platform)
      ? await nativeCost(subject, rules)
      : await importedCost(subject, rules, league)
    if (!priced) return null
    if ('blocked' in priced) {
      return { costRound: null, canKeep: false, headline: 'Can’t be kept', detail: priced.blocked, value: null }
    }
    const { cost, basis, lastRound, note } = priced

    const teams = league.leagueSize && league.leagueSize >= 2 ? league.leagueSize : null
    let valuation: Parameters<typeof describeKeeperCardCost>[0]['valuation'] = null
    if (cost.ok && teams) {
      const rankOf = await loadKeeperMarketRanks(league, teams).catch(() => null)
      if (rankOf) valuation = { marketRank: rankOf({ playerId: subject.sleeperId ?? subject.externalId ?? '', name: subject.name, position: subject.position }), teams }
    }
    const line = describeKeeperCardCost({ rules, cost, basis, lastRound, valuation })
    return note ? { ...line, detail: `${line.detail} · ${note}` } : line
  } catch {
    return null
  }
}

type Priced =
  | { cost: { ok: boolean; costRound: number }; basis: PlayerKeeperCostBasis; lastRound: number | null; note: string | null }
  | { blocked: string }

/** A native league: its own draft picks and locked keeper records (./eligibilityEngine's derivation). */
async function nativeCost(subject: Subject, rules: KeeperRules): Promise<Priced | null> {
  const ids = [subject.sleeperId, subject.externalId].map((v) => v?.trim()).filter((v): v is string => Boolean(v))
  const keys = new Set([...ids, keeperNameKey(subject.name, subject.position)])
  const matches = (row: { playerId?: string | null; playerName?: string | null; position?: string | null }) =>
    keeperPlayerKeys(row).some((k) => keys.has(k))
  const who = { OR: [...(ids.length ? [{ playerId: { in: ids } }] : []), { playerName: subject.name }] }

  const [keeps, picks, latestDraft] = await Promise.all([
    prisma.keeperRecord.findMany({
      where: { leagueId: subject.leagueId, status: 'locked', ...who },
      select: { playerId: true, playerName: true, position: true, costRound: true },
      orderBy: { lockedAt: 'desc' },
    }),
    prisma.draftPick.findMany({
      where: { session: { leagueId: subject.leagueId }, ...who },
      select: { playerId: true, playerName: true, position: true, round: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.draftSession.findFirst({
      where: { leagueId: subject.leagueId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { rounds: true },
    }),
  ])
  const myKeeps = keeps.filter(matches)
  const lastKept = myKeeps.find((k) => k.costRound != null)?.costRound ?? null
  const drafted = picks.find(matches)?.round ?? null
  const lastRound = lastKept ?? drafted
  const basis: PlayerKeeperCostBasis = lastKept != null ? 'kept' : drafted != null ? 'drafted' : 'waiver'
  const totalRounds = latestDraft?.rounds ?? Math.max(15, drafted ?? 1)
  const cost = keeperCostRound(rules, { lastRound, yearsKept: myKeeps.length, totalRounds })

  return { cost, basis, lastRound, note: null }
}

/**
 * An IMPORTED league (Sleeper, ESPN, Yahoo, MFL, Fleaflicker, Fantrax): the keeper grid's own pricing
 * (lib/import-assist/keeperGrid.ts `buildKeeperGrid` — the league's rules as set in AllFantasy against
 * the draft history the import stored in `dw_draft_facts`). DB-first; no provider is called.
 *
 * No line rather than a guess: no draft on file, a latest draft older than last season, or (outside
 * Sleeper, whose draft facts and card ids share one id space) a player the history does not name.
 */
async function importedCost(
  subject: Subject,
  rules: KeeperRules,
  league: { platform: string | null; season: number | null; keeperWaiverAllowed: boolean | null; keeperMaxYears: number | null },
): Promise<Priced | null> {
  const facts = await prisma.draftFact.findMany({
    where: { leagueId: subject.leagueId, season: { not: null } },
    select: { playerId: true, season: true, round: true, metadata: true },
  })
  const picks: KeeperDraftPick[] = facts.map((r) => ({
    playerId: r.playerId,
    season: r.season as number,
    round: r.round,
    isKeeper: !!r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata) && (r.metadata as Record<string, unknown>).isKeeper === true,
  }))
  const history = historyByPlayer(picks)
  if (history.season == null || history.totalRounds === 0) return null
  if (league.season != null && history.season < league.season - 1) return null

  const sleeper = String(league.platform ?? '').toLowerCase() === 'sleeper'
  const ids = [subject.sleeperId, subject.externalId].map((v) => v?.trim()).filter((v): v is string => Boolean(v))
  const id = ids.find((x) => history.last.has(x)) ?? (sleeper ? subject.sleeperId : null)
  if (!id) return null

  const grid = buildKeeperGrid({
    rules,
    picks,
    measured: measureKeeperCostRule(picks),
    teams: [{ teamId: 'card', name: '', playerIds: [id] }],
    names: new Map([[id, subject.name]]),
    waiverPickupsAllowed: league.keeperWaiverAllowed !== false,
    maxYears: league.keeperMaxYears != null && league.keeperMaxYears > 0 ? league.keeperMaxYears : null,
  })
  const row = grid?.teams[0]?.players[0]
  if (!row) return null
  if (row.blocked) return { blocked: row.blocked }
  if (row.costRound == null) return null
  const last = history.last.get(id) ?? null
  return {
    cost: { ok: true, costRound: row.costRound },
    basis: last ? (last.kept ? 'kept' : 'drafted') : 'waiver',
    lastRound: last?.round ?? null,
    note: `from the league's imported ${history.season} draft`,
  }
}
