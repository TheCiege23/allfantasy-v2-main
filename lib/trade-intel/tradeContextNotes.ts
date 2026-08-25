import 'server-only'

import { prisma } from '@/lib/prisma'
import { getByeWeeks } from '@/lib/core-app/byeWeeks'
import { isRuledOut } from '@/lib/core-app/injuryStatus'
import { latestProjectionWeek } from '@/lib/core-app/playerProjections'
import {
  leagueWeekFromSettings,
  playoffSpots,
  regularSeasonWeeks,
} from '@/lib/core-app/seasonTimeline'
import { assessContention, postureNote } from './contention'
import { pickInflationWarning, projectPickSlot } from './pickOutlook'
import { getPositionScarcity } from './positionScarcity'
import {
  byeCollisionDelta,
  computeRosterNeed,
  counterpartyPriceDelta,
  readSlotRequirements,
  type SlotRequirements,
} from './rosterNeed'

/**
 * The two sentences a trade screen can say that the value maths cannot.
 *
 * ⚠ ADVISORY, AND IT DOES NOT TOUCH THE VERDICT. The console's own value maths
 * decides whether a trade is fair. This adds what the maths cannot see: that
 * the quarterback coming back is off the same week as the one you already have,
 * so the deal you are about to accept does not fix the hole it looks like it
 * fixes. The manager may take it anyway — two years of a player of that calibre
 * can be worth one unstartable Sunday — and that call is theirs to make on
 * purpose rather than by accident.
 *
 * Returns an empty array whenever anything it needs is missing. A trade screen
 * that guesses at bye collisions trains managers to ignore the warning, which
 * costs them the week it was actually about.
 */

/** Byes run into the teens, so the whole remaining season is in scope. */
const SEASON_HORIZON = 18

type Line = { name: string; position: string | null; team: string | null }

export type TradeContextNotes = {
  /** Bye-week collisions this deal creates or fails to relieve. */
  byeNotes: string[]
  /**
   * What this deal is worth to THIS roster over the market price, and why.
   *
   * ⚠ THE SCARCITY HALF IS THE POINT. A hole at a position with a dozen free
   * agents behind it is a waiver claim, not a need. The same hole with an empty
   * wire can only be filled by trading, and that is when a replacement-level
   * player is genuinely worth more here than his market price.
   */
  needNotes: string[]
  /**
   * What the OTHER side needs, and therefore what you can ask for.
   *
   * ⚠ THE MIRROR OF `needNotes`, AND THE HALF THAT CHANGES BEHAVIOUR. Knowing a
   * player is worth more to you tells you to accept. Knowing he is worth more to
   * THEM tells you not to hand him over at market price — which is the move a
   * manager actually gets wrong, because the market price feels like the fair
   * price right up until you learn the other side has no other way to fill the
   * slot.
   *
   * Empty when no opponent was named, which is the common case: the console
   * runs perfectly well as a two-sided calculator with nobody on the other end.
   */
  leverageNotes: string[]
  /**
   * Where each side stands, and what shape of deal that makes correct.
   *
   * ⚠ A TRADE IS NOT GOOD OR BAD IN THE ABSTRACT. A 3-7 team sending its
   * quarterback out for picks is doing the right thing; a grader that prices the
   * assets and stops tells them they lost.
   */
  postureNotes: string[]
  /**
   * What the picks in this deal are actually likely to be.
   *
   * ⚠ "A 2027 1ST" IS A RANGE, NOT A VALUE, and which end it lands at depends
   * on the team it comes from. A first from the side acquiring the best player
   * in the deal is a late first.
   */
  pickNotes: string[]
}

const EMPTY: TradeContextNotes = {
  byeNotes: [],
  needNotes: [],
  leverageNotes: [],
  postureNotes: [],
  pickNotes: [],
}

/** A future pick in the deal, and which side it is coming from. */
export type PickLine = { season: number; round: number }

