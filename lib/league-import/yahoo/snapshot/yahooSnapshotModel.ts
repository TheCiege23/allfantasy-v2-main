/**
 * Pure model for a pasted Yahoo league: which league, which pages, what is still missing, how a new
 * page merges in, and how the whole thing becomes the SAME `YahooImportPayload` the API path builds.
 *
 * 🛑 THE OUTPUT SHAPE IS THE POINT. A pasted league goes through `YahooAdapter` and the ordinary
 * preview/commit pipeline unchanged, so it is stored exactly like an API import — and its
 * `platformLeagueId` is `nfl.l.<id>`, the form `fetchYahooLeagueForImport` already accepts. Once Yahoo
 * approves the app and the commissioner connects, the existing syncs can read this league directly.
 *
 * ⚠ TEAM KEYS ARE PROVISIONAL. Copied page text carries no Yahoo team numbers, so teams are keyed by
 * standings order (`nfl.l.<id>.t.<n>`). A later API import must match teams by NAME, not by key.
 *
 * ⚠ PLAYER IDS ARE SYNTHETIC (`yahoo-paste:<name>|<pos>|<team>`). That is no weaker than the API
 * path: our player tables hold no Yahoo ids at all, so Yahoo players resolve by name, position and
 * NFL team either way, from the `playerMap` built here.
 */
import { normalizePlayerName } from '@/lib/team-abbrev'
import type {
  YahooImportDraftPick,
  YahooImportPayload,
  YahooImportSettings,
  YahooImportTeam,
} from '@/lib/league-import/adapters/yahoo/types'
import type {
  YahooLeagueSnapshot,
  YahooSnapshotExtraction,
  YahooSnapshotPageKind,
  YahooSnapshotRoster,
} from './yahooSnapshotTypes'

const YAHOO_SNAPSHOT_SOURCE_PREFIX = 'yahoo-snapshot:'
/** Stamped into `settings.raw.source`, which the adapter carries to `league.yahoo_settings`. */
const YAHOO_SNAPSHOT_RAW_SOURCE = 'yahoo_paste_snapshot'

/** `yahoo-snapshot:<id>` is how a pasted league travels through preview and commit as a `sourceId`. */
export function yahooSnapshotSourceId(leagueId: string): string {
  return `${YAHOO_SNAPSHOT_SOURCE_PREFIX}${leagueId}`
}

/** The numeric league id inside a snapshot source id, or null when this is not one. */
export function parseYahooSnapshotSourceId(sourceId: string | null | undefined): string | null {
  const m = String(sourceId ?? '').trim().match(/^yahoo-snapshot:(\d{1,12})$/)
  return m ? m[1]! : null
}

export function isYahooSnapshotSourceId(sourceId: string | null | undefined): boolean {
  return parseYahooSnapshotSourceId(sourceId) !== null
}

/** True when an already-normalized import came from a paste, not the API. */
export function isYahooSnapshotYahooSettings(yahooSettings: unknown): boolean {
  return (
    !!yahooSettings &&
    typeof yahooSettings === 'object' &&
    (yahooSettings as Record<string, unknown>).source === YAHOO_SNAPSHOT_RAW_SOURCE
  )
}

/**
 * The Yahoo league id from whatever the commissioner has: a league URL, a team URL, a league key,
 * or the bare number. NFL only — a basketball or baseball URL is refused rather than misread, because
 * Yahoo import supports NFL alone today.
 */
