import 'server-only'

import { prisma } from '@/lib/prisma'
import { runWithConcurrency } from '@/lib/async-utils'
import { resolveAiTeamContext } from '@/lib/ai-payload/resolveAiTeamContext'
import { resolveRosterPlayerIdentities } from '@/lib/player-identity/resolveRosterPlayerIdentities'
import { resolveInjuryFacts, type InjuryFact, type InjuryLookup } from '@/lib/injuries/injuryReadPort'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { listMemberLeagues } from '@/lib/chimmy/tools/leagueByName'
import type { AiRosterPlayerRef } from '@/lib/ai-payload/types'

/**
 * WHO IS HURT ON THE USER'S OWN ROSTERS, ACROSS EVERY LEAGUE THEY ARE IN.
 *
 * 🛑 "WHO'S OUT IN MY LEAGUES" HAD NO ANSWER ANYWHERE IN CHIMMY. Audited 2026-09-22:
 *
 *   - the deterministic shortcut answered it with the six newest league-wide NFL injuries,
 *     none tied to the asker (fixed separately in lib/ai/deterministic.ts);
 *   - `get_my_roster` reads ONE league, and its injury field comes from a Sleeper-keyed lookup,
 *     so ESPN / Yahoo / MFL / Fantrax / Fleaflicker rosters carried no injury at all;
 *   - no tool spanned leagues except `get_my_starters_playing`, which counts kickoffs.
 *
 * This joins the two pieces that already existed and were never joined: the roster reader
 * (starters / bench / IR / taxi per league) with the any-platform identity lookup
 * (`resolveRosterPlayerIdentities`), then the canonical injury port (`resolveInjuryFacts`) —
 * which refuses ambiguous names and returns report age, so a two-week-old "Questionable" is
 * flagged instead of stated.
 *
 * ⚠ NO INJURY ROW MEANS "NO REPORT", NEVER "HEALTHY". The output says so, and every gap that
 * could hide an injury (an unreadable league, an unnamed player, an ambiguous name, a sport with
 * no injury source) is reported with the direction it moves the answer.
 */

/** Same cap and reasoning as the starters tool: a roster read is several queries. */
const MAX_LEAGUES_SCANNED = 40
const ROSTER_CONCURRENCY = 6

type Slot = 'starter' | 'bench' | 'IR' | 'taxi'

type RosterEntry = {
  leagueName: string
  slot: Slot
  name: string | null
  position: string | null
  team: string | null
  /** From the Sleeper player feed via the roster reader. Undated — secondary evidence only. */
  feedStatus: string | null
}

/** Statuses that carry no injury claim. A feed "Active" is the absence of news, not news. */
const NON_INJURY_STATUS = /^(?:active|healthy|none|na|n\/a|probable|-)?$/i

/** Most actionable first. Anything unlisted sorts after these. */
const SEVERITY: Array<[RegExp, number]> = [
  [/^out\b|\bout$/i, 0],
  [/\bir\b|injured reserve|pup|nfi|suspen/i, 1],
  [/doubtful/i, 2],
  [/questionable|day[- ]to[- ]day|gtd|game[- ]time/i, 3],
]

