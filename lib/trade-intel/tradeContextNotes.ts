import 'server-only'

import { prisma } from '@/lib/prisma'
import { getByeWeeks } from '@/lib/core-app/byeWeeks'
import { isRuledOut } from '@/lib/core-app/injuryStatus'
import { latestProjectionWeek } from '@/lib/core-app/playerProjections'
import {
  leagueWeekFromSettings,
  playoffSpots,
  playoffStartWeek,
  regularSeasonWeeks,
  tradeDeadlineWeek,
} from '@/lib/core-app/seasonTimeline'
import { getDepthRole, depthRoleNote } from './depthChartRole'
import { loadManagerProfile, managerPremiumNotes } from './managerPremium'
import { detectQbFormat } from '@/lib/core-app/slotEligibility'
import { readProtections, resolveTribeRelation } from './formatState'
import { crownValue, dethroneNote } from './kingOfTheHill'
import {
  acquisitionSafety,
  attritionNote as pirateAttritionNote,
  concentrationCorrectionNote,
  stealExposure,
} from './pirate'
import { mergeInversionNote, tribeRelationNote } from './survivor'
import {
  idolExpiryNote,
  lineupAt,
  superflexInflectionNote,
} from './survivorGuillotine'
import { bracketHorizon, rosterHorizon, tradingPolicy } from './tournament'
import { assessLeagueScale } from './leagueScale'
import {
  faabPurchasingPower,
  floorOverCeilingNote,
  guillotineHorizon,
} from './guillotine'
import {
  BOMB_POINTS,
  serumStackingNote,
  serumValue,
  tradeWindow,
  vetoRiskNote,
  weaponSurplus,
  WEAPON_POINTS,
  type WeaponTier,
} from './zombie'
import {
  impossiblePickWarning,
  keeperDriftNote,
  readFormatRules,
} from './leagueFormatRules'
import {
  assessConcentration,
  assessDeadline,
  assessRosterCrunch,
  assessUnpriced,
} from './rosterShape'
import { assessContention, postureNote } from './contention'
import {
  projectDevyOutlook,
  refuseMixedScaleGrade,
  type TradeAsset as DevyTradeAsset,
} from './devyOutlook'
import { devyAssetValue, gradeDevyTrade, type DevyTradeSide } from './devyTradeValue'
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
  /**
   * Why nothing could be computed, when that is a fixable fact about the
   * viewer rather than a finding about the deal. Absent when the ledger ran.
   */
  contextGap?: string | null
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
  /**
   * What the SHAPE of this league and this roster does to the deal, independent
   * of who is in it.
   *
   * ⚠ EVERY STORED PRICE IS A 12-TEAM PRICE. In a 32-team league that is wrong
   * in both directions at once: picks are overvalued by a multiple and starters
   * are undervalued because replacement has collapsed. These are the notes that
   * say so, along with roster crunch, deadline runway, unpriced exposure and
   * whether the deal concentrates or spreads the roster.
   */
  scaleNotes: string[]
  /**
   * What this league's FORMAT does to the deal.
   *
   * ⚠ A FUTURE PICK IN A REDRAFT TRADE IS NOT A CHEAP ASSET, IT IS A
   * NONEXISTENT ONE, and grading around it is arithmetic on something that does
   * not exist. In a keeper league the interesting number is not a player's
   * value, it is his value against what he costs to keep — a receiver kept at a
   * 2nd is a worse asset than the same receiver kept at a 7th, and they are the
   * same player on every chart in the world.
   */
  formatNotes: string[]
}