export function parseYahooLeagueId(raw: string | null | undefined): string | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  if (/fantasysports\.yahoo\.com/i.test(text)) {
    const m = text.match(/football\.fantasysports\.yahoo\.com\/f1\/(\d{1,12})(?:[/?#]|$)/i)
    return m ? m[1]! : null
  }
  const key = text.match(/^(?:nfl|\d{2,4})\.l\.(\d{1,12})$/i)
  if (key) return key[1]!
  return /^\d{1,12}$/.test(text) ? text : null
}

/*
 * ⚠ PAGE PATHS ARE UNVERIFIED AGAINST A LOGGED-IN YAHOO SESSION. `/f1/<id>` and `/f1/<id>/<team>`
 * are the forms real pasted links in this repo use (see scripts/probe-yahoo-pending-trades.ts);
 * `/settings` and `/draftresults` are Yahoo's long-standing league pages. Confirm on a real league
 * and correct HERE — the panel and the tests both read this one table.
 */
const YAHOO_FOOTBALL_BASE = 'https://football.fantasysports.yahoo.com/f1'

function yahooSnapshotPageUrl(leagueId: string, page: YahooSnapshotPageKind, teamNumber?: number): string {
  if (page === 'settings') return `${YAHOO_FOOTBALL_BASE}/${leagueId}/settings`
  if (page === 'draft') return `${YAHOO_FOOTBALL_BASE}/${leagueId}/draftresults`
  if (page === 'roster') return `${YAHOO_FOOTBALL_BASE}/${leagueId}/${teamNumber ?? 1}`
  return `${YAHOO_FOOTBALL_BASE}/${leagueId}`
}

/** Lowercase and collapse everything that is not a letter or digit — for matching team names only. */
function normalizeSnapshotTeamName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Fold one extracted page into the snapshot. Re-pasting a page REPLACES it; nothing accumulates. */
export function mergeYahooSnapshotPage(
  snapshot: YahooLeagueSnapshot,
  page: Exclude<YahooSnapshotExtraction, { kind: 'unknown' }>,
  now: Date = new Date(),
): YahooLeagueSnapshot {
  const next: YahooLeagueSnapshot = { ...snapshot, rosters: { ...snapshot.rosters }, updatedAt: now.toISOString() }
  if (page.kind === 'settings') next.settings = page
  else if (page.kind === 'standings') next.standings = page
  else if (page.kind === 'draft') next.draft = page
  else next.rosters[normalizeSnapshotTeamName(page.teamName)] = page
  return next
}

export interface YahooSnapshotChecklist {
  leagueId: string
  leagueName: string | null
  settings: boolean
  standings: boolean
  draft: boolean
  /** Teams named on the standings page — the roster list to work through. */
  /*
   * No per-team Yahoo link: pasted text carries no Yahoo team numbers, and standings order is not
   * Yahoo's numbering, so any link built here could open the wrong team. Teams are reached from the
   * standings page on Yahoo instead.
   */
  teams: Array<{ name: string; hasRoster: boolean }>
  /** Rosters pasted for a team the standings do not name — almost always a typo'd or renamed team. */
  unmatchedRosters: string[]
  /** Settings and standings are the minimum for an importable league. */
  ready: boolean
  missing: string[]
  links: { settings: string; standings: string; draft: string }
}

function orderedStandingsTeams(snapshot: YahooLeagueSnapshot) {
  const teams = snapshot.standings?.teams ?? []
  return teams
    .map((team, index) => ({ team, index }))
    .sort((a, b) => (a.team.rank ?? a.index + 1) - (b.team.rank ?? b.index + 1) || a.index - b.index)
    .map(({ team }) => team)
}

/** Does one normalized name extend the other at a word boundary ("4th short" / "4th short darren")? */
function extendsAtWordBoundary(a: string, b: string): boolean {
  if (!a || !b || a === b) return false
  return a.startsWith(`${b} `) || b.startsWith(`${a} `)
}

/**
 * The ONE standings team (normalized name) a name read from another page belongs to, or null.
 *
 * 🛑 EXACT FIRST, THEN A UNIQUE WORD-BOUNDARY PREFIX — NEVER A GUESS. Measured on a real league
 * 2026-11-15: Yahoo's default team names carry the manager's first name ("4th & Short Darren"), and
 * the roster page also prints that manager on its own line, so the reader returned "4th & Short" and
 * the roster matched nothing. A name that extends, or is extended by, exactly one team's name now
 * matches it. Two candidates, or a team another roster already holds, means no match: an unmatched
 * roster is reported to the commissioner, a wrongly matched one silently moves players between teams.
 */
function resolveSnapshotTeam(
  teamNorms: readonly string[],
  name: string,
  taken?: ReadonlySet<string>,
): string | null {
  const norm = normalizeSnapshotTeamName(name)
  if (!norm) return null
  if (teamNorms.includes(norm)) return norm
  const candidates = teamNorms.filter((t) => !taken?.has(t) && extendsAtWordBoundary(t, norm))
  return candidates.length === 1 ? candidates[0]! : null
}

/** Each standings team's pasted roster: exact names first, so a prefix match can never take a team an exact one owns. */
function matchRostersToTeams(snapshot: YahooLeagueSnapshot): {
  byTeam: Map<string, YahooSnapshotRoster>
  unmatched: YahooSnapshotRoster[]
} {
  const teamNorms = orderedStandingsTeams(snapshot).map((t) => normalizeSnapshotTeamName(t.teamName))
  const byTeam = new Map<string, YahooSnapshotRoster>()
  const pending: YahooSnapshotRoster[] = []
  for (const [key, roster] of Object.entries(snapshot.rosters)) {
    if (teamNorms.includes(key)) byTeam.set(key, roster)
    else pending.push(roster)
  }
  const unmatched: YahooSnapshotRoster[] = []
  for (const roster of pending) {
    const team = resolveSnapshotTeam(teamNorms, roster.teamName, new Set(byTeam.keys()))
    if (team) byTeam.set(team, roster)
    else unmatched.push(roster)
  }
  return { byTeam, unmatched }
}

export function yahooSnapshotChecklist(snapshot: YahooLeagueSnapshot): YahooSnapshotChecklist {
  const teams = orderedStandingsTeams(snapshot)
  const { byTeam, unmatched } = matchRostersToTeams(snapshot)
  const missing: string[] = []
  if (!snapshot.settings) missing.push('League settings')
  if (!snapshot.standings) missing.push('Standings')
  return {
    leagueId: snapshot.leagueId,
    leagueName: snapshot.settings?.leagueName ?? null,
    settings: !!snapshot.settings,
    standings: !!snapshot.standings,
    draft: !!snapshot.draft,
    teams: teams.map((t) => ({
      name: t.teamName,
      hasRoster: byTeam.has(normalizeSnapshotTeamName(t.teamName)),
    })),
    unmatchedRosters: unmatched.map((roster) => roster.teamName),
    ready: missing.length === 0,
    missing,
    links: {
      settings: yahooSnapshotPageUrl(snapshot.leagueId, 'settings'),
      standings: yahooSnapshotPageUrl(snapshot.leagueId, 'standings'),
      draft: yahooSnapshotPageUrl(snapshot.leagueId, 'draft'),
    },
  }
}

const BENCH_SLOTS = new Set(['BN', 'BE', 'BENCH'])
function isReserveSlot(slot: string): boolean {
  return /^(IR|IL|NA|DL)/.test(slot.toUpperCase())
}

function snapshotPlayerId(playerName: string, position?: string | null, nflTeam?: string | null): string {
  return `yahoo-paste:${normalizePlayerName(playerName)}|${String(position ?? '').toUpperCase()}|${String(nflTeam ?? '').toUpperCase()}`
}

/** The NFL season a date belongs to: Jan–Feb still count as the previous season. */
function currentNflSeason(now: Date): number {
  const y = now.getUTCFullYear()
  return now.getUTCMonth() < 2 ? y - 1 : y
}

const GROUP_POSITION_TYPE: Record<string, string | null> = { offense: 'O', kickers: 'K', defense: 'DT', other: null }

export class YahooSnapshotIncompleteError extends Error {}

/**
 * Snapshot → the payload `YahooAdapter.normalize` takes. Throws `YahooSnapshotIncompleteError` unless
 * settings AND standings are present — those two are the importable minimum.
 */
export function buildYahooSnapshotPayload(snapshot: YahooLeagueSnapshot, now: Date = new Date()): YahooImportPayload {
  const { settings, standings } = snapshot
  if (!settings || !standings) {
    throw new YahooSnapshotIncompleteError(
      `Paste your league's ${!settings ? 'settings' : 'standings'} page before importing.`,
    )
  }

  const leagueKey = `nfl.l.${snapshot.leagueId}`
  const ordered = orderedStandingsTeams(snapshot)
  const teamKeyByName = new Map<string, string>()
  const { byTeam: rosterByTeam } = matchRostersToTeams(snapshot)
  const teams: YahooImportTeam[] = ordered.map((t, i) => {
    const teamKey = `${leagueKey}.t.${i + 1}`
    const norm = normalizeSnapshotTeamName(t.teamName)
    teamKeyByName.set(norm, teamKey)
    const roster: YahooSnapshotRoster | undefined = rosterByTeam.get(norm)
    const playerMap: YahooImportTeam['playerMap'] = {}
    const rosterIds: string[] = []
    const starterIds: string[] = []
    const reserveIds: string[] = []
    for (const p of roster?.players ?? []) {
      const id = snapshotPlayerId(p.playerName, p.position, p.nflTeam)
      if (playerMap[id]) continue
      playerMap[id] = { name: p.playerName, position: String(p.position ?? '').toUpperCase(), team: String(p.nflTeam ?? '').toUpperCase() }
      rosterIds.push(id)
      const slot = p.slot.toUpperCase()
      if (isReserveSlot(slot)) reserveIds.push(id)
      else if (!BENCH_SLOTS.has(slot)) starterIds.push(id)
    }
    return {
      teamKey,
      teamId: String(i + 1),
      managerId: '',
      managerGuid: null,
      managerName: t.managerName ?? roster?.managerName ?? '',
      teamName: t.teamName,
      logoUrl: null,
      wins: t.wins ?? 0,
      losses: t.losses ?? 0,
      ties: t.ties ?? 0,
      rank: t.rank ?? i + 1,
      pointsFor: t.pointsFor ?? 0,
      pointsAgainst: t.pointsAgainst ?? null,
      faabBalance: null,
      waiverPriority: null,
      clinchedPlayoffs: false,
      rosterPlayerIds: rosterIds,
      starterPlayerIds: starterIds,
      reservePlayerIds: reserveIds,
      minorsPlayerIds: [],
      playerMap,
      /* IMP-04: a team with no pasted roster is a placeholder, never "this team has nobody". */
      rosterFetchStatus: roster ? 'fetched' : 'failed',
    }
  })

  const statCategories: YahooImportSettings['statCategories'] = []
  const statModifiers: YahooImportSettings['statModifiers'] = []
  settings.scoring.forEach((row, i) => {
    const statId = `paste_${i + 1}`
    statCategories.push({
      statId,
      name: row.name,
      displayName: row.name,
      enabled: true,
      positionType: GROUP_POSITION_TYPE[row.group] ?? null,
    })
    statModifiers.push({ statId, value: row.points })
  })

  const usesPlayoff =
    settings.playoffTeams != null ? settings.playoffTeams > 0 : settings.playoffStartWeek != null ? true : null

  const importSettings: YahooImportSettings = {
    draftType: settings.draftType ?? null,
    scoringType: settings.scoringType ?? null,
    usesPlayoff,
    playoffStartWeek: settings.playoffStartWeek ?? null,
    usesPlayoffReseeding: null,
    usesLockEliminatedTeams: null,
    usesFaab: settings.usesFaab ?? null,
    tradeEndDate: settings.tradeEndDate ?? null,
    tradeRatifyType: null,
    rosterPositions: settings.rosterPositions.map((r) => ({ position: r.position.toUpperCase(), count: r.count })),
    statCategories,
    statModifiers,
    /*
     * 🛑 `stat_categories` IN YAHOO'S OWN RAW SHAPE, NOT A CONVENIENCE SHAPE. This object is persisted
     * as `League.settings.yahoo_settings`, and the scoring bridge (`extractYahooStatCategories` in
     * lib/projections/leagueScoring.ts) and Chimmy's category labels read `stat_categories.stats[].stat`
     * from it to turn `yahoo_stat_<id>` back into "Passing Yards". Leave it out and every pasted rule
     * stays unresolved — the league imports, and its projections score nothing.
     */
    raw: {
      source: YAHOO_SNAPSHOT_RAW_SOURCE,
      snapshot_updated_at: snapshot.updatedAt,
      scoring_type: settings.scoringType ?? null,
      draft_type: settings.draftType ?? null,
      num_playoff_teams: settings.playoffTeams ?? null,
      stat_categories: {
        stats: statCategories.map((c) => ({
          stat: { stat_id: c.statId, enabled: '1', name: c.name, display_name: c.displayName, position_type: c.positionType },
        })),
      },
      stat_modifiers: {
        stats: statModifiers.map((m) => ({ stat: { stat_id: m.statId, value: String(m.value) } })),
      },
    },
  }

  const numTeams = settings.numTeams ?? teams.length
  const draftPicks: YahooImportDraftPick[] = []
  if (snapshot.draft) {
    const perRoundIndex = new Map<number, number>()
    for (const pick of snapshot.draft.picks) {
      const pickTeam = resolveSnapshotTeam([...teamKeyByName.keys()], pick.teamName)
      const teamKey = pickTeam ? teamKeyByName.get(pickTeam) : undefined
      const inRound = (perRoundIndex.get(pick.round) ?? 0) + 1
      perRoundIndex.set(pick.round, inRound)
      if (!teamKey) continue
      draftPicks.push({
        round: pick.round,
        // Overall pick from Yahoo's in-round number (or page order when it is missing).
        pickNumber: (pick.round - 1) * numTeams + (pick.pick ?? inRound),
        teamKey,
        playerId: snapshotPlayerId(pick.playerName, pick.position, pick.nflTeam),
        playerName: pick.playerName,
        position: pick.position ?? null,
        team: pick.nflTeam ?? null,
      })
    }
  }

  return {
    sourceInput: yahooSnapshotSourceId(snapshot.leagueId),
    resolvedFromLeagueList: false,
    league: {
      leagueKey,
      leagueId: snapshot.leagueId,
      name: settings.leagueName,
      sport: 'NFL',
      season: settings.season ?? currentNflSeason(now),
      numTeams,
      draftStatus: draftPicks.length > 0 ? 'postdraft' : null,
      currentWeek: null,
      startWeek: 1,
      endWeek: null,
      isFinished: false,
      url: yahooSnapshotPageUrl(snapshot.leagueId, 'standings'),
    },
    settings: importSettings,
    teams,
    schedule: [],
    scheduleWeeksExpected: null,
    scheduleWeeksCovered: 0,
    transactions: [],
    draftPicks,
    previousSeasons: [],
    viewerTeamKey: null,
    commissionerTeamKeys: [],
    headCommissionerTeamKeys: [],
    failedRosterTeamKeys: teams.filter((t) => t.rosterFetchStatus === 'failed').map((t) => t.teamKey),
  }
}