export async function buildTradeContextNotes(args: {
  leagueId: string
  userId: string
  /** Players leaving the viewer's roster. */
  give: Line[]
  /** Players arriving on the viewer's roster. */
  get: Line[]
  /** `LeagueTeam.externalId` of the other side, when the console knows it. */
  opponentTeamExternalId?: string | null
  /** Picks coming to the viewer — they originate from the opponent. */
  picksToMe?: PickLine[]
  /** Picks the viewer is sending — they originate from the viewer. */
  picksToThem?: PickLine[]
  /**
   * Which side receives the most valuable player in the deal, by market price.
   * Drives the pick-inflation warning: a first from the team that just acquired
   * the best asset lands later than their record suggests.
   */
  bestPlayerGoesTo?: 'me' | 'them' | null
}): Promise<TradeContextNotes> {
  const { leagueId, userId, give, get } = args
  if (get.length === 0) return EMPTY

  const league = await prisma.league
    .findUnique({
      where: { id: leagueId },
      select: { id: true, starters: true, season: true, sport: true, settings: true },
    })
    .catch(() => null)

  const requirements = readSlotRequirements(league?.starters)
  if (!league || !requirements || league.season == null) return EMPTY

  /*
   * The viewer's own roster in this league. Matched through LeagueTeam because
   * `Roster.platformUserId` is the PLATFORM's id for them, not ours — the same
   * two-id-space trap the scoreboard hit.
   */
  const team = await prisma.leagueTeam
    .findFirst({
      where: { leagueId, claimedByUserId: userId },
      select: { platformUserId: true, externalId: true },
    })
    .catch(() => null)
  if (!team?.platformUserId) return EMPTY

  const roster = await prisma.roster
    .findFirst({
      where: { leagueId, platformUserId: team.platformUserId },
      select: { playerData: true },
    })
    .catch(() => null)
  if (!roster) return EMPTY

  const pd = (roster.playerData ?? {}) as Record<string, unknown>
  const rosterIds = Array.isArray(pd.players)
    ? pd.players.map((x) => String(x)).filter((x) => x && x !== '0')
    : []
  if (rosterIds.length === 0) return EMPTY

  const players = await prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: rosterIds } },
      select: { sleeperId: true, position: true, team: true, name: true },
    })
    .catch(() => [])

  const byId = new Map(players.filter((p) => p.sleeperId).map((p) => [p.sleeperId as string, p]))

  /*
   * Byes are resolved from TEAMS, so incoming players ride along under synthetic
   * ids. They are not on any roster yet and have no sleeper id in this context.
   */
  const playerTeams = new Map<string, string | null>()
  for (const id of rosterIds) playerTeams.set(id, byId.get(id)?.team ?? null)
  get.forEach((g, i) => playerTeams.set(`in:${i}`, g.team ?? null))

  /*
   * Who on this roster is actually available. A kicker on IR does not fill the
   * kicker slot, and a need model that counts bodies cannot see the case the
   * manager most needs pricing for.
   */
  const rosterInjuries = await prisma.sportsInjury
    .findMany({
      where: { sport: league.sport ?? 'NFL', playerName: { in: players.map((p) => p.name) } },
      orderBy: { fetchedAt: 'desc' },
      select: { playerName: true, status: true },
    })
    .catch(() => [])
  const statusByName = new Map<string, string | null>()
  for (const i of rosterInjuries) {
    const k = i.playerName.toLowerCase()
    if (!statusByName.has(k)) statusByName.set(k, i.status)
  }

  const byes = await getByeWeeks({
    sport: league.sport ?? 'NFL',
    season: league.season,
    playerTeams,
    // From the start of the season: a trade in week 2 still cares about week 11.
    fromWeek: 1,
    horizon: SEASON_HORIZON,
  }).catch(() => null)
  if (!byes) return EMPTY

  /** id -> the week they are off, inverted from the week-keyed map. */
  const byeOf = new Map<string, number>()
  for (const [week, ids] of byes.byWeek) for (const id of ids) byeOf.set(id, week)

  const rosterLines = rosterIds.map((id) => ({
    id,
    position: byId.get(id)?.position ?? '',
    byeWeek: byeOf.get(id) ?? null,
  }))

  /*
   * What is leaving, matched by name against the roster we just read. Names are
   * the only handle the console gives us; an unmatched give simply does not
   * count as outgoing, which errs toward reporting FEWER collisions.
   */
  const outgoingIds = give
    .map((g) => {
      const hit = players.find((p) => p.name?.toLowerCase() === g.name.toLowerCase())
      return hit?.sleeperId ?? null
    })
    .filter((x): x is string => Boolean(x))

  const byeNotes: string[] = []
  get.forEach((g, i) => {
    const d = byeCollisionDelta({
      requirements,
      roster: rosterLines,
      incoming: { position: g.position, byeWeek: byeOf.get(`in:${i}`) ?? null },
      outgoingIds,
    })
    if (!d) return
    if (d.created.length > 0 || d.unrelieved.length > 0) {
      byeNotes.push(`${g.name}: ${d.basis}`)
    }
  })

  /*
   * The need half. Computed on the roster AFTER the outgoing side leaves —
   * sending your only tight end away is exactly how a trade creates the hole it
   * is supposed to fill, and a need read on the pre-trade roster cannot see it.
   */
  const outgoing = new Set(outgoingIds)
  const need = computeRosterNeed({
    requirements,
    rostered: rosterIds
      .filter((id) => !outgoing.has(id))
      .map((id) => ({
        position: byId.get(id)?.position ?? '',
        unavailable: isRuledOut(statusByName.get((byId.get(id)?.name ?? '').toLowerCase()) ?? null),
      })),
  })

  const positions = [...new Set(get.map((g) => g.position).filter((p): p is string => Boolean(p)))]
  const scarcity = await getPositionScarcity({
    leagueId,
    sport: league.sport ?? 'NFL',
    projectionWeek: await latestProjectionWeek().catch(() => null),
    positions,
  }).catch(() => new Map())

  const needNotes: string[] = []
  for (const g of get) {
    if (!g.position) continue
    const pos = g.position.toUpperCase().trim()
    const d = counterpartyPriceDelta({
      position: pos,
      need,
      scarcity: scarcity.get(pos) ?? null,
    })
    /*
     * Only when it moves the price. "Their K slots are exactly filled" is true
     * and worth nothing on screen, and a panel full of non-findings is one
     * managers stop reading.
     */
    if (!d || d.factor === 1) continue
    const pct = Math.round((d.factor - 1) * 100)
    needNotes.push(
      `${g.name} is worth about ${Math.abs(pct)}% ${pct > 0 ? 'more' : 'less'} to you than his market price — ${d.basis}`,
    )
  }

  /*
   * ── Leverage: the same machinery pointed the other way ────────────────
   *
   * What YOU are giving up, priced against THEIR holes and the same waiver wire.
   * A manager who knows the other side cannot replace a kicker does not hand one
   * over at market price.
   */
  const leverageNotes = await buildLeverageNotes({
    leagueId,
    sport: league.sport ?? 'NFL',
    requirements,
    opponentTeamExternalId: args.opponentTeamExternalId ?? null,
    give,
    /* What they are sending you leaves THEIR roster, so it is their outgoing. */
    theirOutgoingNames: get.map((g) => g.name),
  }).catch(() => [])

  const { postureNotes, pickNotes } = await buildPostureAndPickNotes({
    leagueId,
    settings: league.settings,
    season: league.season,
    userId,
    opponentTeamExternalId: args.opponentTeamExternalId ?? null,
    picksToMe: args.picksToMe ?? [],
    picksToThem: args.picksToThem ?? [],
    bestPlayerGoesTo: args.bestPlayerGoesTo ?? null,
  }).catch(() => ({ postureNotes: [], pickNotes: [] }))

  return { byeNotes, needNotes, leverageNotes, postureNotes, pickNotes }
}