const EMPTY: TradeContextNotes = {
  byeNotes: [],
  needNotes: [],
  leverageNotes: [],
  postureNotes: [],
  pickNotes: [],
  scaleNotes: [],
  formatNotes: [],
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
  /** The console's own priced lines, for unpriced exposure. */
  pricedGive?: Array<{ name: string; marketValue: number | null }>
  pricedGet?: Array<{ name: string; marketValue: number | null }>
  /** The console's own one-sidedness figure, used only for the veto warning. */
  percentDiff?: number | null
}): Promise<TradeContextNotes> {
  const { leagueId, userId, give, get } = args
  if (get.length === 0) return EMPTY

  const league = await prisma.league
    .findUnique({
      where: { id: leagueId },
      select: {
        id: true,
        starters: true,
        season: true,
        sport: true,
        settings: true,
        leagueType: true,
        isDynasty: true,
        keeperCount: true,
        keeperCostSystem: true,
        keeperRoundPenalty: true,
      },
    })
    .catch(() => null)

  const requirements = readSlotRequirements(league?.starters)
  if (!league || !requirements || league.season == null) return EMPTY

  /*
   * The viewer's own roster in this league. Matched through LeagueTeam because
   * `Roster.platformUserId` is the PLATFORM's id for them, not ours — the same
   * two-id-space trap the scoreboard hit.
   *
   * ⚠ A CLAIMED TEAM IS NOT GUARANTEED, AND THIS FUNCTION RETURNS EVERYTHING.
   * Claiming is a deliberate action a manager may never have taken, and until
   * this fell back, an unclaimed league produced NO notes at all — not just no
   * leverage: no byes, no roster need, no league scale, no format rules. One
   * missing `claimedByUserId` silently emptied the entire ledger for that
   * league, and nothing on screen said why. `buildNativeActiveTrades` already
   * does this dual lookup for exactly this reason.
   */
  const team = await (async () => {
    const claimed = await prisma.leagueTeam
      .findFirst({
        where: { leagueId, claimedByUserId: userId },
        select: { platformUserId: true, externalId: true },
      })
      .catch(() => null)
    if (claimed?.platformUserId) return claimed

    /*
     * The linked Sleeper account. Deliberately second: a claim is an explicit
     * statement about THIS league, and a linked platform id is an inference
     * from an id space shared across all of them.
     */
    const profile = await prisma.userProfile
      .findUnique({ where: { userId }, select: { sleeperUserId: true } })
      .catch(() => null)
    const linked = profile?.sleeperUserId?.trim()
    if (!linked) return null
    return prisma.leagueTeam
      .findFirst({
        where: { leagueId, platformUserId: linked },
        select: { platformUserId: true, externalId: true },
      })
      .catch(() => null)
  })()
  /*
   * ⚠ AN EMPTY LEDGER AND A LEDGER THAT FOUND NOTHING LOOK IDENTICAL ON SCREEN.
   * Both render as no notes. Only one of them is something the manager can fix,
   * so the reason rides back and the analyzer prints it under "what we
   * couldn't see" rather than leaving a silent blank.
   */
  if (!team?.platformUserId) {
    return {
      ...EMPTY,
      contextGap:
        'which of these teams is yours — claim your team, or link the account you play on, and the league-specific read turns on',
    }
  }

  const roster = await prisma.roster
    .findFirst({
      where: { leagueId, platformUserId: team.platformUserId },
      select: { id: true, playerData: true },
    })
    .catch(() => null)
  if (!roster) {
    return {
      ...EMPTY,
      contextGap: 'your roster in this league, which has not been synced yet',
    }
  }
  const rosterRowId = roster.id

  /*
   * The counterparty's Roster row, for the Survivor tribe read. Resolved from
   * the console's opponent id through LeagueTeam, because `externalId` is the
   * platform's roster id and `Roster` is keyed on the owner.
   */
  let opponentRosterRowId: string | null = null
  if (args.opponentTeamExternalId) {
    const oppTeam = await prisma.leagueTeam
      .findFirst({
        where: { leagueId, externalId: args.opponentTeamExternalId },
        select: { platformUserId: true },
      })
      .catch(() => null)
    if (oppTeam?.platformUserId) {
      const oppRoster = await prisma.roster
        .findFirst({
          where: { leagueId, platformUserId: oppTeam.platformUserId },
          select: { id: true },
        })
        .catch(() => null)
      opponentRosterRowId = oppRoster?.id ?? null
    }
  }

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
  const scarcityForGet = await getPositionScarcity({
    leagueId,
    sport: league.sport ?? 'NFL',
    projectionWeek: await latestProjectionWeek().catch(() => null),
    positions,
  }).catch(() => new Map())
  const scarcity = scarcityForGet

  /*
   * Depth-chart role for the players coming in — the first piece of the value
   * ledger's trajectory layer. Only speaks when the role bears on the deal: a
   * confirmed starter says nothing, because that is what the price already
   * assumes.
   */
  const needNotes: string[] = []
  for (const g of get) {
    const role = await getDepthRole({
      playerName: g.name,
      team: g.team,
      position: g.position,
      sport: league.sport ?? 'NFL',
    }).catch(() => null)
    const rn = depthRoleNote({ playerName: g.name, role })
    if (rn) needNotes.push(rn)
  }

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
    /*
     * The unit every historical trade of theirs gets priced in. Read from THIS
     * league so the ratio is denominated the same way the deal on screen is —
     * a dynasty habit measured in redraft prices is a fact about the price
     * list, not about the manager.
     */
    isDynasty: Boolean(league.isDynasty),
    qbFormat: detectQbFormat(league.starters),
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

  /*
   * ⚠ IN A SHALLOW LEAGUE A MARKET PRICE IS NOT A REPLACEMENT COST. Every
   * stored value is a 12-team price and assumes the player is hard to replace.
   * With four teams and large rosters most of the NFL is unrostered, so the
   * other side can swap in something comparable for free — and a depth piece
   * that "costs" 2,000 on the chart costs approximately nothing in practice.
   *
   * Gated on measured abundance rather than on league size alone: it is the
   * empty-or-not wire that decides this, and positionScarcity already counted it.
   */
  const abundant = [...scarcityForGet.entries()]
    .filter(([, v]) => v.scarcity === 0 && v.freeAgents >= 20)
    .map(([pos, v]) => ({ pos, freeAgents: v.freeAgents }))

  const scaleNotes = await buildScaleNotes({
    abundantPositions: abundant,
    leagueId,
    settings: league.settings,
    starters: league.starters,
    rosterIds,
    format: null,
    /* Needed to discount a devy asset by how far off his draft eligibility is. */
    season: league.season,
    incoming: get.length + (args.picksToMe?.length ?? 0),
    outgoing: give.length + (args.picksToThem?.length ?? 0),
    futureLean: (args.picksToMe?.length ?? 0) - (args.picksToThem?.length ?? 0),
    pricedGive: args.pricedGive ?? [],
    pricedGet: args.pricedGet ?? [],
  }).catch(() => [])

  const formatNotes = await buildFormatNotes({
    league,
    leagueId,
    incomingIds: get
      .map((g) => players.find((p) => p.name?.toLowerCase() === g.name.toLowerCase())?.sleeperId)
      .filter((x): x is string => Boolean(x)),
    incomingNames: new Map(
      get
        .map((g) => {
          const hit = players.find((p) => p.name?.toLowerCase() === g.name.toLowerCase())
          return hit?.sleeperId ? ([hit.sleeperId, g.name] as const) : null
        })
        .filter((x): x is readonly [string, string] => x != null),
    ),
    pickCount: (args.picksToMe?.length ?? 0) + (args.picksToThem?.length ?? 0),
    percentDiff: args.percentDiff ?? null,
    userId,
    /*
     * ⚠ THESE ARE WHAT MAKE THE FORMAT BRANCHES REAL. Wiring a branch that then
     * receives nothing is the same bug as never wiring it — it just fails
     * quietly instead of visibly.
     */
    platformUserId: team.platformUserId,
    rosterIds,
    yourRosterId: rosterRowId,
    theirRosterId: opponentRosterRowId,
    givingValue: args.pricedGive?.reduce((a, l) => a + (l.marketValue ?? 0), 0) ?? null,
    gettingValue: args.pricedGet?.reduce((a, l) => a + (l.marketValue ?? 0), 0) ?? null,
  }).catch(() => [])

  return { byeNotes, needNotes, leverageNotes, postureNotes, pickNotes, scaleNotes, formatNotes }
}

