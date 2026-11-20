/**
 * Turn trades read from Fantrax's "Transaction History → Trade" export (`./fantraxTradeHistoryCsv.ts`) into the
 * `LeagueTrade` writer's input (`persistTradesForSeason`), for one already-imported Fantrax NFL league.
 *
 * WHY THESE ARE COMPLETED TRADES, though `isCompletedTrade('fantrax')` answers false: that predicate guards trades
 * INFERRED from roster snapshots, which carry no proof they happened. This export is Fantrax's own record of
 * accepted trades, so its provenance is the platform itself.
 *
 * 🛑 ALL OR NOTHING PER TRADE. A trade with one player, pick owner or team that cannot be placed is refused whole,
 * with the reason. Writing the rest would store a lighter side, and the grader would price it as the whole deal.
 *
 * PLAYERS are matched to the league's id space (Fantrax ids), because that is how a Fantrax league's `LeagueTrade`
 * rows are read back (`playerIdSpaceFor` → `PlayerIdentityMap.fantraxId`). Only registry rows that ALREADY carry a
 * Fantrax id are candidates — a player we cannot read back is no better than one we could not match. The rule is
 * the NFL Fantrax linker's (`lib/player-identity/nflFantraxIdentityPlan.ts`): exact normalized name, then the
 * export's NFL team and a compatible position when it gives them. Exactly one candidate, or the trade is refused.
 * ⚠ The export's Position column is the roster SLOT for some players ("SFX" for a superflex QB), which is no
 * position at all — it is then simply not used, rather than read as a mismatch.
 *
 * TEAMS are matched by display name (`normalizeFantraxTeamName`, the importer's own key): the name exactly as the
 * export writes it first, then — only when no team has that exact name — both sides with a leading "#N " removed.
 * 🛑 THE "#N" IS PART OF THE NAME IN SOME LEAGUES ("#27 Harbor Owls" is stored that way) and a standings number in
 * others; stripping it unconditionally matched none of the first real league's teams. Two teams sharing a name, at
 * either step, is ambiguous and refused.
 *
 * Only TWO-TEAM trades are written: `LeagueTrade` is one row per side with one partner, and the completed-trade
 * grade grades two teams. A three-team trade is reported, not flattened.
 *
 * Pure (no I/O).
 */
import { nflPositionGroups, nflTeamCode, fantraxNflNameKey } from '@/lib/player-identity/nflFantraxIdentityPlan'
import { proTeamCode, proRolesAgree } from '@/lib/player-identity/proFantraxIdentityPlan'
import { cfbdScheduleTeamKeys } from '@/lib/sports-data/collegeTeamNames'
import type { SupportedSport } from '@/lib/sport-scope'
import { normalizePlayerName } from '@/lib/team-abbrev'
import type { NormalizedTradeFact } from '@/lib/dynasty-import/types'
import { normalizeFantraxTeamName } from './fantraxTeamIds'
import { stripFantraxStandingPrefix, type FantraxCsvTrade } from './fantraxTradeHistoryCsv'

/** One of the AF league's teams, as the Fantrax importer wrote it (`LeagueTeam`). */
export type FantraxLeagueTeamRef = { externalId: string; teamName: string | null; platformUserId: string | null }

/** A registry row that carries a Fantrax id (`PlayerIdentityMap`, NFL). */
export type FantraxIdentityRow = { fantraxId: string; canonicalName: string; currentTeam: string | null; position: string | null }

export type FantraxPlannedTrade = { fact: NormalizedTradeFact; dateText: string; teams: string[] }
export type FantraxRefusedTrade = { dateText: string; teams: string[]; reasons: string[] }

export type FantraxTradeHistoryPlan = {
  ready: FantraxPlannedTrade[]
  refused: FantraxRefusedTrade[]
  /** roster id (LeagueTeam.externalId) → owner id (LeagueTeam.platformUserId), for `persistTradesForSeason`. */
  rosterIdToOwner: Map<string, string>
}

