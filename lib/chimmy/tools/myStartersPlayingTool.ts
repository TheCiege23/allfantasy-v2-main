import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveAiTeamContext } from '@/lib/ai-payload/resolveAiTeamContext'
import { getFantasyDayWindowUTC } from '@/lib/time-engine/windows'
import { dedupeFixtures } from '@/lib/sports/dedupeFixtures'
import { sameNflTeam } from '@/lib/sports/teamRef'
import { listMemberLeagues } from '@/lib/chimmy/tools/leagueByName'
import { NAME_EVERY_LEAGUE, nameList, scanWithinBudget, type BoundedScanOptions } from '@/lib/chimmy/tools/boundedScan'
import type { AiRosterPlayerRef } from '@/lib/ai-payload/types'
import { resolveInjuryFacts, type InjuryFact } from '@/lib/injuries/injuryReadPort'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { isHealthyDesignation, ruledOutByFact } from '@/lib/core-app/injuryStatus'
import { isBestBallSettings } from '@/lib/core-app/lineupMode'

/**
 * HOW MANY OF THE USER'S LEAGUES HAVE A STARTER IN TODAY'S / TONIGHT'S NFL GAMES.
 *
 * ⚠ THE QUESTION THIS EXISTS FOR WAS ANSWERED WITH A SCHEDULE. Measured in
 * production 2026-09-17:
 *
 *   Q  "seeing as there is a game tonight, how many leagues do I have fantasy
 *       players playing tonight? as a starter? for NFL"
 *   A  "Here are the cached NFL games I can verify for that window:
 *       - Detroit Lions @ Buffalo Bills: score TBD (scheduled) — Sep 17, 8:15 PM EDT"
 *
 * Two independent causes, and this module is the second half of the fix. The
 * first was a deterministic short-circuit firing on a bare "tonight"
 * (`isPersonalRosterScoped` in `lib/ai/deterministic.ts`). The second was that
 * even reaching the model changed nothing: EVERY roster tool here is scoped to
 * the ONE league in scope — `get_my_roster` takes no arguments at all — so a
 * question spanning all of someone's leagues had no tool that could answer it,
 * and the best available reply was "pick a league".
 *
 * ⚠ NFL ONLY, AND IT SAYS SO. The team matcher it depends on (`sameNflTeam`) is
 * NFL-only by design: all 32 NFL nicknames are distinct, which is what makes
 * matching a bare name safe, and is exactly what stops being true in college.
 * Widening this to other sports needs a matcher for them first, not a looser one.
 */

/** US sports days are Eastern days; "today" and "tonight" mean an ET day. */
const SPORTS_DAY_TIMEZONE = 'America/New_York'

/**
 * "Tonight" starts at 5pm Eastern.
 *
 * ⚠ A STATED RULE, NOT AN INFERENCE. There is no "tonight" in the data — only
 * kickoff timestamps — so the boundary is a choice, and the answer therefore
 * NAMES the games it counted. A reader can see a 4:25pm kickoff was excluded;
 * they cannot see a cutoff that was only implied.
 */
const TONIGHT_START_HOUR_ET = 17

/*
 * 🛑 A TIME BUDGET, NOT A LEAGUE CAP — the same change `get_my_injuries` made (#1471).
 *
 * This was `MAX_LEAGUES_SCANNED = 40`, reported as "N further league(s) were NOT scanned".
 * The note was right that a cap changes the count — "how many leagues" is the whole question —
 * but a count of the missed leagues names none of them, and the cap was a guess at a time limit.
 * A Chimmy tool has no timeout of its own (only the loop's 75s, shared with the model turns),
 * so every in-season league is now attempted and whatever the budget does not reach is NAMED.
 */
const SCAN_BUDGET_MS = 20_000
const PER_LEAGUE_TIMEOUT_MS = 8_000

/** Rosters read at once. Bounded so one chat turn cannot saturate the pool. */
const ROSTER_CONCURRENCY = 6

/** A backstop against a pathological account, far above any real one; overflow is named too. */
const MAX_LEAGUES_SCANNED = 150

type Fixture = {
  homeTeam: string | null
  awayTeam: string | null
  startTime: Date | null
  season: number | null
  status: string | null
}

type LeagueHit = {
  leagueName: string
  season: number
  players: string[]
  /** Starters on a team in those games whom the injury report rules OUT — listed, never counted. */
  ruledOut: string[]
  /** The platform sets this lineup automatically, so a stored "starter" is not a manual start. */
  bestBall: boolean
}

