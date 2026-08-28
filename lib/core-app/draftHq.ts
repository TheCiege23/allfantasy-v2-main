import 'server-only'

import { prisma } from '@/lib/prisma'
import { getDraftReport, type DraftGradeLetter } from '@/lib/draft-intel/draftReportService'
import { buildImportedDraftReport } from '@/lib/draft-intel/importedDraftReport'
import { leagueDisplayName, type SectionState, type UnavailableSection } from './leagueHome'

/**
 * Draft HQ — "before the draft: your picks, the lottery, the board settings and
 * a prepared queue".
 *
 * Real, from DraftSession: status, draft type, rounds, team count, and the draft
 * order (slotOrder, a JSON array of { slot, rosterId, displayName }). 28 of 46
 * stored sessions carry an order.
 *
 * Your pick SLOTS are computed, not stored — snake order is deterministic given
 * your slot, the round count and the team count, so deriving 1.02 / 2.11 / 3.02
 * is arithmetic rather than invention.
 *
 * ⚠ But they are labelled ORIGINAL slots, because pick TRADES are not ingested.
 * DraftPick.tradedPickMeta exists for picks already made; nothing records that a
 * future pick changed hands. So "you hold 2.01, acquired from @dre" — which the
 * handoff shows — cannot be said, and claiming a traded-away pick is still yours
 * would be worse than saying nothing.
 *
 * ⚠ The weighted lottery in the handoff has NO model at all. There is no lottery
 * table, no ball counts, no odds. That section reports itself unavailable rather
 * than computing odds from standings, which would look authoritative and be
 * entirely our own invention.
 */

export type PickSlot = {
  round: number
  pickInRound: number
  overall: number
  label: string
}

export type MadePick = {
  overall: number
  round: number
  label: string
  playerName: string
  position: string
  team: string | null
}

/** One pick on the completed board - any team's, not just yours. */
export type BoardPick = {
  round: number
  overall: number
  label: string
  teamKey: string
  teamName: string | null
  isYou: boolean
  playerName: string
  position: string
}

export type CompletedDraft = {
  season: number
  /** Rounds in order, each holding that round's picks in pick order. */
  rounds: Array<{ round: number; picks: BoardPick[] }>
  /** Distinct teams that made a pick, in first-pick order. */
  teams: Array<{ teamKey: string; name: string | null; isYou: boolean; picks: number }>
  totalPicks: number
}

/** One team's grade for the completed draft. */
export type TeamDraftGrade = {
  ownerId: string
  name: string
  teamName: string | null
  picks: number
  /** Value over the round median, as drafted. */
  initialGrade: DraftGradeLetter
  /** The same recomputed on points scored since (identical in redraft). */
  currentGrade: DraftGradeLetter
  trend: 'improved' | 'declined' | 'steady'
}

export type DraftGrades = {
  season: string
  /** True when some picks could not be graded - stated on screen, never hidden. */
  partial: boolean
  gradedPicks: number
  totalPicks: number
  scale: string
  /**
   * Set when the grade was computed from the stats feed's format aggregate rather
   * than the league's own rules. Carried through to the screen rather than dropped:
   * a grade built on an approximation has to say so where it is read.
   */
  approximationNote: string | null
  teams: TeamDraftGrade[]
}