/**
 * What a Zombie league's own state says about this trade.
 *
 * The two facts that decide a deal here are how many teams can still legally
 * trade, and how infected the league is — the first only ever falls and the
 * second makes serums appreciate. Both are read, not assumed.
 */
async function zombieNotesFor(
  leagueId: string,
  userId: string,
  percentDiff: number | null,
): Promise<string[]> {
  const notes: string[] = []

  const teams = await prisma.zombieLeagueTeam
    .findMany({ where: { leagueId }, select: { status: true } })
    .catch((): Array<{ status: string }> => [])
  if (teams.length >= 2) {
    const norm = (t: { status: string }) => (t.status ?? '').toLowerCase()
    const survivors = teams.filter((t) => norm(t) === 'survivor').length
    const whispererActive = teams.some((t) => norm(t) === 'whisperer')
    const zombies = teams.length - survivors - (whispererActive ? 1 : 0)

    const window = tradeWindow({ survivors, whispererActive, teamCount: teams.length })
    if (window) notes.push(window.basis)

    const serum = serumValue({ zombieCount: zombies, teamCount: teams.length })
    if (serum) notes.push(serum.basis)
  }

  /*
   * What this manager is holding, and specifically what of it is dead weight.
   *
   * ⚠ SURPLUS WEAPONS ARE THE BEST TRADE ASSET IN THE FORMAT and are invisible
   * on every chart: beyond your top two they pay you exactly nothing and pay
   * somebody holding fewer their full face value every week.
   */
  const items = await prisma.zombieTeamItem
    .findMany({
      where: { userId, isUsed: false, isExpired: false },
      select: { itemType: true, itemLabel: true },
      take: 100,
    })
    .catch((): Array<{ itemType: string; itemLabel: string | null }> => [])

  if (items.length > 0) {
    /*
     * Classified from type and label together, tolerantly: the item vocabulary
     * is not one we control, and a weapon we fail to recognise must not be
     * silently counted as a serum (or vice versa) — they cap differently, which
     * is the whole point of the notes below.
     */
    const held: number[] = []
    let serums = 0
    for (const it of items) {
      const tag = `${it.itemType ?? ''} ${it.itemLabel ?? ''}`.toLowerCase()
      if (tag.includes('serum')) {
        serums += 1
        continue
      }
      const tier = (Object.keys(WEAPON_POINTS) as WeaponTier[]).find((k) => tag.includes(k))
      if (tier) held.push(WEAPON_POINTS[tier])
      else if (tag.includes('bomb')) held.push(BOMB_POINTS)
    }

    const surplus = weaponSurplus({ held, weeksRemaining: 0 })
    if (surplus.basis) notes.push(surplus.basis)

    const stacking = serumStackingNote({ held: serums })
    if (stacking) notes.push(stacking)
  }

  /*
   * The veto warning is procedural rather than a fairness opinion: a manager
   * should know the deal may simply not stand, which is different information
   * from "you are winning this".
   */
  const veto = vetoRiskNote({ percentDiff })
  if (veto) notes.push(veto)

  return notes
}

/**
 * What a guillotine league's own state says about this trade.
 *
 * Every number here is read rather than assumed: how many teams are still alive,
 * what last period's scores actually were, and what people have really paid for
 * chopped players in this league.
 */