function playerLabel(p: AiRosterPlayerRef): string {
  return [p.name ?? 'unnamed player', p.position, p.team].filter(Boolean).join(' ')
}

/** "Out (Hamstring), reported 2026-09-27" — the designation as the report states it, dated. */
function designation(fact: InjuryFact): string {
  const what = [fact.status, fact.type ? `(${fact.type})` : null].filter(Boolean).join(' ')
  return `${what}, reported ${fact.reportedAt.toISOString().slice(0, 10)}${fact.stale ? ' — may be out of date' : ''}`
}

function formatEt(value: Date | null): string {
  if (!value || !Number.isFinite(value.getTime())) return 'time TBD'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: SPORTS_DAY_TIMEZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(value)
}

/** The kickoff hour in Eastern time, or null when the timestamp is unusable. */
function easternHour(value: Date | null): number | null {
  if (!value || !Number.isFinite(value.getTime())) return null
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: SPORTS_DAY_TIMEZONE,
    hour: 'numeric',
    hour12: false,
  }).format(value)
  const parsed = Number(hour)
  return Number.isFinite(parsed) ? parsed : null
}

/** Today's NFL fixtures on the Eastern calendar day, one row per real game. */
async function readTodaysNflFixtures(): Promise<Fixture[]> {
  const { windowStartUTC, windowEndUTC } = getFantasyDayWindowUTC(SPORTS_DAY_TIMEZONE)

  const rows = await prisma.sportsGame
    .findMany({
      where: { sport: 'NFL', startTime: { gte: windowStartUTC, lt: windowEndUTC } },
      select: {
        homeTeam: true,
        awayTeam: true,
        startTime: true,
        season: true,
        status: true,
        /* dedupeFixtures decides which of the per-source rows to believe by these. */
        fetchedAt: true,
        source: true,
        homeScore: true,
        awayScore: true,
      },
      orderBy: { startTime: 'asc' },
      take: 60,
    })
    .catch(() => [])

  /*
   * ⚠ `SportsGame` HOLDS ONE ROW PER PROVIDER PER GAME and they disagree on team
   * spelling — "PIT" from espn_live against "Pittsburgh Steelers" from the other
   * three. Listed raw that is four games; counted raw it is four chances for one
   * fixture to match one starter four times.
   */
  return dedupeFixtures(rows as never[]).map((row) => {
    const r = row as unknown as Fixture
    return {
      homeTeam: r.homeTeam ?? null,
      awayTeam: r.awayTeam ?? null,
      startTime: r.startTime ?? null,
      season: r.season ?? null,
      status: r.status ?? null,
    }
  })
}

function describeFixture(f: Fixture): string {
  return `${f.awayTeam ?? '?'} @ ${f.homeTeam ?? '?'} — ${formatEt(f.startTime)}`
}

/** Starters whose NFL team is in one of `fixtures`. */
function startersInFixtures(
  starters: AiRosterPlayerRef[],
  fixtures: Fixture[],
): { playing: AiRosterPlayerRef[]; unknownTeam: number } {
  const playing: AiRosterPlayerRef[] = []
  let unknownTeam = 0

  for (const player of starters) {
    /*
     * ⚠ A STARTER WITH NO TEAM IS UNKNOWN, NOT ABSENT. Roster player ids do not
     * join to the canonical `Player` table (measured 0 of 205 in a production
     * census), so a row can resolve a name and still carry a null team. Counting
     * those as "not playing" would understate the answer silently; they are
     * counted separately and reported.
     */
    if (!player.team) {
      unknownTeam += 1
      continue
    }
    const hit = fixtures.some(
      (f) => sameNflTeam(player.team, f.homeTeam) || sameNflTeam(player.team, f.awayTeam),
    )
    if (hit) playing.push(player)
  }

  return { playing, unknownTeam }
}

export interface MyStartersPlayingInput {
  userId: string
  /** 'tonight' narrows to kickoffs from 5pm ET; 'today' takes the whole ET day. */
  window: 'today' | 'tonight'
  /** Scan bounds; the tool loop takes the defaults. A caller with a shorter deadline must pass its own. */
  scan?: Partial<BoundedScanOptions> & { maxLeagues?: number }
}

/**
 * Prose for the model, or a sentence saying why there is no answer.
 *
 * Never throws — a tool that blew up must come back as words, because an
 * exception here aborts a conversation somebody is waiting on.
 */