export type DraftHqData = {
  league: { id: string; name: string; platform: string; format: string | null }
  session: SectionState<{
    status: string
    draftType: string
    rounds: number
    teamCount: number
    yourSlot: number | null
  }>
  /** Original pick slots, before any trades we cannot see. */
  pickSlots: SectionState<PickSlot[]>
  /** What you actually drafted, when the draft has run. */
  madePicks: SectionState<MadePick[]>
  /**
   * The last completed draft, every team's picks by round.
   *
   * WHY SEPARATE FROM `madePicks`, WHICH IS YOURS ALONE: a draft that has already run
   * is still the league's most-read page - who took whom, and in what order - and that
   * is a different question from "what did I get". Both read the same DraftFact rows.
   */
  board: SectionState<CompletedDraft>
  /**
   * A grade per team for that same completed draft.
   *
   * WHY THIS IS SLEEPER-ONLY TODAY, and why the reason is carried in the payload rather
   * than left to be rediscovered: the grade is value-over-round computed from REAL
   * SCORED POINTS, and that stats board is keyed on Sleeper player ids. An imported ESPN
   * or Fantrax pick carries the provider's own id, and nothing links the two -
   * `ingestEspnAthleteIdentities` deliberately refuses to link on a name, having measured
   * what that does. A fabricated letter would be worse than none: in this product a "C"
   * already means "no data".
   */
  grades: SectionState<DraftGrades>
  lottery: UnavailableSection
  queue: UnavailableSection
  keepers: UnavailableSection
}

/**
 * Snake order. Odd rounds run 1..n, even rounds reverse — so a slot-2 team in a
 * 12-team league picks 1.02 then 2.11.
 */
export function computePickSlots(
  slot: number,
  rounds: number,
  teamCount: number,
  draftType: string
): PickSlot[] {
  const out: PickSlot[] = []
  const snake = draftType.toLowerCase() === 'snake'
  for (let round = 1; round <= rounds; round += 1) {
    const reversed = snake && round % 2 === 0
    const pickInRound = reversed ? teamCount - slot + 1 : slot
    out.push({
      round,
      pickInRound,
      overall: (round - 1) * teamCount + pickInRound,
      label: `${round}.${String(pickInRound).padStart(2, '0')}`,
    })
  }
  return out
}

/**
 * The draft this league already played, read from the import.
 *
 * ⚠ NO LIVE DRAFT SESSION DOES NOT MEAN NO DRAFT. `DraftSession` describes a draft this
 * app is RUNNING; an imported league has never had one, so this screen answered "no
 * draft has been set up for this league" to someone whose ten drafted seasons were
 * sitting in `DraftFact` (`dw_draft_facts`), written by the import and read by nothing.
 *
 * ⚠ THIS IS SAFE ONLY BECAUSE `managerId` IS NOW CANONICAL. It used to hold the raw
 * historical `roster_id` — a slot within one season, reused by different managers across
 * seasons — so filtering it by a current team's `externalId` would have shown one manager
 * another manager's draft, plausibly and silently. The draft sync now resolves it the way
 * the matchup sync always has. Picks imported BEFORE that fix keep their raw ids and
 * simply will not match here, which is the correct failure: nothing is shown rather than
 * the wrong thing.
 */
/**
 * Provider player id -> a displayable name, for any provider.
 *
 * `PlayerProviderIdentity` first because it is the only table covering non-Sleeper ids;
 * `SportsPlayer` second because it is the only one carrying position and team. Shared by
 * the personal pick list and the full board so the two can never disagree about who a
 * pick was.
 */