async function guillotineNotes(leagueId: string): Promise<string[]> {
  const notes: string[] = []

  const [states, config] = await Promise.all([
    prisma.guillotineRosterState
      .findMany({ where: { leagueId }, select: { rosterId: true, choppedAt: true } })
      .catch((): Array<{ rosterId: string; choppedAt: Date | null }> => []),
    prisma.guillotineLeagueConfig
      .findUnique({ where: { leagueId }, select: { teamsPerChop: true } })
      .catch(() => null),
  ])
  if (states.length < 2) return notes

  const alive = states.filter((s) => s.choppedAt == null)
  const horizon = guillotineHorizon({
    teamsRemaining: alive.length,
    startingTeams: states.length,
    teamsPerChop: config?.teamsPerChop ?? 1,
  })
  if (!horizon) return notes
  notes.push(horizon.basis)

  const floor = floorOverCeilingNote(horizon)
  if (floor) notes.push(floor)

  /*
   * The chop line, from the most recent period that actually has scores. The
   * distance that matters is to the BOTTOM — finishing eighth of ten is fine
   * and finishing tenth ends the season.
   */
  const latest = await prisma.guillotinePeriodScore
    .findFirst({ where: { leagueId }, orderBy: { weekOrPeriod: 'desc' }, select: { weekOrPeriod: true } })
    .catch(() => null)
  if (latest) {
    const scores = await prisma.guillotinePeriodScore
      .findMany({
        where: { leagueId, weekOrPeriod: latest.weekOrPeriod },
        select: { rosterId: true, periodPoints: true },
      })
      .catch((): Array<{ rosterId: string; periodPoints: number }> => [])

    const aliveIds = new Set(alive.map((a) => a.rosterId))
    const board = scores
      .filter((s) => aliveIds.has(s.rosterId))
      .map((s) => ({ rosterId: s.rosterId, points: s.periodPoints }))

    /*
     * Reported for the whole field rather than for one team: the console does
     * not know which guillotine roster is the viewer's, and naming the wrong
     * team's margin would be worse than naming none.
     */
    if (board.length >= 2) {
      const sorted = [...board].sort((a, b) => a.points - b.points)
      const gap = sorted[1]!.points - sorted[0]!.points
      notes.push(
        `Last period the chop line was ${sorted[0]!.points.toFixed(1)} and the next team up scored ${sorted[1]!.points.toFixed(
          1,
        )} — a margin of ${gap.toFixed(1)}. That gap is the distance that decides seasons here, not the distance to the average.`,
      )
    }
  }

  /*
   * What FAAB actually buys in THIS league, from what people have really paid.
   * Measured rather than priced off a generic anchor heuristic.
   */
  const releases = await prisma.guillotineWaiverRelease
    .findMany({
      where: { leagueId, winningBid: { not: null } },
      select: { winningBid: true },
      take: 500,
    })
    .catch((): Array<{ winningBid: number | null }> => [])

  const power = faabPurchasingPower({
    winningBids: releases.map((r) => r.winningBid).filter((b): b is number => b != null),
  })
  if (power) notes.push(power.basis)

  return notes
}

/**
 * Format rules, and — in a keeper league — what the incoming players actually
 * cost to hold.
 */