function severityOf(status: string): number {
  for (const [re, rank] of SEVERITY) if (re.test(status)) return rank
  return 4
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function refsWithSlot(refs: AiRosterPlayerRef[], slot: Slot, leagueName: string): Array<RosterEntry & { playerId: string }> {
  return refs.map((r) => ({
    playerId: r.playerId,
    leagueName,
    slot,
    name: r.name,
    position: r.position,
    team: r.team,
    feedStatus: r.injuryStatus ?? null,
  }))
}

export interface MyRosterInjuriesInput {
  userId: string
  /** Limit to one sport (e.g. 'NFL'). Omitted: every sport the user has a current league in. */
  sport?: string | null
}

type LeagueRead =
  | { state: 'unreadable'; leagueName: string }
  | { state: 'empty'; leagueName: string }
  | { state: 'read'; leagueName: string; sport: string; entries: RosterEntry[]; unnamed: number }

type Finding = {
  name: string
  position: string | null
  team: string | null
  status: string
  detail: string | null
  /** Null when the only evidence is the undated Sleeper feed status. */
  reportedAt: Date | null
  stale: boolean
  appearances: Array<{ leagueName: string; slot: Slot }>
}

/**
 * Prose for the model, or a sentence saying why there is no answer.
 *
 * Never throws — a tool that blew up must come back as words, because an exception here
 * aborts a conversation somebody is waiting on.
 */
export async function buildMyRosterInjuriesContext(input: MyRosterInjuriesInput): Promise<string> {
  const { userId } = input
  if (!userId) {
    return 'I cannot tell who is signed in, so I cannot read their leagues. Say that; do not name a player or a league.'
  }
  const sportFilter = input.sport ? String(input.sport).trim().toUpperCase() : null

  const leagues = (await listMemberLeagues(userId).catch(() => [])).filter(
    (l) => !sportFilter || String(l.sport).toUpperCase() === sportFilter,
  )
  if (leagues.length === 0) {
    return sportFilter
      ? `This user has NO ${sportFilter} leagues on file, so there are no rosters to check. Say that plainly — it is not a claim that nobody is hurt.`
      : 'This user has NO leagues on file, so there are no rosters to check. Say that plainly — it is not a claim that nobody is hurt.'
  }

  /*
   * ⚠ CURRENT SEASON ONLY, PER SPORT. A league list spans years; last season's copy of a
   * league holds last season's roster, and reporting its injuries as "your players" names
   * people the user may no longer roster at all.
   */
  const newestBySport = new Map<string, number>()
  for (const l of leagues) {
    const s = String(l.sport).toUpperCase()
    newestBySport.set(s, Math.max(newestBySport.get(s) ?? l.season, l.season))
  }
  const current = leagues.filter((l) => newestBySport.get(String(l.sport).toUpperCase()) === l.season)
  const scanned = current.slice(0, MAX_LEAGUES_SCANNED)
  const truncated = current.length - scanned.length

  const platformRows = await prisma.league
    .findMany({ where: { id: { in: scanned.map((l) => l.id) } }, select: { id: true, platform: true } })
    .catch(() => [] as Array<{ id: string; platform: string }>)
  const platformOf = new Map(platformRows.map((r) => [r.id, r.platform]))

  const reads: LeagueRead[] = await runWithConcurrency(scanned, ROSTER_CONCURRENCY, async (league) => {
    const sport = String(league.sport).toUpperCase()
    const team = await resolveAiTeamContext({
      userId,
      leagueId: league.id,
      sport,
      season: league.season,
      /* Week 1 floor, as in the starters tool: this asks who is ON the roster, not a matchup. */
      currentPeriod: 1,
    }).catch(() => null)

    if (!team) return { state: 'unreadable', leagueName: league.name }
    const entries = [
      ...refsWithSlot(team.starters, 'starter', league.name),
      ...refsWithSlot(team.bench, 'bench', league.name),
      ...refsWithSlot(team.injuredReserve, 'IR', league.name),
      ...refsWithSlot(team.taxi, 'taxi', league.name),
    ]
    if (entries.length === 0) return { state: 'empty', leagueName: league.name }

    /*
     * The roster reader names players through a Sleeper-keyed lookup. For every other platform
     * the ids it could not name go through the any-platform resolver — the fix #1103 made for
     * grounding, and never wired into this path.
     */
    const unnamedIds = entries.filter((e) => !e.name).map((e) => e.playerId)
    if (unnamedIds.length > 0) {
      const identities = await resolveRosterPlayerIdentities(platformOf.get(league.id), sport, unnamedIds).catch(
        () => new Map(),
      )
      for (const e of entries) {
        if (e.name) continue
        const id = identities.get(e.playerId)
        if (!id?.name) continue
        e.name = id.name
        e.position = e.position ?? id.position
        e.team = e.team ?? id.team
      }
    }

    return {
      state: 'read',
      leagueName: league.name,
      sport,
      entries: entries.map(({ playerId: _id, ...rest }) => rest),
      unnamed: entries.filter((e) => !e.name).length,
    }
  })

  const readLeagues = reads.filter((r): r is Extract<LeagueRead, { state: 'read' }> => r.state === 'read')
  const unreadable = reads.filter((r) => r.state === 'unreadable').map((r) => r.leagueName)
  const empty = reads.filter((r) => r.state === 'empty').map((r) => r.leagueName)

  const findings: Finding[] = []
  const ambiguous = new Set<string>()
  const noSource: string[] = []
  const staleFeeds: string[] = []
  let playersChecked = 0

  const sports = [...new Set(readLeagues.map((r) => r.sport))]
  for (const sport of sports) {
    const entries = readLeagues.filter((r) => r.sport === sport).flatMap((r) => r.entries)
    const named = entries.filter((e): e is RosterEntry & { name: string } => Boolean(e.name))

    /* One lookup per distinct player — the same player on three rosters is one injury. */
    const lookups = new Map<string, InjuryLookup>()
    for (const e of named) {
      const key = normalizeMatchName(e.name)
      if (key && !lookups.has(key)) lookups.set(key, { name: e.name, position: e.position, team: e.team })
    }
    playersChecked += lookups.size

    const res = await resolveInjuryFacts({ sport, players: [...lookups.values()] }).catch(() => null)
    if (!res) {
      staleFeeds.push(`${sport} (the injury store could not be read)`)
      continue
    }
    if (!res.coverage.sourceAvailable) {
      noSource.push(`${sport}: ${res.coverage.reason ?? 'no injury source is connected'}`)
      continue
    }
    if (res.feedStale) {
      staleFeeds.push(
        `${sport} (last refreshed ${res.newestFetchedAt ? isoDay(res.newestFetchedAt) : 'never'})`,
      )
    }
    for (const name of res.ambiguous) ambiguous.add(name)

    const byKey = new Map<string, Finding>()
    for (const e of named) {
      const key = normalizeMatchName(e.name)
      if (!key) continue
      const fact: InjuryFact | undefined = res.byPlayer.get(key)
      const status = fact?.status ? String(fact.status) : null

      let finding = byKey.get(key)
      if (!finding) {
        if (status && !NON_INJURY_STATUS.test(status.trim())) {
          finding = {
            name: e.name,
            position: e.position,
            team: e.team,
            status,
            detail: fact?.type ?? fact?.description ?? null,
            reportedAt: fact?.reportedAt ?? null,
            stale: fact?.stale ?? false,
            appearances: [],
          }
        } else if (!fact && e.feedStatus && !NON_INJURY_STATUS.test(e.feedStatus.trim())) {
          /*
           * No report row, but the Sleeper player feed carries a designation. Kept, because
           * dropping it would hide a real "Out" — and labelled undated, because it is.
           */
          finding = {
            name: e.name,
            position: e.position,
            team: e.team,
            status: e.feedStatus,
            detail: null,
            reportedAt: null,
            stale: false,
            appearances: [],
          }
        }
        if (finding) byKey.set(key, finding)
      }
      finding?.appearances.push({ leagueName: e.leagueName, slot: e.slot })
    }
    findings.push(...byKey.values())
  }

  findings.sort((a, b) => severityOf(a.status) - severityOf(b.status) || a.name.localeCompare(b.name))

  const unnamedTotal = readLeagues.reduce((n, r) => n + r.unnamed, 0)
  const scope = sportFilter ? `${sportFilter} ` : ''
  const lines: string[] = [
    `CROSS-LEAGUE INJURY CHECK of the user's OWN ${scope}rosters, current season, ${readLeagues.length} league(s) read, ${playersChecked} distinct player(s) checked.`,
  ]

  if (findings.length === 0) {
    lines.push(
      'No player on those rosters has a current injury designation on file. Say "no reported injuries", NOT "everyone is healthy" — absence of a report is not a clean bill of health.',
    )
  } else {
    lines.push(`${findings.length} player(s) with an injury designation, most serious first:`)
    for (const f of findings) {
      const who = [f.name, f.position, f.team].filter(Boolean).join(' ')
      const when = f.reportedAt
        ? `reported ${isoDay(f.reportedAt)}${f.stale ? ', MAY BE OUT OF DATE' : ''}`
        : 'Sleeper player feed, undated'
      const where = f.appearances
        .map((a) => `${a.leagueName} (${a.slot === 'starter' ? 'STARTING' : a.slot})`)
        .join('; ')
      lines.push(`- ${who}: ${f.status}${f.detail ? ` — ${f.detail}` : ''} [${when}] — on: ${where}`)
    }
    const startingHurt = findings.filter(
      (f) => severityOf(f.status) <= 1 && f.appearances.some((a) => a.slot === 'starter'),
    )
    if (startingHurt.length > 0) {
      lines.push(
        `⚠ ACTION: ${startingHurt.length} player(s) listed Out/IR are in a STARTING lineup: ${startingHurt
          .map((f) => `${f.name} (${f.appearances.filter((a) => a.slot === 'starter').map((a) => a.leagueName).join(', ')})`)
          .join('; ')}. Lead with these.`,
      )
    }
  }

  /* Each gap can only HIDE an injury, never invent one — so each says the true list can only be LONGER. */
  const gaps: string[] = []
  if (truncated > 0) gaps.push(`${truncated} further league(s) were not scanned (cap ${MAX_LEAGUES_SCANNED})`)
  if (unreadable.length > 0) {
    gaps.push(
      `${unreadable.length} league(s) have no claimed or synced team for this user (${unreadable.slice(0, 6).join(', ')}) — NOT a finding that those rosters are healthy`,
    )
  }
  if (empty.length > 0) gaps.push(`${empty.length} league(s) have a team with no players synced (${empty.slice(0, 6).join(', ')})`)
  if (unnamedTotal > 0) gaps.push(`${unnamedTotal} rostered player(s) could not be identified by name, so they were not checked`)
  if (ambiguous.size > 0) {
    gaps.push(
      `${ambiguous.size} name(s) matched more than one injured player and were REFUSED rather than guessed (${[...ambiguous].slice(0, 6).join(', ')})`,
    )
  }
  if (noSource.length > 0) gaps.push(`no injury source exists for: ${noSource.join('; ')}`)
  if (staleFeeds.length > 0) gaps.push(`the injury feed is behind for ${staleFeeds.join(', ')}, so statuses may have changed`)

  if (gaps.length > 0) {
    lines.push(`⚠ KNOWN GAPS — each can only hide an injury, so the true list can only be LONGER: ${gaps.join('; ')}.`)
  }

  lines.push(
    'Report the designations exactly as given with their dates, and name the league for each. Do NOT add injuries from general knowledge, and do NOT describe anyone not listed as healthy.',
  )
  return lines.join('\n')
}