async function resolvePlayerNames(
  playerIds: string[],
  platform: string,
): Promise<Map<string, { name: string; position: string | null; team: string | null }>> {
  const out = new Map<string, { name: string; position: string | null; team: string | null }>()
  if (playerIds.length === 0) return out

  /*
   * ⚠ AN ID MEANS NOTHING WITHOUT THE PROVIDER THAT ISSUED IT, and BOTH lookups
   * below have been missing that filter at different times.
   *
   * Measured on production, on the first ESPN league ever imported:
   *
   *   pick 13.04 -> "Liutauras Lelevicius"  (rolling_insights 15013, NCAAB)
   *
   * A basketball guard, rendered on an NFL draft board as a confident answer,
   * because an ESPN athlete id was compared against every provider's id space at
   * once. 12,074 provider_player_id values appear under two or more providers,
   * and 16,710 under two or more sports — a collision is the norm, not bad luck.
   *
   * ⚠ THE SLEEPER LOOKUP HAS THE SAME HOLE, and it is the easier one to miss
   * because the column name reads like a filter. `sleeperId` holds numeric
   * strings, so an ESPN id matches one just as readily; scoping the first query
   * achieves nothing while an unscoped second one runs beside it.
   *
   * A wrong name is worse than no name: "(not yet mapped)" is a true statement
   * about a pick we cannot resolve, and a stranger's name is a false one the
   * reader has no way to distinguish.
   */
  const scoped = String(platform ?? '').trim().toLowerCase()
  const [identities, players] = await Promise.all([
    scoped
      ? prisma.playerProviderIdentity
          .findMany({
            where: { provider: scoped, providerPlayerId: { in: playerIds } },
            select: { providerPlayerId: true, displayName: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
    /* Only a Sleeper league has Sleeper ids in its rows. */
    scoped === 'sleeper'
      ? prisma.sportsPlayer
          .findMany({
            where: { sleeperId: { in: playerIds } },
            select: { sleeperId: true, name: true, position: true, team: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
  ])

  for (const pl of players) {
    if (pl.sleeperId && !out.has(pl.sleeperId)) {
      out.set(pl.sleeperId, { name: pl.name, position: pl.position, team: pl.team })
    }
  }
  for (const i of identities) {
    if (i.displayName && !out.has(i.providerPlayerId)) {
      out.set(i.providerPlayerId, { name: i.displayName, position: null, team: null })
    }
  }
  return out
}

/**
 * Pick-in-round, decided from the numbers rather than the provider name.
 *
 * Sleeper writes `pick_no`, an OVERALL pick; ESPN writes the pick WITHIN the round. If
 * subtracting completed rounds lands inside the round it was overall; if the value
 * already sits inside a round it was a pick-in-round. Returns 0 when neither fits, and
 * the caller then says only what it knows.
 */
function pickInRoundOf(round: number, pickNumber: number, teamCount: number): number {
  if (teamCount <= 0) return 0
  const derived = pickNumber - (round - 1) * teamCount
  if (derived >= 1 && derived <= teamCount) return derived
  if (pickNumber >= 1 && pickNumber <= teamCount) return pickNumber
  return 0
}

/**
 * The last completed draft in full - every team, every round.
 *
 * WHY ORDERED BY `pickNumber` AND NOT BY TEAM: a board is only legible in pick order.
 * Grouping by team first loses the snake, which is the one thing a round view exists to
 * show.
 */
/**
 * Per-team grades for the last completed draft.
 *
 * `getDraftReport` already does the work - value over round median, regraded on points
 * accrued since - and caches it on a 6h cycle. This surfaces it on the screen where the
 * board it grades is actually shown.
 */
async function loadDraftGrades(
  leagueId: string,
  platform: string,
  platformLeagueId: string | null,
): Promise<SectionState<DraftGrades>> {
  const unavailable = (reason: string) => ({ available: false as const, reason })

  /*
   * Two sources, one shape. Sleeper grades live through its own API; every other
   * platform grades from the DraftFact rows we imported, through the same
   * `gradePicks`. Both return a `DraftReportPayload`, so everything below is common.
   */
  const report =
    platform === 'sleeper'
      ? platformLeagueId
        ? await getDraftReport(platformLeagueId).catch(() => null)
        : null
      : await buildImportedDraftReport(leagueId).catch(() => null)

  if (!report) {
    if (platform === 'sleeper' && !platformLeagueId) {
      return unavailable('this league has no Sleeper id on file, and the grader is keyed on one')
    }
    return unavailable('no completed draft has been graded for this league yet')
  }

  const season = [...report.seasons].sort((a, b) => Number(b.season) - Number(a.season))[0]
  if (!season || season.managers.length === 0) {
    return unavailable('no completed draft has been graded for this league yet')
  }

  /*
   * A season with nothing scored yet is refused rather than shown. Every median would
   * be zero, every value-over would be zero, and every manager would come out a C —
   * which in this product is what "no data" already looks like. Publishing that as a
   * grade is worse than saying there is no grade.
   */
  if (season.gradedPicks === 0) {
    return unavailable(
      `the ${season.season} season has not produced scoring yet, so there is nothing to grade a pick against`,
    )
  }

  return {
    available: true,
    data: {
      season: season.season,
      partial: season.partial,
      gradedPicks: season.gradedPicks,
      totalPicks: season.totalPicks,
      scale: report.gradeScale.description,
      approximationNote: report.scoringBasis === 'format-approx' ? report.scoringNote : null,
      teams: season.managers.map((m) => ({
        ownerId: m.ownerId,
        name: m.name,
        teamName: m.teamName,
        picks: m.picks,
        initialGrade: m.initialGrade,
        currentGrade: m.currentGrade,
        trend: m.trend,
      })),
    },
  }
}

async function loadCompletedDraftBoard(
  leagueId: string,
  userId: string,
): Promise<SectionState<CompletedDraft>> {
  const unavailable = (reason: string) => ({ available: false as const, reason })

  const facts = await prisma.draftFact
    .findMany({
      where: { leagueId },
      orderBy: [{ season: 'desc' }, { round: 'asc' }, { pickNumber: 'asc' }],
      select: { season: true, round: true, pickNumber: true, playerId: true, managerId: true },
    })
    .catch(() => [])
  if (facts.length === 0) {
    return unavailable('no completed draft has been imported for this league')
  }

  const season = facts[0]?.season ?? null
  const rows = facts.filter((f) => f.season === season)

  /* The provider that issued these ids — see resolvePlayerNames. Read before the
     fan-out because the name lookup cannot be scoped without it. */
  const boardLeague = await prisma.league
    .findUnique({ where: { id: leagueId }, select: { platform: true } })
    .catch(() => null)

  const [teams, mine, names] = await Promise.all([
    prisma.leagueTeam
      .findMany({ where: { leagueId }, select: { externalId: true, teamName: true, ownerName: true } })
      .catch(() => []),
    prisma.leagueTeam
      .findMany({ where: { leagueId, claimedByUserId: userId }, select: { externalId: true } })
      .catch(() => []),
    resolvePlayerNames([...new Set(rows.map((r) => r.playerId))], boardLeague?.platform ?? ''),
  ])

  const teamCount = teams.length
  const nameByKey = new Map<string, string>()
  for (const t of teams) {
    const label = t.teamName?.trim() || t.ownerName?.trim()
    if (t.externalId && label) nameByKey.set(t.externalId, label)
  }
  const yours = new Set(mine.map((t) => t.externalId).filter(Boolean) as string[])

  const byRound = new Map<number, BoardPick[]>()
  const teamOrder: string[] = []
  const teamPicks = new Map<string, number>()

  for (const r of rows) {
    const teamKey = r.managerId ?? ''
    const inRound = pickInRoundOf(r.round, r.pickNumber, teamCount)
    const hit = names.get(r.playerId)
    const pick: BoardPick = {
      round: r.round,
      overall: inRound > 0 ? (r.round - 1) * teamCount + inRound : r.pickNumber,
      label: inRound > 0 ? `${r.round}.${String(inRound).padStart(2, '0')}` : `Round ${r.round}`,
      teamKey,
      teamName: nameByKey.get(teamKey) ?? null,
      isYou: yours.has(teamKey),
      playerName: hit?.name ?? `Player ${r.playerId} (not yet mapped)`,
      position: hit?.position ?? '\u2014',
    }
    const bucket = byRound.get(r.round)
    if (bucket) bucket.push(pick)
    else byRound.set(r.round, [pick])

    if (teamKey && !teamPicks.has(teamKey)) teamOrder.push(teamKey)
    teamPicks.set(teamKey, (teamPicks.get(teamKey) ?? 0) + 1)
  }

  return {
    available: true,
    data: {
      season: season ?? 0,
      rounds: [...byRound.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([round, picks]) => ({ round, picks })),
      teams: teamOrder.map((teamKey) => ({
        teamKey,
        name: nameByKey.get(teamKey) ?? null,
        isYou: yours.has(teamKey),
        picks: teamPicks.get(teamKey) ?? 0,
      })),
      totalPicks: rows.length,
    },
  }
}

async function loadImportedDraftPicks(
  leagueId: string,
  userId: string,
): Promise<SectionState<MadePick[]>> {
  const unavailable = (reason: string) => ({ available: false as const, reason })

  const myTeam = await prisma.leagueTeam.findFirst({
    where: { leagueId, claimedByUserId: userId },
    select: { externalId: true },
  })
  if (!myTeam?.externalId) {
    return unavailable('no draft has been set up, and no team in this league is claimed by you')
  }

  const facts = await prisma.draftFact.findMany({
    where: { leagueId, managerId: String(myTeam.externalId) },
    orderBy: [{ season: 'desc' }, { pickNumber: 'asc' }],
    select: { round: true, pickNumber: true, playerId: true, season: true },
  })
  if (facts.length === 0) {
    return unavailable('no draft has been set up, and no imported draft picks are on file for your team')
  }

  /* The most recent imported season only — a screen headed "your picks" showing ten
     drafts at once is a list, not an answer. */
  const season = facts[0]?.season ?? null
  const rows = facts.filter((f) => f.season === season)

  /* Pick-in-round is derived from the overall pick and the league size, the same
     correction the live path documents: DraftPick.slot is a roster's draft slot, not a
     pick-in-round, and labelling from it prints every round identically. */
  const teamCount = await prisma.leagueTeam.count({ where: { leagueId } })

  /*
   * ⚠ THE PLAYER ID IS THE PROVIDER'S, AND ONLY SLEEPER'S RESOLVES VIA SportsPlayer.
   *
   * This first shipped joining `SportsPlayer.sleeperId`, which can never match an ESPN
   * league — its draft facts carry ESPN player ids, and `SportsPlayer` has no ESPN
   * source at all. Every pick rendered as "Unmatched player 2577417" on a live ESPN
   * league, which reads as broken rather than as unmapped.
   *
   * `PlayerProviderIdentity` is the table built for exactly this: provider +
   * providerPlayerId -> displayName. It is tried first and covers every provider;
   * SportsPlayer stays as the Sleeper-shaped fallback, and is the only one of the two
   * that carries position and team.
   */
  /*
   * ⚠ AN ID MEANS NOTHING WITHOUT THE PROVIDER THAT ISSUED IT, AND BOTH LOOKUPS
   * USED TO OMIT IT. The comment above says this table is keyed on provider +
   * providerPlayerId; the query matched on providerPlayerId ALONE, so an ESPN
   * athlete id was compared against every provider's id space at once.
   *
   * Measured on production, on the first ESPN league ever imported:
   *
   *   pick 13.04 -> "Liutauras Lelevicius"  (rolling_insights 15013, NCAAB)
   *   pick 4.15  -> "Carnell Tate"          (also present under cfbd/NCAAF)
   *
   * A basketball guard, rendered on an NFL draft board as a confident answer. The
   * collision surface is not marginal: 12,074 provider_player_id values appear
   * under two or more providers, and 16,710 under two or more sports.
   *
   * ⚠ THE SLEEPER LOOKUP HAD THE SAME HOLE, and it is easy to miss because the
   * column name reads like a filter. `sleeperId` holds numeric strings, so an
   * ESPN id can match one just as readily; scoping the query by provider is not
   * enough if a second unscoped query runs beside it.
   *
   * A wrong name is worse than no name here. "(not yet mapped)" is a true
   * statement about a pick we cannot resolve; a stranger's name is a false one,
   * and the screen gives the reader no way to tell them apart.
   */
  const league = await prisma.league
    .findUnique({ where: { id: leagueId }, select: { platform: true } })
    .catch(() => null)

  /*
   * ⚠ THE SHARED RESOLVER, NOT A SECOND COPY. This block used to inline its own
   * scoped lookup while the board called an UNSCOPED `resolvePlayerNames`, so the
   * two surfaces reading the same DraftFact rows could name a pick differently —
   * and the helper's own comment claimed they could not. One resolver, scoped
   * once, is what makes that claim true.
   */
  const byPlayerId = await resolvePlayerNames(
    rows.map((r) => r.playerId),
    league?.platform ?? '',
  )

  return {
    available: true,
    data: rows.map((r) => {
      const hit = byPlayerId.get(r.playerId)
      /*
       * ⚠ `pickNumber` DOES NOT MEAN THE SAME THING ACROSS PROVIDERS. Sleeper writes
       * `pick_no`, an OVERALL pick; ESPN writes the pick WITHIN the round. Assuming
       * overall printed six consecutive picks as "Pick 4" on a live ESPN league,
       * because the derived pick-in-round went negative and fell to the raw value.
       *
       * Decided from the numbers rather than from the provider name: if subtracting the
       * completed rounds lands inside the round, it was an overall pick; if the value
       * already sits inside a round, it was a pick-in-round. Neither fits, and the
       * label says only what is known.
       */
      const derived = teamCount > 0 ? r.pickNumber - (r.round - 1) * teamCount : 0
      const inRound =
        teamCount > 0 && derived >= 1 && derived <= teamCount
          ? derived
          : teamCount > 0 && r.pickNumber >= 1 && r.pickNumber <= teamCount
            ? r.pickNumber
            : 0
      return {
        overall: inRound > 0 && teamCount > 0 ? (r.round - 1) * teamCount + inRound : r.pickNumber,
        round: r.round,
        label:
          inRound > 0
            ? `${r.round}.${String(inRound).padStart(2, '0')}`
            : `Round ${r.round}`,
        playerName: hit?.name ?? `Player ${r.playerId} (not yet mapped)`,
        position: hit?.position ?? '—',
        team: hit?.team ?? null,
      }
    }),
  }
}

export async function getDraftHqData(leagueId: string, userId: string): Promise<DraftHqData | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, platform: true, leagueType: true, platformLeagueId: true },
  })
  if (!league) return null

  const base = {
    league: {
      id: league.id,
      name: leagueDisplayName(league.name),
      platform: String(league.platform ?? 'manual').toLowerCase(),
      format: league.leagueType ?? null,
    },
    lottery: {
      available: false as const,
      reason:
        'there is no lottery data in this system — no ball counts, no odds, nothing recorded. Odds derived from standings would be our invention, not this league’s rules',
    },
    queue: {
      available: false as const,
      reason: 'no pre-draft queue has been saved for this league',
    },
    keepers: {
      available: false as const,
      reason: 'no keeper declarations recorded for this league',
    },
  }

  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    select: { id: true, status: true, draftType: true, rounds: true, teamCount: true, slotOrder: true },
  })

  if (!session) {
    /* Session and slots genuinely do not exist — this app is not running a draft here,
       and saying otherwise would invent one. The picks, however, may well exist. */
    const none = { available: false as const, reason: 'no draft has been set up for this league' }
    const [madePicks, board, grades] = await Promise.all([
      loadImportedDraftPicks(leagueId, userId).catch(() => none),
      loadCompletedDraftBoard(leagueId, userId).catch(() => none),
      loadDraftGrades(leagueId, league.platform, league.platformLeagueId ?? null).catch(() => none),
    ])

    /*
     * ⚠ "NO DRAFT HAS BEEN SET UP" SAT DIRECTLY ABOVE FOURTEEN DRAFTED PICKS.
     *
     * Both statements were true and together they read as nonsense. They answer
     * different questions: `session` and `pickSlots` describe a draft THIS APP
     * WOULD RUN — an imported league has never had one — while `madePicks` and
     * `board` read the draft that already happened on the provider. The old copy
     * named neither, so a reader saw "no draft" on top of that draft's results
     * and reasonably concluded the screen was broken.
     *
     * Reported on a real ESPN league whose fourteen picks were listed, correctly
     * and by name, immediately underneath.
     *
     * The distinction is only worth drawing when there IS something below to
     * contradict — otherwise "no draft has been set up" is the whole truth and
     * qualifying it would add words to an empty screen.
     */
    const importedDraftExists = madePicks.available === true || board.available === true
    const noSession = importedDraftExists
      ? {
          available: false as const,
          reason:
            'no upcoming draft is scheduled in AllFantasy — the picks below are from the draft this league already ran',
        }
      : none

    return { ...base, session: noSession, pickSlots: noSession, madePicks, board, grades }
  }

  const myTeam = await prisma.leagueTeam.findFirst({
    where: { leagueId, claimedByUserId: userId },
    select: { externalId: true, teamName: true },
  })

  const order = Array.isArray(session.slotOrder)
    ? (session.slotOrder as Array<{ slot?: number; rosterId?: string; displayName?: string }>)
    : []

  const mySlotEntry = myTeam?.externalId
    ? order.find((o) => String(o.rosterId) === String(myTeam.externalId))
    : undefined
  const yourSlot = typeof mySlotEntry?.slot === 'number' ? mySlotEntry.slot : null

  const sessionState: DraftHqData['session'] = {
    available: true,
    data: {
      status: session.status,
      draftType: session.draftType,
      rounds: session.rounds,
      teamCount: session.teamCount,
      yourSlot,
    },
  }

  const pickSlots: SectionState<PickSlot[]> =
    yourSlot == null
      ? {
          available: false,
          reason:
            order.length === 0
              ? 'this draft has no order set, so pick slots cannot be worked out yet'
              : 'your team is not in this draft’s order, so we cannot say which picks are yours',
        }
      : {
          available: true,
          data: computePickSlots(yourSlot, session.rounds, session.teamCount, session.draftType),
        }

  const made = myTeam?.externalId
    ? await prisma.draftPick.findMany({
        where: { sessionId: session.id, rosterId: String(myTeam.externalId) },
        orderBy: { overall: 'asc' },
        select: { overall: true, round: true, slot: true, playerName: true, position: true, team: true },
      })
    : []

  const madePicks: SectionState<MadePick[]> =
    made.length > 0
      ? {
          available: true,
          data: made.map((p) => ({
            overall: p.overall,
            round: p.round,
            // ⚠ DraftPick.slot is the ROSTER's draft slot, not the pick-in-round.
            // Labelling from it printed every pick as ".02" for a slot-2 team —
            // so a snake draft read as if the same team picked second in every
            // round. The pick-in-round has to come from `overall`: pick 23 of a
            // 12-team round 2 is 2.11, which is what the computed slots above
            // already said, and the two disagreeing is what exposed this.
            label: `${p.round}.${String(p.overall - (p.round - 1) * session.teamCount).padStart(2, '0')}`,
            playerName: p.playerName,
            position: p.position,
            team: p.team,
          })),
        }
      : {
          available: false,
          reason:
            session.status === 'pre_draft'
              ? 'this draft has not run yet'
              : 'no picks recorded for your team in this draft',
        }

  /* A live session and a completed board are not exclusive: a league can be mid-draft in
     one season and hold a finished board from the last one. */
  const board = await loadCompletedDraftBoard(leagueId, userId).catch(() => ({
    available: false as const,
    reason: 'no completed draft has been imported for this league',
  }))

  const grades = await loadDraftGrades(leagueId, league.platform, league.platformLeagueId ?? null).catch(
    () => ({
      available: false as const,
      reason: 'the draft report could not be built for this league',
    }),
  )

  return { ...base, session: sessionState, pickSlots, madePicks, board, grades }
}