/**
 * The NFL season a trade belongs to: the calendar year of its US Eastern date, except January and February, which
 * finish the season before. Dynasty leagues trade all winter; a 2027 pick traded in February 2027 is a 2026-season
 * trade.
 */
export function nflSeasonForTradeDate(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric' }).formatToParts(at)
  const year = Number(parts.find((p) => p.type === 'year')?.value)
  const month = Number(parts.find((p) => p.type === 'month')?.value)
  return month <= 2 ? year - 1 : year
}

function seasonForFantraxTrade(sport: SupportedSport, date: Date): number {
  if (sport === 'NFL' || sport === 'NCAAF') return nflSeasonForTradeDate(date)
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(date)
  const year = Number(day.find((p) => p.type === 'year')?.value)
  const month = Number(day.find((p) => p.type === 'month')?.value)
  return sport === 'MLB' || month >= 7 ? year : year - 1
}

function teamIndex(teams: readonly FantraxLeagueTeamRef[]) {
  const exact = new Map<string, FantraxLeagueTeamRef[]>()
  const stripped = new Map<string, FantraxLeagueTeamRef[]>()
  const add = (m: Map<string, FantraxLeagueTeamRef[]>, key: string, t: FantraxLeagueTeamRef) => {
    if (key) m.set(key, [...(m.get(key) ?? []), t])
  }
  for (const t of teams) {
    add(exact, normalizeFantraxTeamName(t.teamName ?? ''), t)
    add(stripped, normalizeFantraxTeamName(stripFantraxStandingPrefix(t.teamName ?? '')), t)
  }
  return (label: string): FantraxLeagueTeamRef | string => {
    // The exact name decides whenever any team carries it; the stripped form is consulted only when none does.
    const exactHits = exact.get(normalizeFantraxTeamName(label)) ?? []
    const hits = exactHits.length ? exactHits : stripped.get(normalizeFantraxTeamName(stripFantraxStandingPrefix(label))) ?? []
    if (hits.length === 1) return hits[0]!
    return hits.length === 0 ? `No team in this league is named "${label}".` : `Two teams in this league are named "${label}".`
  }
}

function playerIndex(rows: readonly FantraxIdentityRow[], sport: SupportedSport) {
  const byName = new Map<string, FantraxIdentityRow[]>()
  for (const row of rows) {
    const key = normalizePlayerName(row.canonicalName ?? '')
    if (key && row.fantraxId?.trim()) byName.set(key, [...(byName.get(key) ?? []), row])
  }
  return (name: string, proTeam: string | null, position: string | null): string | { problem: string } => {
    const label = [name, proTeam, position].filter(Boolean).join(' ')
    let candidates = byName.get(fantraxNflNameKey(name)) ?? []
    if (sport !== 'NFL') {
      const teamKey = (team: string | null) => sport === 'NCAAB' || sport === 'NCAAF'
        ? cfbdScheduleTeamKeys(team).exact : proTeamCode(sport, team) ?? normalizePlayerName(team ?? '')
      if (proTeam) {
        const expected = teamKey(proTeam)
        candidates = candidates.filter((row) => expected && teamKey(row.currentTeam) === expected)
      }
      if (sport === 'NCAAF') {
        const roles = nflPositionGroups(position)
        if (roles.size) candidates = candidates.filter(row => [...nflPositionGroups(row.position)].some(role => roles.has(role)))
      } else {
        candidates = candidates.filter(row => proRolesAgree(sport === 'NCAAB' ? 'NBA' : sport, position, row.position))
      }
      const unique = new Set(candidates.map((row) => row.fantraxId))
      return unique.size === 1 ? [...unique][0]! : { problem: label + ' has no unique verified Fantrax identity in this sport.' }
    }
    const team = nflTeamCode(proTeam)
    if (team) candidates = candidates.filter((row) => nflTeamCode(row.currentTeam) === team)
    const roles = nflPositionGroups(position)
    if (roles.size) candidates = candidates.filter((row) => [...nflPositionGroups(row.position)].some((g) => roles.has(g)))
    const ids = [...new Set(candidates.map((row) => row.fantraxId.trim()))]
    if (ids.length === 1) return ids[0]!
    return { problem: ids.length === 0 ? `${label} could not be matched to a player with a Fantrax id.` : `${label} matches more than one player.` }
  }
}