async function buildFormatNotes(args: {
  league: {
    leagueType: string | null
    isDynasty: boolean | null
    keeperCount: number | null
    keeperCostSystem: string | null
    keeperRoundPenalty: number | null
    /** Needed for every week-driven format note below. */
    settings?: unknown
  }
  leagueId: string
  incomingIds: string[]
  incomingNames: Map<string, string>
  pickCount: number
  /** How one-sided the console judged this deal, for the veto warning. */
  percentDiff: number | null
  /** The viewer, so their own item inventory can be read. */
  userId: string
  /** The viewer's platform id, for the Pirate protection read. */
  platformUserId?: string | null
  /** Roster ids on both sides, for the Survivor tribe read. */
  yourRosterId?: string | null
  theirRosterId?: string | null
  /** The viewer's whole roster, for the Pirate exposure maths. */
  rosterIds: string[]
  /** Totals, so a tribe deal can tell which way value is flowing. */
  givingValue?: number | null
  gettingValue?: number | null
}): Promise<string[]> {
  const rules = readFormatRules(args.league)
  const notes = [...rules.notes]

  const impossible = impossiblePickWarning({ rules, pickCount: args.pickCount })
  /* Leads, because it is a correctness problem rather than a nuance. */
  if (impossible) notes.unshift(impossible)

  /*
   * Guillotine has its own valuation curve entirely — a trade decays toward zero
   * as the field shrinks and FAAB is the acquisition market rather than a
   * tiebreaker. See lib/trade-intel/guillotine.ts.
   */
  /*
   * ⚠ EVERY FORMAT BELOW WAS BUILT, TESTED, MERGED AND NEVER CALLED. That is the
   * failure this repo keeps repeating, and it is worth naming at the call site
   * rather than only in a commit message: a module nothing invokes is not a
   * feature, it is a file.
   *
   * Each branch surfaces only what is derivable from the league's own settings
   * and the current week. Where a format needs state we hold no schema for —
   * pirate protections, who currently wears the KOTH crown, tribe membership —
   * the note SAYS what it would need rather than guessing at it.
   */
  const week = leagueWeekFromSettings(args.league.settings ?? null)

  if (rules.concept === 'tournament') {
    /*
     * The policy line leads and is free: most tournaments bar trading outright,
     * and that answer needs nothing but the format.
     */
    notes.unshift(tradingPolicy({ tradesEnabled: null }).basis)

    const seasonWeeks = regularSeasonWeeks(args.league.settings ?? null)
    if (week != null && seasonWeeks != null) {
      const horizon = rosterHorizon({ currentWeek: week, nextRedraftWeek: seasonWeeks + 1 })
      if (horizon) notes.push(horizon.basis)

      /*
       * Rounds remaining is inferred from the weeks left, which assumes one
       * round a week. True of the King Buffalo shape; stated because a
       * multi-week round would make it wrong.
       */
      const bracket = bracketHorizon({ roundsRemaining: Math.max(1, seasonWeeks - week + 1) })
      if (bracket) notes.push(bracket.basis)
    }
    return notes
  }

  if (rules.concept === 'king_of_the_hill') {
    const crown = crownValue({
      currentWeek: week ?? 1,
      playoffStartWeek: playoffStartWeek(args.league.settings ?? null),
    })
    if (crown) notes.push(crown.basis)

    /*
     * ⚠ WE DO NOT KNOW WHO WEARS THE CROWN. Nothing in the schema tracks it, so
     * the note is written for the challenger — the larger audience, and the one
     * whose action item (hold FAAB for the week the King looks beatable) does
     * not depend on knowing their own status.
     */
    notes.push(dethroneNote({ viewerIsKing: false }))
    return notes
  }

  if (rules.concept === 'pirate') {
    /*
     * Protections live on `Roster.settings` — see lib/trade-intel/formatState.ts
     * for why that column rather than a new table. An ABSENT list is not an
     * empty one: a manager who has not declared protections must not be told
     * their whole roster is exposed.
     */
    const prot = await readProtections({
      leagueId: args.leagueId,
      platformUserId: args.platformUserId ?? null,
    }).catch(() => ({ protectedIds: null, basis: null }))
    if (prot.basis) notes.push(prot.basis)

    if (prot.protectedIds && args.rosterIds.length > 0) {
      /*
       * Loaded here rather than threaded from the caller: only this branch needs
       * roster prices, and every other format would pay for a query it never
       * reads.
       */
      const rows = await prisma.playerValueSnapshot
        .findMany({
          where: { sleeperId: { in: args.rosterIds }, source: 'FANTASYCALC' },
          orderBy: { capturedAt: 'desc' },
          select: { sleeperId: true, value: true },
        })
        .catch((): Array<{ sleeperId: string; value: number }> => [])

      const seen = new Set<string>()
      const valueBy = new Map<string, number>()
      for (const r of rows) {
        if (seen.has(r.sleeperId)) continue
        seen.add(r.sleeperId)
        valueBy.set(r.sleeperId, r.value)
      }

      /* Unpriced roster players stay null, never zero. */
      const rosterValues = args.rosterIds.map((id) => valueBy.get(id) ?? null)
      const protectedValues = prot.protectedIds.map((id) => valueBy.get(id) ?? null)

      const exposure = stealExposure({
        rosterValues,
        protectedCount: prot.protectedIds.length,
      })
      if (exposure) notes.push(exposure.basis)

      /*
       * Whether what you are acquiring can actually be shielded. Only asked for
       * the most valuable incoming player — if the best one cannot be protected,
       * none of the others can either.
       */
      const incoming = args.incomingIds
        .map((id) => valueBy.get(id))
        .filter((v): v is number => typeof v === 'number' && v > 0)
      if (incoming.length > 0) {
        const safety = acquisitionSafety({
          incomingValue: Math.max(...incoming),
          protectedValues,
        })
        if (safety) notes.push(safety.basis)
      }
    }

    const attrition = pirateAttritionNote({
      currentWeek: week ?? 1,
      seasonWeeks: regularSeasonWeeks(args.league.settings ?? null),
    })
    if (attrition) notes.push(attrition)
    notes.push(concentrationCorrectionNote({}))
    return notes
  }

  if (rules.concept === 'survivor') {
    /*
     * The merge week is a league setting we do not read, so the inversion note
     * only fires when the season length gives us something to measure against.
     * Tribe membership is likewise unmodelled — the tribemate-vs-rival note,
     * which is the single largest factor here, needs it and is therefore absent.
     */
    const seasonWeeks = regularSeasonWeeks(args.league.settings ?? null)
    if (week != null && seasonWeeks != null) {
      const merge = mergeInversionNote({ weeksToMerge: Math.max(0, Math.round(seasonWeeks / 2) - week) })
      if (merge) notes.push(merge)
    }
    /*
     * ⚠ THE TRIBE DATA EXISTED ALL ALONG. `SurvivorTribe` and
     * `SurvivorTribeMember` were in the schema; nothing read them, so the single
     * largest factor in a pre-merge Survivor trade was absent from the verdict.
     */
    const tribe = await resolveTribeRelation({
      leagueId: args.leagueId,
      yourRosterId: args.yourRosterId ?? null,
      theirRosterId: args.theirRosterId ?? null,
    }).catch(() => ({ relation: 'unknown' as const, yourTribe: null, theirTribe: null }))

    const relationNote = tribeRelationNote({
      relation: tribe.relation,
      /* Value flowing away from the viewer is what makes a tribemate deal
         defensible and a rival deal expensive. */
      valueOutFlow: (args.givingValue ?? 0) >= (args.gettingValue ?? 0),
    })
    if (relationNote) notes.push(relationNote)
    else {
      notes.push(
        'We could not place both managers in a tribe for this league, so the biggest factor in a Survivor trade is missing: a deal with a TRIBEMATE can be worth making at a loss, because your tribe attends Tribal only if it scores lowest.',
      )
    }
    return notes
  }

  if (rules.concept === 'zombie') {
    notes.push(
      ...(await zombieNotesFor(args.leagueId, args.userId, args.percentDiff).catch(() => [])),
    )
    return notes
  }

  if (rules.concept === 'guillotine') {
    notes.push(...(await guillotineNotes(args.leagueId).catch(() => [])))

    /*
     * The Survivor All-Stars variant runs on a guillotine chassis but adds a
     * GROWING lineup and dated idol expiries. Both are week-driven, and both are
     * silent in a plain guillotine league because the schedule simply will not
     * match — lineupAt only reports an expansion that is genuinely ahead.
     */
    if (week != null) {
      const lineup = lineupAt(week)
      if (lineup?.nextAt != null) notes.push(lineup.basis)

      const sf = superflexInflectionNote({ currentWeek: week })
      if (sf) notes.push(sf)

      const idol = idolExpiryNote({ currentWeek: week, kind: 'standard' })
      if (idol) notes.push(idol)
    }
    return notes
  }

  if (rules.concept !== 'keeper' || args.incomingIds.length === 0) return notes

  /*
   * ⚠ THE DRIFT IS COMPUTED IN ROUNDS, NOT IN VALUE, AND THAT IS WHY IT WORKS.
   * Pick prices are not in our database at all — `ingestPlayerValues` filters
   * picks out of the snapshot table — so there is no chart here to price a 2nd
   * against a player. But a player's overall market RANK divided by the league
   * size is exactly the round his talent is worth, and that is enough to say
   * whether his keeper price has drifted away from what he is.
   */
  const teamCount = await prisma.leagueTeam
    .count({ where: { leagueId: args.leagueId } })
    .catch(() => 0)
  if (teamCount < 2) return notes

  const keepers = await prisma.keeperRecord
    .findMany({
      where: { leagueId: args.leagueId, playerId: { in: args.incomingIds } },
      orderBy: { originalDraftYear: 'desc' },
      select: { playerId: true, costRound: true, originalDraftRound: true, yearsKept: true },
    })
    .catch(() => [])
  if (keepers.length === 0) return notes

  const values = await prisma.playerValueSnapshot
    .findMany({
      where: { sleeperId: { in: args.incomingIds }, source: 'FANTASYCALC' },
      orderBy: { capturedAt: 'desc' },
      select: { sleeperId: true, overallRank: true },
    })
    .catch(() => [])

  const rankBy = new Map<string, number>()
  for (const v of values) {
    if (v.overallRank != null && !rankBy.has(v.sleeperId)) rankBy.set(v.sleeperId, v.overallRank)
  }

  const seen = new Set<string>()
  for (const k of keepers) {
    if (seen.has(k.playerId)) continue
    seen.add(k.playerId)

    /* His cost next season, or what he was drafted at if no cost is recorded. */
    const previousRound = k.costRound ?? k.originalDraftRound
    const rank = rankBy.get(k.playerId)
    if (previousRound == null || rank == null) continue

    const impliedRoundNow = Math.max(1, Math.ceil(rank / teamCount))
    const note = keeperDriftNote({
      playerName: args.incomingNames.get(k.playerId) ?? 'This player',
      previousRound,
      impliedRoundNow,
    })
    if (note) notes.push(note)
  }

  return notes
}