/**
 * Contention posture for both sides, and what the picks in the deal really are.
 *
 * One standings read serves both: posture is a statement about a team's record,
 * and a pick's likely slot is a statement about the record of the team it comes
 * from. They are the same query asked twice.
 */
async function buildPostureAndPickNotes(args: {
  leagueId: string
  settings: unknown
  season: number | null
  userId: string
  opponentTeamExternalId: string | null
  picksToMe: PickLine[]
  picksToThem: PickLine[]
  bestPlayerGoesTo: 'me' | 'them' | null
}): Promise<{ postureNotes: string[]; pickNotes: string[] }> {
  const none = { postureNotes: [] as string[], pickNotes: [] as string[] }

  const teams = await prisma.leagueTeam
    .findMany({
      where: { leagueId: args.leagueId },
      select: {
        id: true,
        externalId: true,
        teamName: true,
        ownerName: true,
        claimedByUserId: true,
        wins: true,
        losses: true,
        ties: true,
        currentRank: true,
      },
      orderBy: [{ currentRank: 'asc' }, { wins: 'desc' }, { pointsFor: 'desc' }],
    })
    .catch(() => [])
  if (teams.length < 4) return none

  const standings = teams.map((t) => ({
    teamId: t.id,
    wins: t.wins,
    losses: t.losses,
    ties: t.ties,
    rank: t.currentRank,
  }))

  const spots = playoffSpots(args.settings)
  const weeks = regularSeasonWeeks(args.settings)
  const currentWeek = leagueWeekFromSettings(args.settings)

  const mine = teams.find((t) => t.claimedByUserId === args.userId) ?? null
  const theirs = args.opponentTeamExternalId
    ? teams.find((t) => t.externalId === args.opponentTeamExternalId) ?? null
    : null

  const stateFor = (teamId: string | undefined) =>
    teamId
      ? assessContention({
          standings,
          teamId,
          playoffSpots: spots,
          seasonWeeks: weeks,
          currentWeek,
        })
      : null

  const myState = stateFor(mine?.id)
  const theirState = stateFor(theirs?.id)

  /*
   * Which way the deal leans. Picks are the only unambiguous future asset we can
   * count here — a young starter is future value too, but calling that from a
   * name would be a guess, and a guess in this position tells a manager their
   * rebuild is a win-now move.
   */
  const futureLeanForMe = args.picksToMe.length - args.picksToThem.length

  const postureNotes: string[] = []
  if (myState) {
    const n = postureNote({ state: myState, futureLean: futureLeanForMe })
    if (n) postureNotes.push(`You: ${n.replace(/^They are /, '')}`)
  }
  if (theirState) {
    const n = postureNote({ state: theirState, futureLean: -futureLeanForMe })
    if (n) postureNotes.push(`${theirs?.teamName || theirs?.ownerName || 'They'}: ${n.replace(/^They are /, '')}`)
  }

  /*
   * Picks. Each one is priced against the record of the team it comes FROM, not
   * against a round average.
   */
  const pickNotes: string[] = []
  const currentSeason = args.season
  if (currentSeason != null) {
    const add = (
      p: PickLine,
      from: { rank: number | null; name: string } | null,
      senderIsAcquiringStar: boolean,
    ) => {
      const outlook = projectPickSlot({
        season: p.season,
        round: p.round,
        currentSeason,
        senderRank: from?.rank ?? null,
        teamCount: teams.length,
        senderName: from?.name ?? null,
      })
      /*
       * A round-average estimate is not a finding. Saying "we priced it as a
       * middle pick" on every pick in every deal is noise that buries the one
       * line that matters.
       */
      if (!outlook.isRoundAverage) pickNotes.push(outlook.basis)
      const warn = pickInflationWarning({
        senderIsAcquiringStar,
        season: p.season,
        round: p.round,
      })
      if (warn) pickNotes.push(warn)
    }

    for (const p of args.picksToMe) {
      add(
        p,
        theirs
          ? { rank: theirs.currentRank, name: theirs.teamName || theirs.ownerName || 'Their team' }
          : null,
        args.bestPlayerGoesTo === 'them',
      )
    }
    for (const p of args.picksToThem) {
      add(
        p,
        mine ? { rank: mine.currentRank, name: 'Your team' } : null,
        args.bestPlayerGoesTo === 'me',
      )
    }
  }

  return { postureNotes, pickNotes }
}