export function planFantraxTradeHistoryImport(args: {
  trades: readonly FantraxCsvTrade[]
  teams: readonly FantraxLeagueTeamRef[]
  identities: readonly FantraxIdentityRow[]
  /** Overrides `nflSeasonForTradeDate` for every trade — for an export the caller knows to be one season. */
  season?: number
  sport?: SupportedSport
}): FantraxTradeHistoryPlan {
  const teamOf = teamIndex(args.teams)
  const sport = args.sport ?? 'NFL'
  const playerOf = playerIndex(args.identities, sport)
  const rosterIdToOwner = new Map<string, string>()
  for (const t of args.teams) if (t.platformUserId?.trim()) rosterIdToOwner.set(t.externalId, t.platformUserId.trim())

  const ready: FantraxPlannedTrade[] = []
  const refused: FantraxRefusedTrade[] = []
  for (const trade of args.trades) {
    const reasons: string[] = []
    if (trade.teams.length !== 2) {
      refused.push({ dateText: trade.dateText, teams: trade.teams, reasons: ['Only two-team trades are imported.'] })
      continue
    }
    const rosterOf = new Map<string, string>()
    for (const label of trade.teams) {
      const team = teamOf(label)
      if (typeof team === 'string') reasons.push(team)
      else if (!rosterIdToOwner.has(team.externalId)) reasons.push(`"${label}" has no manager on file in this league.`)
      else rosterOf.set(label, team.externalId)
    }

    const adds: Record<string, string> = {}
    const drops: Record<string, string> = {}
    const draftPicks: NormalizedTradeFact['draftPicks'] = []
    const waiverBudget: NonNullable<NormalizedTradeFact['waiverBudget']> = []
    if (!reasons.length) {
      for (const move of trade.moves) {
        const from = rosterOf.get(move.from)!
        const to = rosterOf.get(move.to)!
        const a = move.asset
        if (a.kind === 'player') {
          const id = playerOf(a.name, a.proTeam, a.position)
          if (typeof id !== 'string') { reasons.push(id.problem); continue }
          if (adds[id]) { reasons.push(`${a.name} moves twice in one trade.`); continue }
          adds[id] = to
          drops[id] = from
        } else if (a.kind === 'pick') {
          // The original owner is a team in the league, not necessarily in this trade.
          const original = teamOf(a.originalOwner)
          if (typeof original === 'string') { reasons.push(original); continue }
          draftPicks.push({ season: String(a.season), round: a.round, rosterId: original.externalId, previousOwnerId: from, ownerId: to })
        } else {
          waiverBudget.push({ sender: from, receiver: to, amount: a.amount })
        }
      }
    }
    if (reasons.length) {
      refused.push({ dateText: trade.dateText, teams: trade.teams, reasons })
      continue
    }
    ready.push({
      dateText: trade.dateText,
      teams: trade.teams,
      fact: {
        transactionId: trade.transactionId,
        season: args.season ?? seasonForFantraxTrade(sport, trade.tradeDate),
        week: trade.week ?? 0,
        rosterIds: trade.teams.map((label) => rosterOf.get(label)!),
        adds: Object.keys(adds).length ? adds : null,
        drops: Object.keys(drops).length ? drops : null,
        draftPicks,
        // Read from the whole trade, so 0 both ways is a fact, not "unknown".
        waiverBudget,
        created: trade.tradeDate.getTime(),
        creator: '',
      },
    })
  }
  return { ready, refused, rosterIdToOwner }
}