/**
 * League shape, roster shape, and the calendar.
 *
 * None of these are about the players in the deal, which is exactly why a value
 * chart cannot hold them and why they are worth saying out loud.
 */
/**
 * Which unpriced names in this deal are college players, and what that means.
 *
 * ⚠ MATCHED BY NAME, WHICH IS THE WEAKEST JOIN IN THIS FILE — but the trade
 * console passes names, college players hold no sleeperId, and the surrounding
 * code already resolves NFL players the same way. A miss here degrades to the
 * generic unpriced note, which is the safe direction: it under-claims rather
 * than mislabelling an NFL player as a college one.
 *
 * ⚠ ONLY PLAYERS WITH NO MARKET VALUE ARE CONSIDERED. A name that priced is an
 * NFL player whatever else shares his name, so he is never reinterpreted as a
 * college asset on the strength of a string match.
 *
 * Returns null when the deal contains no college assets at all, so the ordinary
 * path is untouched.
 */
async function identifyDevyAssets(args: {
  give: Array<{ name: string; marketValue: number | null }>
  get: Array<{ name: string; marketValue: number | null }>
  season: number
}): Promise<{
  matched: Array<{ name: string }>
  refusal: string | null
  standings: string[]
  verdict: string | null
} | null> {
  const all = [...args.give, ...args.get]
  const unpricedNames = all.filter((x) => x.marketValue == null).map((x) => x.name)
  if (unpricedNames.length === 0) return null

  const select = {
    name: true,
    position: true,
    school: true,
    draftEligibleYear: true,
    recruitingComposite: true,
    breakoutAge: true,
    projectedDraftRound: true,
    devyAdp: true,
    draftProjectionScore: true,
  } as const

  const candidates = await prisma.devyPlayer.findMany({
    where: {
      graduatedToNFL: false,
      OR: unpricedNames.map((n) => ({ name: { equals: n, mode: 'insensitive' as const } })),
    },
    select,
  })
  if (candidates.length === 0) return null

  const assets: DevyTradeAsset[] = [
    ...candidates.map((c) => ({ label: c.name, kind: 'devy_player' as const })),
    ...all
      .filter((x) => x.marketValue != null)
      .map((x) => ({ label: x.name, kind: 'nfl_player' as const })),
  ]
  const refusal = refuseMixedScaleGrade(assets)?.reason ?? null

  const outlookFor = (c: (typeof candidates)[number]) =>
    projectDevyOutlook({
      player: c,
      draftEligibleYear: c.draftEligibleYear,
      currentSeason: args.season,
      name: c.name,
    })

  const standings = candidates.map(
    (c) => `${c.name} (${c.position}, ${c.school}) — ${outlookFor(c).basis}`,
  )

  /*
   * ⚠ RANK MUST BE AGAINST THE WHOLE BOARD, NOT THE PLAYERS IN THE DEAL. Ranking
   * the two prospects in a trade against each other makes them #1 and #2 and
   * therefore near-elite by construction, which is how a swap of two nobodies
   * would grade as a blockbuster.
   *
   * The whole non-null score column is ~800 floats, so it is cheaper to pull and
   * rank in memory than to issue a positional COUNT per player.
   */
  const board = await prisma.devyPlayer.findMany({
    where: { graduatedToNFL: false, draftProjectionScore: { not: null } },
    select: { draftProjectionScore: true },
  })
  const descending = board
    .map((b) => b.draftProjectionScore as number)
    .sort((a, b) => b - a)

  const rankOf = (score: number | null): number | null => {
    if (score == null) return null
    /* One-based rank: how many players score strictly higher, plus one. */
    let lo = 0
    let hi = descending.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (descending[mid] > score) lo = mid + 1
      else hi = mid
    }
    return lo + 1
  }

  /*
   * A verdict only when the deal is devy on BOTH sides. A mixed deal is refused
   * above, and devy points cannot settle a trade whose other half is priced in
   * market units.
   */
  let verdict: string | null = null
  if (!refusal) {
    const byName = new Map(candidates.map((c) => [c.name.toLowerCase(), c]))
    const toSide = (lines: Array<{ name: string }>): DevyTradeSide[] =>
      lines
        .map((l) => byName.get(l.name.toLowerCase()))
        .filter((c): c is (typeof candidates)[number] => c != null)
        .map((c) => ({
          label: c.name,
          value: devyAssetValue({
            devyRank: rankOf(c.draftProjectionScore),
            outlook: outlookFor(c),
            name: c.name,
          }),
        }))

    const give = toSide(args.give)
    const get = toSide(args.get)
    if (give.length > 0 && get.length > 0) {
      verdict = gradeDevyTrade({ give, get }).basis
    }
  }

  return {
    matched: candidates.map((c) => ({ name: c.name })),
    refusal,
    standings,
    verdict,
  }
}