/**
 * The other side's needs, from their roster.
 *
 * Deliberately a separate read rather than a parameter on the main function:
 * the opponent is optional and most analyses do not name one, so this cost is
 * only paid when there is actually a counterparty to reason about.
 */
async function buildLeverageNotes(args: {
  leagueId: string
  sport: string
  requirements: SlotRequirements
  opponentTeamExternalId: string | null
  /** Players heading to them. */
  give: Line[]
  /** Players they are sending away, which leaves holes on their side. */
  theirOutgoingNames: string[]
}): Promise<string[]> {
  const { leagueId, sport, requirements, opponentTeamExternalId, give } = args
  if (!opponentTeamExternalId || give.length === 0) return []

  const team = await prisma.leagueTeam
    .findFirst({
      where: { leagueId, externalId: opponentTeamExternalId },
      select: { platformUserId: true, teamName: true, ownerName: true },
    })
    .catch(() => null)
  if (!team?.platformUserId) return []

  const roster = await prisma.roster
    .findFirst({
      where: { leagueId, platformUserId: team.platformUserId },
      select: { playerData: true },
    })
    .catch(() => null)
  if (!roster) return []

  const pd = (roster.playerData ?? {}) as Record<string, unknown>
  const ids = Array.isArray(pd.players)
    ? pd.players.map((x) => String(x)).filter((x) => x && x !== '0')
    : []
  if (ids.length === 0) return []

  const players = await prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: ids } },
      select: { sleeperId: true, name: true, position: true },
    })
    .catch(() => [])
  const byId = new Map(players.filter((p) => p.sleeperId).map((p) => [p.sleeperId as string, p]))

  const injuries = await prisma.sportsInjury
    .findMany({
      where: { sport, playerName: { in: players.map((p) => p.name) } },
      orderBy: { fetchedAt: 'desc' },
      select: { playerName: true, status: true },
    })
    .catch(() => [])
  const statusByName = new Map<string, string | null>()
  for (const i of injuries) {
    const k = i.playerName.toLowerCase()
    if (!statusByName.has(k)) statusByName.set(k, i.status)
  }

  /* Their roster after the deal removes what they are sending you. */
  const leaving = new Set(
    args.theirOutgoingNames.map((n) => n.toLowerCase()).filter(Boolean),
  )
  const need = computeRosterNeed({
    requirements,
    rostered: ids
      .filter((id) => !leaving.has((byId.get(id)?.name ?? '').toLowerCase()))
      .map((id) => ({
        position: byId.get(id)?.position ?? '',
        unavailable: isRuledOut(statusByName.get((byId.get(id)?.name ?? '').toLowerCase()) ?? null),
      })),
  })

  const positions = [...new Set(give.map((g) => g.position).filter((p): p is string => Boolean(p)))]
  const scarcity = await getPositionScarcity({
    leagueId,
    sport,
    projectionWeek: await latestProjectionWeek().catch(() => null),
    positions,
  }).catch(() => new Map())

  const who = team.teamName || team.ownerName || 'they'
  const notes: string[] = []
  for (const g of give) {
    if (!g.position) continue
    const pos = g.position.toUpperCase().trim()
    const d = counterpartyPriceDelta({ position: pos, need, scarcity: scarcity.get(pos) ?? null })
    /*
     * Only a PREMIUM is leverage. That they are deep at the position is true and
     * is not something a manager can act on — and a panel that also lists every
     * non-finding is one people stop reading.
     */
    if (!d || d.factor <= 1) continue
    const pct = Math.round((d.factor - 1) * 100)
    notes.push(
      `${who} would value ${g.name} about ${pct}% above market — ${d.basis}. Do not hand him over at the market price.`,
    )
  }
  return notes
}
