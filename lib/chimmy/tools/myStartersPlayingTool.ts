import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveAiTeamContext } from '@/lib/ai-payload/resolveAiTeamContext'
import { getFantasyDayWindowUTC } from '@/lib/time-engine/windows'
import { dedupeFixtures } from '@/lib/sports/dedupeFixtures'
import { sameNflTeam } from '@/lib/sports/teamRef'
import { listMemberLeagues } from '@/lib/chimmy/tools/leagueByName'
import type { AiRosterPlayerRef } from '@/lib/ai-payload/types'

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

/**
 * Nobody's honest answer needs more, and a roster read is several queries.
 *
 * ⚠ A CAP CHANGES THE COUNT, SO EXCEEDING IT IS REPORTED. "How many leagues" is
 * the whole question; silently scanning the first 40 of 65 and answering "6"
 * would be a precise, confident, wrong number.
 */
const MAX_LEAGUES_SCANNED = 40

/** Rosters read at once. Bounded so one chat turn cannot saturate the pool. */
const ROSTER_CONCURRENCY = 6

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

/** Run `work` over `items` a few at a time, preserving input order. */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      out[index] = await work(items[index])
    }
  })
  await Promise.all(runners)
  return out
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
   * read, because scanning forty rosters to conclude nobody is playing is work
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
  const scanned = pool.slice(0, MAX_LEAGUES_SCANNED)
  const truncated = pool.length - scanned.length

  const results = await mapLimited(scanned, ROSTER_CONCURRENCY, async (league) => {
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

  const hits: LeagueHit[] = []
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
    if (r.playing.length > 0) {
      hits.push({
        leagueName: r.league.name,
        season: r.league.season,
        players: r.playing.map((p) =>
          [p.name ?? 'unnamed player', p.position, p.team].filter(Boolean).join(' '),
        ),
      })
    }
  }

  const readCount = results.filter((r) => r.state === 'read').length

  const lines: string[] = [
    `CROSS-LEAGUE STARTER COUNT for ${label} (Eastern), ${reportedSeason} NFL season.`,
    `NFL games ${label}: ${fixtures.map(describeFixture).join('; ')}.`,
    `ANSWER: ${hits.length} of ${readCount} readable NFL league(s) have at least one STARTER in those games.`,
  ]

  if (hits.length > 0) {
    lines.push(
      'The leagues and the starters:',
      ...hits.map((h) => `- ${h.leagueName}: ${h.players.join('; ')}`),
    )
  } else {
    lines.push('No starter of theirs is on a team playing in those games.')
  }

  /*
   * ⚠ THE GAPS TRAVEL WITH THE NUMBER. A count assembled over rosters that could
   * not all be read looks exact unless the model is told otherwise, and "you have
   * players in 3 leagues tonight" is a different claim from "3 of the 9 I could
   * read". Each gap below moves the true answer in a KNOWN direction, so each one
   * says which way.
   */
  const gaps: string[] = []
  if (truncated > 0) {
    gaps.push(
      `${truncated} further NFL league(s) were NOT scanned (cap of ${MAX_LEAGUES_SCANNED}), so the real count can only be HIGHER`,
    )
  }
  if (unreadable.length > 0) {
    gaps.push(
      `${unreadable.length} league(s) have no claimed or synced team of theirs, so nothing could be read there (${unreadable
        .slice(0, 6)
        .join(', ')}) — the real count can only be HIGHER, and this is NOT a finding that those leagues are empty`,
    )
  }
  if (noStarters.length > 0) {
    gaps.push(
      `${noStarters.length} league(s) have a claimed team with NO starters stored (${noStarters
        .slice(0, 6)
        .join(', ')}) — their lineup has not synced, so the real count can only be HIGHER`,
    )
  }
  if (leaguesWithUnknownTeams > 0) {
    gaps.push(
      `in ${leaguesWithUnknownTeams} league(s) at least one starter has no NFL team on file, so they could not be checked either way — the real count can only be HIGHER`,
    )
  }

  if (gaps.length > 0) {
    lines.push(`⚠ KNOWN GAPS, state them if they affect the answer: ${gaps.join('; ')}.`)
  }

  lines.push(
    'Report the count as given and name the games it is based on. This covers STARTERS only — bench, IR and taxi were excluded on purpose. ' +
      'It is NFL only. Do NOT estimate past the gaps above and do NOT round the count up to cover them.',
  )

  return lines.join('\n')
}