export async function buildMyStartersPlayingContext(
  input: MyStartersPlayingInput,
): Promise<string> {
  const { userId, window } = input
  if (!userId) {
    return 'I cannot tell who is signed in, so I cannot read their leagues. Say that; do not name a league or a count.'
  }

  const allFixtures = await readTodaysNflFixtures()
  const label = window === 'tonight' ? 'tonight' : 'today'

  const fixtures =
    window === 'tonight'
      ? allFixtures.filter((f) => {
          const hour = easternHour(f.startTime)
          return hour != null && hour >= TONIGHT_START_HOUR_ET
        })
      : allFixtures

  /*
   * No games is a real answer and a cheap one — and it comes BEFORE any roster
   * read, because scanning every roster to conclude nobody is playing is work
   * nobody asked for.
   */
  if (fixtures.length === 0) {
    const laterToday = allFixtures.length > 0
    return [
      `NO NFL GAME is on my cached schedule for ${label} (Eastern).`,
      laterToday
        ? `There ARE ${allFixtures.length} NFL game(s) elsewhere in today's Eastern day: ${allFixtures
            .map(describeFixture)
            .join('; ')}. Offer those if they meant today rather than ${label}.`
        : 'Tell them there is no NFL game scheduled and do NOT count starters.',
      'Do NOT state a number of leagues; nothing was counted.',
    ].join(' ')
  }

  const leagues = await listMemberLeagues(userId).catch(() => [])
  const nflLeagues = leagues.filter((l) => String(l.sport).toUpperCase() === 'NFL')

  if (nflLeagues.length === 0) {
    return [
      `The NFL games ${label} are: ${fixtures.map(describeFixture).join('; ')}.`,
      'This user has NO NFL leagues on file, so there are no starters of theirs to count.',
      'Say that plainly. This is NOT a claim that their leagues are empty — they have none of this sport.',
    ].join(' ')
  }

  /*
   * ⚠ ONE SEASON, AND IT IS THE FIXTURES'. A user's league list spans years, so
   * counting every row would fold 2023 and 2024 copies into "how many leagues do
   * I have players playing tonight" — a number several times too large about
   * rosters that have not existed for two seasons.
   */
  const fixtureSeason = fixtures.find((f) => f.season != null)?.season ?? null
  const newestSeason = Math.max(...nflLeagues.map((l) => l.season))
  const season = fixtureSeason ?? newestSeason
  const inSeason = nflLeagues.filter((l) => l.season === season)

  /*
   * A season the user has no leagues in must not produce "0 of 0". Falling back
   * to their newest keeps the answer about real rosters, and the answer names the
   * season either way.
   */
  const pool = inSeason.length > 0 ? inSeason : nflLeagues.filter((l) => l.season === newestSeason)
  const reportedSeason = inSeason.length > 0 ? season : newestSeason
  const maxLeagues = input.scan?.maxLeagues ?? MAX_LEAGUES_SCANNED
  const scanned = pool.slice(0, maxLeagues)
  const overCap = pool.slice(maxLeagues)

  const scan = await scanWithinBudget(scanned, {
    concurrency: input.scan?.concurrency ?? ROSTER_CONCURRENCY,
    budgetMs: input.scan?.budgetMs ?? SCAN_BUDGET_MS,
    perItemTimeoutMs: input.scan?.perItemTimeoutMs ?? PER_LEAGUE_TIMEOUT_MS,
    now: input.scan?.now,
  }, async (league) => {
    const team = await resolveAiTeamContext({
      userId,
      leagueId: league.id,
      sport: 'NFL',
      season: league.season,
      /*
       * Week 1 as the floor, matching `buildMyRosterContext`: this asks WHO IS
       * ON THE ROSTER, and the period only colours the opponent line. Guessing a
       * current week would put a wrong matchup in front of the model.
       */
      currentPeriod: 1,
    }).catch(() => null)

    if (!team) return { league, state: 'unreadable' as const }
    if (team.starters.length === 0) return { league, state: 'no-starters' as const }

    const { playing, unknownTeam } = startersInFixtures(team.starters, fixtures)
    return { league, state: 'read' as const, playing, unknownTeam, starterCount: team.starters.length }
  })
  const results = scan.done.map((d) => d.result)
  /* Every league that was never read, by name — the part a bare count threw away. */
  const notReached = [...scan.notStarted, ...overCap].map((l) => l.name)
  const unfinished = [...scan.timedOut, ...scan.failed].map((l) => l.name)
  const unchecked = notReached.length + unfinished.length

  /*
   * 🛑 A STARTER ON A TEAM THAT PLAYS TONIGHT IS NOT A STARTER WHO PLAYS TONIGHT. Measured live
   * 2026-09-28: "who do I have playing tonight" listed Caleb Williams (Out, hamstring) and Dallas
   * Goedert (Out, knee) as playing in BB Dynasty, while the same account's injury answer an hour
   * earlier had both Out. This tool matched team to fixture and never read an injury.
   *
   * So every starter in those games is checked against the canonical injury port, ONE read for the
   * whole account, and judged by `ruledOutByFact` — the same rule the waiver board uses (a stale
   * game-day Out is last week's news; IR and the other season-scale rulings still count). A ruled-
   * out starter is listed as NOT COUNTED. Questionable and Doubtful still count and are labelled.
   * An unreadable injury report excludes nobody, and says the count may therefore be too HIGH.
   */
  const readResults = results.filter((r): r is Extract<typeof r, { state: 'read' }> => r.state === 'read')
  const lookups = new Map<string, { name: string; position: string | null; team: string | null }>()
  for (const r of readResults) {
    for (const p of r.playing) {
      const key = p.name ? normalizeMatchName(p.name) : ''
      if (key && !lookups.has(key)) lookups.set(key, { name: p.name!, position: p.position, team: p.team })
    }
  }
  const injuries = lookups.size > 0 ? await resolveInjuryFacts({ sport: 'NFL', players: [...lookups.values()] }).catch(() => null) : null
  const injuryGap =
    lookups.size === 0
      ? null
      : !injuries
        ? 'the injury report could not be read'
        : !injuries.coverage.sourceAvailable
          ? `no injury source is available (${injuries.coverage.reason ?? 'unknown reason'})`
          : null
  const factFor = (p: AiRosterPlayerRef): InjuryFact | undefined =>
    injuries && p.name ? injuries.byPlayer.get(normalizeMatchName(p.name)) : undefined

  const bestBallRows = await prisma.league
    .findMany({ where: { id: { in: readResults.map((r) => r.league.id) } }, select: { id: true, settings: true, leagueType: true } })
    .catch(() => [] as Array<{ id: string; settings?: unknown; leagueType?: string | null }>)
  const bestBallOf = new Map(bestBallRows.map((r) => [r.id, isBestBallSettings(r.settings) || String(r.leagueType ?? '').includes('best_ball')]))

  const hits: LeagueHit[] = []
  const onlyOut: string[] = []
  const unreadable: string[] = []
  const noStarters: string[] = []
  let leaguesWithUnknownTeams = 0

  for (const r of results) {
    if (r.state === 'unreadable') {
      unreadable.push(r.league.name)
      continue
    }
    if (r.state === 'no-starters') {
      noStarters.push(r.league.name)
      continue
    }
    if (r.unknownTeam > 0) leaguesWithUnknownTeams += 1
    const available: string[] = []
    const out: string[] = []
    for (const p of r.playing) {
      const fact = factFor(p)
      if (ruledOutByFact(fact)) out.push(`${playerLabel(p)} — ${designation(fact!)}`)
      /* Counted, but a designation he still carries (Questionable, a stale Out) travels with him. */
      else available.push(fact && fact.status && !isHealthyDesignation(fact.status) ? `${playerLabel(p)} (${designation(fact)})` : playerLabel(p))
    }
    if (available.length > 0) {
      hits.push({ leagueName: r.league.name, season: r.league.season, players: available, ruledOut: out, bestBall: bestBallOf.get(r.league.id) ?? false })
    } else if (out.length > 0) {
      /*
       * ⚠ THE BEST BALL TAG TRAVELS WITH THE LEAGUE EVEN WHEN IT IS NOT COUNTED. It was written only
       * on counted lines, so on 2026-09-28 a Best Ball league dropped for two Out starters reached the
       * model untagged, and the answer offered "replacement options before kickoff" for a lineup the
       * platform sets itself.
       */
      const bestBall = bestBallOf.get(r.league.id) ?? false
      onlyOut.push(
        `${r.league.name}${bestBall ? ' [Best Ball — lineup set automatically; there is no lineup move to make]' : ''} (${out.join('; ')})`,
      )
    }
  }
  const bestBallHits = hits.filter((h) => h.bestBall).length

  const readCount = results.filter((r) => r.state === 'read').length

  const lines: string[] = [
    `CROSS-LEAGUE STARTER COUNT for ${label} (Eastern), ${reportedSeason} NFL season.`,
    `NFL games ${label}: ${fixtures.map(describeFixture).join('; ')}.`,
  ]

  /*
   * ⚠ COVERAGE SITS IMMEDIATELY ABOVE THE NUMBER. The answer IS a count, so a partial scan
   * changes the headline itself — "3 leagues" over 40 of 64 is a floor, not an answer. It is
   * stated before the ANSWER line, with the missed leagues named, not in the gaps at the bottom.
   */
  if (unchecked === 0) {
    lines.push(`SCAN COVERAGE: all ${pool.length} ${reportedSeason} NFL league(s) were reached.`)
  } else {
    const parts = [
      notReached.length ? `not reached in the time available (${notReached.length}): ${nameList(notReached)}` : null,
      unfinished.length ? `started but did not finish (${unfinished.length}): ${nameList(unfinished)}` : null,
    ].filter(Boolean)
    lines.push(
      `⚠ PARTIAL SCAN — ${pool.length - unchecked} of ${pool.length} ${reportedSeason} NFL leagues were checked; ${unchecked} were NOT. ${parts.join('; ')}. ` +
        `The count below is a FLOOR: say it covers ${pool.length - unchecked} of ${pool.length} leagues, name the ones not checked, ` +
        'and never present it as the total — asking again usually reaches the rest. ' +
        NAME_EVERY_LEAGUE,
    )
  }
  lines.push(
    `ANSWER: ${hits.length} of ${readCount} readable NFL league(s) have at least one STARTER set to play in those games — starters the injury report rules OUT are not counted` +
      (bestBallHits > 0 ? `; ${bestBallHits} of these are Best Ball leagues, where the platform picks the lineup, so those "starters" are not a manual start.` : '.'),
  )

  if (hits.length > 0) {
    lines.push(
      'The leagues and the starters:',
      ...hits.map(
        (h) =>
          `- ${h.leagueName}${h.bestBall ? ' [Best Ball — lineup set automatically]' : ''}: ${h.players.join('; ')}` +
          (h.ruledOut.length ? ` | ruled OUT, not counted: ${h.ruledOut.join('; ')}` : ''),
      ),
    )
  } else {
    lines.push('No starter of theirs who is available is on a team playing in those games.')
  }
  if (onlyOut.length > 0) {
    lines.push(
      `NOT COUNTED — in ${onlyOut.length} league(s) every starter on a team in those games is ruled OUT by the injury report: ${onlyOut.join('; ')}. ` +
        'Say these players are not playing; never list them as playing tonight. In a league tagged Best Ball, never offer to swap, replace or reset the lineup.',
    )
  }

  /*
   * ⚠ THE GAPS TRAVEL WITH THE NUMBER. A count assembled over rosters that could
   * not all be read looks exact unless the model is told otherwise, and "you have
   * players in 3 leagues tonight" is a different claim from "3 of the 9 I could
   * read". Each gap below moves the true answer in a KNOWN direction, so each one
   * says which way.
   */
  const gaps: string[] = []
  if (unchecked > 0) {
    gaps.push(`${unchecked} NFL league(s) were not checked at all (named under PARTIAL SCAN above), so the real count can only be HIGHER`)
  }
  if (unreadable.length > 0) {
    gaps.push(
      `${unreadable.length} league(s) have no claimed or synced team of theirs, so nothing could be read there (${nameList(unreadable)}) — the real count can only be HIGHER, and this is NOT a finding that those leagues are empty`,
    )
  }
  if (noStarters.length > 0) {
    gaps.push(
      `${noStarters.length} league(s) have a claimed team with NO starters stored (${nameList(noStarters)}) — their lineup has not synced, so the real count can only be HIGHER`,
    )
  }
  if (leaguesWithUnknownTeams > 0) {
    gaps.push(
      `in ${leaguesWithUnknownTeams} league(s) at least one starter has no NFL team on file, so they could not be checked either way — the real count can only be HIGHER`,
    )
  }
  /*
   * ⚠ THE ONE GAP THAT MOVES THE COUNT DOWN. Every other gap here can only hide a league; an
   * unread injury report can only ADD one — a league counted on a starter who is Out. So it must
   * not be summarised with the others as "a floor".
   */
  if (injuryGap) {
    gaps.push(
      `${injuryGap}, so starters who are OUT may be counted as playing — the real count may be LOWER than stated, and it is NOT a floor`,
    )
  }

  if (gaps.length > 0) {
    lines.push(`⚠ KNOWN GAPS, state them if they affect the answer: ${gaps.join('; ')}. ${NAME_EVERY_LEAGUE}`)
  }

  lines.push(
    'Report the count as given and name the games it is based on. This covers STARTERS only — bench, IR and taxi were excluded on purpose. ' +
      'It is NFL only. Do NOT estimate past the gaps above and do NOT round the count up to cover them.',
  )

  return lines.join('\n')
}