async function buildScaleNotes(args: {
  abundantPositions: Array<{ pos: string; freeAgents: number }>
  leagueId: string
  settings: unknown
  starters: unknown
  rosterIds: string[]
  format: string | null
  incoming: number
  outgoing: number
  futureLean: number
  pricedGive: Array<{ name: string; marketValue: number | null }>
  pricedGet: Array<{ name: string; marketValue: number | null }>
  /** The season being played, so a devy asset's wait can be priced. */
  season: number
}): Promise<string[]> {
  const notes: string[] = []

  const teamCount = await prisma.leagueTeam
    .count({ where: { leagueId: args.leagueId } })
    .catch(() => 0)

  if (teamCount >= 2) {
    const scale = assessLeagueScale({ teamCount, starters: args.starters })
    if (scale) notes.push(...scale.notes)
  }

  /*
   * Roster size is the FULL `roster_positions` list, bench and IR included —
   * that is what the platform enforces. Using only the starting slots would
   * report every legal roster as illegal.
   */
  const rosterSize = Array.isArray(args.starters) ? args.starters.length : null
  const crunch = assessRosterCrunch({
    rosterSize,
    held: args.rosterIds.length,
    incoming: args.incoming,
    outgoing: args.outgoing,
  })
  if (crunch.basis) notes.push(crunch.basis)

  const deadline = assessDeadline({
    currentWeek: leagueWeekFromSettings(args.settings),
    seasonWeeks: regularSeasonWeeks(args.settings),
    deadlineWeek: tradeDeadlineWeek(args.settings),
    futureLean: args.futureLean,
  })
  if (deadline.basis) notes.push(deadline.basis)

  /*
   * ⚠ A COLLEGE PLAYER IS UNPRICED FOR A DIFFERENT REASON THAN A DEFENDER IS,
   * AND SAYING THE WRONG ONE IS WORSE THAN SAYING NOTHING. `assessUnpriced`
   * explains a null value with "our value feed covers offence and picks only",
   * which is true of an IDP linebacker and false of a devy wideout — nothing
   * anywhere prices him, and no amount of feed coverage would. Worse, the deal
   * spans two scales that do not convert, so the verdict is not merely partial;
   * it is not a verdict. See lib/trade-intel/devyOutlook.ts.
   *
   * So devy assets are pulled OUT of the generic count and explained on their
   * own terms, leaving that note to speak only about players it is actually
   * right about.
   */
  const devy = await identifyDevyAssets({
    give: args.pricedGive,
    get: args.pricedGet,
    season: args.season,
  }).catch(() => null)

  const devyNames = new Set(devy?.matched.map((m) => m.name.toLowerCase()) ?? [])
  const notDevy = (l: Array<{ name: string; marketValue: number | null }>) =>
    l.filter((x) => !devyNames.has(x.name.toLowerCase()))

  const unpriced = assessUnpriced({
    give: notDevy(args.pricedGive),
    get: notDevy(args.pricedGet),
  })
  if (unpriced.basis) notes.push(unpriced.basis)

  if (devy) {
    /*
     * Leads, like impossiblePickWarning: a verdict that silently spans both
     * scales is a correctness problem, not a nuance.
     */
    if (devy.refusal) notes.unshift(devy.refusal)
    /*
     * The devy-for-devy verdict leads too when there is one — it is the answer
     * to the question the manager actually asked, and the per-player standings
     * below are the working behind it.
     */
    if (devy.verdict) notes.unshift(devy.verdict)
    notes.push(...devy.standings)
  }

  /*
   * Only in a shallow league, and only for positions the wire actually holds in
   * quantity. Saying this in a 12-team league would be wrong, and saying it for
   * a position with four spare bodies would be noise.
   */
  if (teamCount >= 2 && teamCount <= 8) {
    for (const a of args.abundantPositions) {
      notes.push(
        `${a.freeAgents} startable ${a.pos}s are unrostered in this league. Any ${a.pos} in this deal is priced as though he were scarce — here he is a waiver claim, so treat his market value as a ceiling.`,
      )
    }
  }

  /*
   * Concentration needs the roster's own prices. One read, and it is skipped
   * entirely when the deal carries no priced players either way — there is
   * nothing to compare against.
   */
  const dealValues = [...args.pricedGive, ...args.pricedGet].filter((x) => x.marketValue != null)
  if (dealValues.length > 0 && args.rosterIds.length >= 3) {
    const rows = await prisma.playerValueSnapshot
      .findMany({
        where: { sleeperId: { in: args.rosterIds }, source: 'FANTASYCALC' },
        orderBy: { capturedAt: 'desc' },
        select: { sleeperId: true, value: true },
      })
      .catch(() => [])
    const seen = new Set<string>()
    const rosterValues: Array<number | null> = []
    for (const r of rows) {
      if (seen.has(r.sleeperId)) continue
      seen.add(r.sleeperId)
      rosterValues.push(r.value)
    }
    /* Unpriced roster players are nulls, never zeros — see assessConcentration. */
    for (const id of args.rosterIds) if (!seen.has(id)) rosterValues.push(null)

    const conc = assessConcentration({
      rosterValues,
      incoming: args.pricedGet.map((x) => x.marketValue),
      outgoing: args.pricedGive.map((x) => x.marketValue),
    })
    if (conc.basis) notes.push(conc.basis)
  }

  return notes
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
  isDynasty: boolean
  qbFormat: 'ONE_QB' | 'SUPERFLEX'
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

  /*
   * ── How they have actually traded, layer 5's last factor ──────────────
   *
   * Structural leverage (their holes, the waiver wire) says what a position is
   * worth to them today. This says what they have HISTORICALLY paid for it,
   * which is a separate fact and the only one on this page that comes from
   * behaviour. It is reported and never folded into the price — a manager
   * overpays for backs largely because they are short at back, so applying both
   * would count the same shortage twice.
   */
  const profile = await loadManagerProfile({
    managerKey: team.platformUserId,
    isDynasty: args.isDynasty,
    qbFormat: args.qbFormat,
  }).catch(() => null)
  if (profile) {
    notes.push(
      ...managerPremiumNotes({
        who,
        profile,
        givePositions: give.map((g) => g.position ?? '').filter(Boolean),
      }),
    )
  }
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
