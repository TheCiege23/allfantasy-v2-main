import 'server-only'
import { injuryStatusLookup } from '@/lib/injuries/matchInjuryRows'

import { prisma } from '@/lib/prisma'
import { isRuledOut } from '@/lib/core-app/injuryStatus'
import { normalizePosition } from '@/lib/core-app/positionNormalization'
import { isForeignIdSpace } from '@/lib/core-app/rosterIdSpace'
import { latestProjectionWeek } from '@/lib/core-app/playerProjections'
import {
  computeRosterNeed,
  counterpartyPriceDelta,
  readSlotRequirements,
  type RosterNeed,
  type RosteredSlot,
  type SlotRequirements,
} from '@/lib/trade-intel/rosterNeed'
import { getPositionScarcity, type ScarcityBoard } from '@/lib/trade-intel/positionScarcity'
import { resolveViewerLeagueRoster } from '@/lib/trade-intel/viewerLeagueRoster'
import type { LeagueValueAdjustment } from './leagueTradeValue'
import {
  learnedNeedOn,
  learnedBoardNeedPremium,
  learnedBoardOn,
  learnedBoardPostureAdjustment,
  learnedNeedPremium,
  loadLearnedBoard,
  type LearnedBoard,
  learnedPostureAdjustment,
  learnedPostureOn,
  loadLearnedTables,
  type LearnedTables,
} from '@/lib/trade-market/learnedInGrades'
import { postureOf, VETERAN_MIN_AGE, YOUTH_MAX_AGE, type Posture } from '@/lib/trade-market/postureMarketLearner'

/** One asset in the deal, as the need model sees it. `base` orders who fills a hole first. */
export type NeedLine = {
  name: string
  position: string | null
  base: number | null
  injuryStatus?: string | null
  /** Sleeper id, when known — the learned contend/rebuild move reads the player's age by it. */
  sleeperId?: string | null
  /** True for a draft-pick line. */
  isPick?: boolean
}

/**
 * The learned tables in the need model (`lib/trade-market/learnedInGrades.ts`), each behind its own switch.
 * `book` is the chart's market book key ("DYNASTY:SUPERFLEX"), the book the tables were measured in.
 */
export type LearnedNeedInputs = {
  book: string
  tables: LearnedTables
  /** `TRADE_LEARNED_NEED=on`: the measured premium for a position you cannot fill replaces the hand-set one. */
  need: boolean
  /** `TRADE_LEARNED_POSTURE=on`, with your record: what teams with that record pay for what you take on. */
  posture: Posture | null
  /** Players' ages today, by Sleeper id — for the posture move's "27 or older" / "24 or younger". */
  ages?: ReadonlyMap<string, number | null>
  /**
   * `TRADE_LEARNED_BOARD=on`, in an NBA / MLB / NHL / NCAAB / soccer league: that sport's published premiums. When set,
   * need and posture read THESE and never the NFL tables.
   */
  board?: LearnedBoard | null
}

export type NeedFactors = {
  give: Array<LeagueValueAdjustment | null>
  get: Array<LeagueValueAdjustment | null>
  /** Why need could not be priced at all — printed under "what we couldn't see". Null when it ran. */
  gap: string | null
}

/**
 * What the learned tables contribute, when a switch is on and the book is known; null otherwise (the need model then
 * runs exactly as before). Posture needs the team's record, read from `LeagueTeam`, and the incoming players' ages.
 */
async function learnedInputsFor(args: { book: string | null; leagueId: string; teamExternalId: string | null; get: NeedLine[]; sport?: string | null }): Promise<LearnedNeedInputs | null> {
  const sport = String(args.sport ?? '').trim().toUpperCase()
  if (sport && sport !== 'NFL') {
    // The other sports have their own table and their own switch; the NFL tables never apply to them.
    if (!learnedBoardOn()) return null
    const board = await loadLearnedBoard(prisma, sport)
    if (board.premiums.length === 0) return null
    let posture: Posture | null = null
    if (args.teamExternalId != null && board.premiums.some((p) => p.kind === 'posture')) {
      const team = await prisma.leagueTeam.findUnique({
        where: { leagueId_externalId: { leagueId: args.leagueId, externalId: args.teamExternalId } },
        select: { wins: true, losses: true, ties: true },
      })
      posture = team ? postureOf(team, team.wins + team.losses + team.ties + 1) : null
    }
    return { book: `SPORT:${sport}`, tables: { picks: new Map(), need: new Map(), posture: new Map() }, need: true, posture, board }
  }
  const needOn = learnedNeedOn()
  const postureOn = learnedPostureOn() && args.teamExternalId != null
  if (!args.book || (!needOn && !postureOn)) return null
  const tables = await loadLearnedTables(prisma)
  let posture: Posture | null = null
  let ages: Map<string, number | null> | undefined
  if (postureOn) {
    const team = await prisma.leagueTeam.findUnique({
      where: { leagueId_externalId: { leagueId: args.leagueId, externalId: args.teamExternalId! } },
      select: { wins: true, losses: true, ties: true },
    })
    // The posture rule needs week 4 on: three games played, read as the week after them.
    const games = team ? team.wins + team.losses + team.ties : 0
    posture = team ? postureOf(team, games + 1) : null
    const ids = args.get.flatMap((l) => (l.sleeperId ? [l.sleeperId] : []))
    if (posture && ids.length) {
      const rows = await prisma.sportsPlayer.findMany({ where: { sleeperId: { in: ids } }, select: { sleeperId: true, age: true } })
      ages = new Map(rows.flatMap((r) => (r.sleeperId ? [[r.sleeperId, r.age ?? null] as const] : [])))
    }
  }
  return { book: args.book, tables, need: needOn, posture, ages }
}

const none = (give: NeedLine[], get: NeedLine[], gap: string | null): NeedFactors => ({
  give: give.map(() => null),
  get: get.map(() => null),
  gap,
})

/**
 * What each asset in a deal is worth to the VIEWER'S roster in this league, over its market price.
 *
 * The price rule is `counterpartyPriceDelta` — a hole at a position you can fill off waivers is a
 * claim, not a need; the same hole with an empty wire can only be filled by trading, and that is
 * when a player is genuinely worth more to you than the chart says. This function decides which
 * assets the rule applies to. PURE apart from `loadViewerNeedFactors` below.
 *
 * ⚠ INCOMING IS PRICED AGAINST THE ROSTER AFTER THE OUTGOING SIDE LEAVES — sending your only tight
 * end away is how a trade creates the hole it then fills. And only as many incoming players as there
 * are open slots get the premium, best first: two receivers arriving for one empty WR slot do not
 * both fill it, and pricing both up is how a 2-for-1 gets graded as a steal.
 *
 * ⚠ OUTGOING IS PRICED AGAINST THE ROSTER AFTER THE WHOLE TRADE. Sending a starter the deal does
 * not replace leaves a slot empty, which costs more than his market price; sending surplus depth
 * costs slightly less. A like-for-like swap at one position is premium on both sides and nets out,
 * which is the point: need should not tilt a trade that does not change the need.
 */
export function allocateNeedFactors(args: {
  give: NeedLine[]
  get: NeedLine[]
  /** Need on the roster with the outgoing side removed. */
  needAfterOutgoing: RosterNeed
  /** Need on the roster after the whole deal. */
  needAfterTrade: RosterNeed
  scarcity: ScarcityBoard
  learned?: LearnedNeedInputs | null
  /**
   * The same roster as `needAfterOutgoing` with every ruled-out player counted as available — its DEPTH. A position
   * with an open slot now and none on depth is short only this week (a starter is out), and the learned premium for
   * that is the one measured for "short this week" (2026-11-22). Absent: every open slot reads as plain "short".
   */
  depthAfterOutgoing?: RosterNeed | null
}): { give: Array<LeagueValueAdjustment | null>; get: Array<LeagueValueAdjustment | null> } {
  const give: Array<LeagueValueAdjustment | null> = args.give.map(() => null)
  const get: Array<LeagueValueAdjustment | null> = args.get.map(() => null)

  const allocate = (
    lines: NeedLine[],
    out: Array<LeagueValueAdjustment | null>,
    need: RosterNeed,
    phrase: (basis: string) => string,
    depth: RosterNeed | null = null,
  ) => {
    const byPos = new Map<string, number[]>()
    lines.forEach((l, i) => {
      const pos = l.position?.toUpperCase().trim()
      if (!pos || isRuledOut(l.injuryStatus ?? null)) return
      byPos.set(pos, [...(byPos.get(pos) ?? []), i])
    })
    for (const [pos, idxs] of byPos) {
      const delta = counterpartyPriceDelta({
        position: pos,
        need,
        scarcity: args.scarcity.get(pos) ?? null,
        subject: 'you',
      })
      if (!delta || delta.factor === 1) continue
      const row = need.byPosition.find((p) => p.position === pos)
      // A premium covers at most the open slots, best asset first; a surplus discount covers every one.
      const ordered = [...idxs].sort((a, b) => (lines[b]!.base ?? -1) - (lines[a]!.base ?? -1))
      const covered = delta.factor > 1 ? ordered.slice(0, Math.max(0, row?.deficit ?? 0)) : ordered
      /*
       * TRADE_LEARNED_NEED=on: a premium (an open slot) is the one MEASURED for teams short at this position, where the
       * daily run published one — in place of the hand-set 6% per open slot. A discount (surplus) is left as it is.
       */
      // Short only this week: the hole is a ruled-out starter, not missing depth.
      const thisWeek = depth != null && (depth.byPosition.find((p) => p.position === pos)?.deficit ?? 0) <= 0
      const level = thisWeek ? 'short_this_week' : 'short'
      const board = args.learned?.board ?? null
      const measured = !(delta.factor > 1) || !args.learned?.need ? null : board ? learnedBoardNeedPremium(board, pos) : learnedNeedPremium(args.learned.tables, args.learned.book, pos, level)
      const factor = measured ? 1 + measured.pct / 100 : delta.factor
      const reason = !measured
        ? phrase(delta.basis)
        : board
          ? `${phrase(delta.basis)}; teams with no spare at ${pos} paid +${measured.pct}% over teams with depth there across ${measured.trades} completed ${board.sport} trades`
          : `${phrase(delta.basis)}; teams short at ${pos}${thisWeek ? ' this week (a starter ruled out)' : ''} paid ${measured.pct > 0 ? '+' : ''}${measured.pct}% over normal-depth teams across ${measured.trades} completed trades`
      for (const i of covered) out[i] = { kind: 'need', factor, reason }
    }
  }

  allocate(args.get, get, args.needAfterOutgoing, (b) => b, args.depthAfterOutgoing ?? null)
  allocate(args.give, give, args.needAfterTrade, (b) => `after this trade ${b}`)

  /*
   * TRADE_LEARNED_POSTURE=on, with your record: what you TAKE ON is moved by what teams with that record pay for that
   * kind of asset over middle teams. Only incoming lines — you are the buyer of those. Combined with any need move on the
   * same line, both reasons kept.
   */
  const L = args.learned
  if (L?.posture) {
    args.get.forEach((l, i) => {
      const age = l.sleeperId ? L.ages?.get(l.sleeperId) ?? null : null
      const kind = l.isPick ? 'picks' : age == null ? null : age >= VETERAN_MIN_AGE ? 'veteran' : age <= YOUTH_MAX_AGE ? 'youth' : null
      // A board sport has one posture number per record, for every player taken on (never a pick: it measured players).
      const move = L.board ? (l.isPick ? null : learnedBoardPostureAdjustment(L.board, L.posture)) : learnedPostureAdjustment(L.tables, L.book, L.posture, kind)
      if (!move) return
      const prior = get[i]
      get[i] = prior ? { kind: 'need', factor: prior.factor * move.factor, reason: `${prior.reason}; ${move.reason}` } : move
    })
  }
  return { give, get }
}

/**
 * Load the viewer's roster and this league's waiver wire, and price the deal's need factors.
 *
 * Never throws; every missing input comes back as a named `gap` with no factors, because a need
 * adjustment made on a roster we could not read would be a guess wearing a percentage.
 */
export async function loadViewerNeedFactors(args: {
  leagueId: string
  userId: string
  sport: string
  starters: unknown
  give: NeedLine[]
  get: NeedLine[]
  /** The chart's market book key, for the learned tables (`TRADE_LEARNED_NEED` / `TRADE_LEARNED_POSTURE`). */
  book?: string | null
}): Promise<NeedFactors> {
  const { give, get } = args
  try {
    const requirements: SlotRequirements | null = readSlotRequirements(args.starters)
    if (!requirements) return none(give, get, "this league's starting lineup, so roster need is not priced")

    const viewer = await resolveViewerLeagueRoster(args.leagueId, args.userId)
    if (!viewer.ok) return none(give, get, viewer.gap)
    const learned = await learnedInputsFor({ book: args.book ?? null, leagueId: args.leagueId, teamExternalId: viewer.team.externalId ?? null, get, sport: args.sport }).catch(() => null)
    return await rosterNeedFactors({ ...args, requirements, playerData: viewer.roster.playerData, learned })
  } catch {
    return none(give, get, 'your roster in this league — it could not be read just now')
  }
}

/**
 * The same need model for a roster named directly rather than through a user's claimed team — for a
 * caller that grades from the OTHER side of a deal (the nightly trade agent asks whether the partner's
 * roster gains too), where the partner is often not an AllFantasy user and has no claim to look up.
 */
export async function loadRosterNeedFactors(args: {
  leagueId: string
  playerData: unknown
  sport: string
  starters: unknown
  give: NeedLine[]
  get: NeedLine[]
  book?: string | null
}): Promise<NeedFactors> {
  const { give, get } = args
  try {
    const requirements: SlotRequirements | null = readSlotRequirements(args.starters)
    if (!requirements) return none(give, get, "this league's starting lineup, so roster need is not priced")
    // A roster named directly has no claimed team, so no record: the learned need premium only, never posture.
    const learned = await learnedInputsFor({ book: args.book ?? null, leagueId: args.leagueId, teamExternalId: null, get, sport: args.sport }).catch(() => null)
    return await rosterNeedFactors({ ...args, requirements, learned })
  } catch {
    return none(give, get, 'this roster — it could not be read just now')
  }
}

async function rosterNeedFactors(args: {
  leagueId: string
  playerData: unknown
  sport: string
  requirements: SlotRequirements
  give: NeedLine[]
  get: NeedLine[]
  learned?: LearnedNeedInputs | null
}): Promise<NeedFactors> {
  const { give, get, requirements } = args
  {
    /*
     * A foreign league's roster ids (Fleaflicker, MFL, ...) collide with real Sleeper ids, so the read
     * below would price a stranger's roster — the viewer's or, via loadRosterNeedFactors, a partner's.
     * Named as a gap: the roster is not empty, it is unreadable.
     */
    // Read off the league itself: a native NHL roster's Rolling Insights ids are NFL strangers by `sleeperId`.
    const league = await prisma.league.findUnique({ where: { id: args.leagueId }, select: { platform: true, sport: true } })
    if (isForeignIdSpace(league?.platform, league?.sport ?? args.sport)) {
      return none(give, get, "this league's rosters, whose player ids are the platform's own and cannot be matched to ours yet")
    }

    const pd = (args.playerData ?? {}) as Record<string, unknown>
    const rosterIds = Array.isArray(pd.players) ? pd.players.map(String).filter((x) => x && x !== '0') : []
    if (rosterIds.length === 0) return none(give, get, 'your roster in this league, which has no players on file')

    const rows = await prisma.sportsPlayer.findMany({
      where: { sleeperId: { in: rosterIds } },
      select: { sleeperId: true, position: true, name: true, team: true },
    })
    /*
     * 🛑 ONE PLAYER PER ROSTER ID, NOT ONE PER ROW. `SportsPlayer` carries several rows for many
     * players — measured on production 2026-09-24: 1,420 of 11,960 NFL Sleeper ids have 2–3 rows —
     * so counting rows made a 28-man roster read as 68 bodies, every position deep, and the verdict
     * told a manager he "carries 12 more" tight ends. Found by rendering it, not by a test.
     * `buildTradeContextNotes` keys the same rows through a Map, which is why its notes never showed
     * it. Positions are normalised too: some rows spell them "TightEnd".
     */
    const byId = new Map<string, { sleeperId: string; position: string; name: string; team: string | null }>()
    for (const r of rows) {
      if (!r.sleeperId || byId.has(r.sleeperId)) continue
      byId.set(r.sleeperId, { sleeperId: r.sleeperId, position: normalizePosition(r.position), name: r.name, team: r.team ?? null })
    }
    const players = rosterIds.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))
    const injuries = await prisma.sportsInjury
      .findMany({
        where: { sport: args.sport, playerName: { in: players.map((p) => p.name) }, expiresAt: { gt: new Date() } },
        orderBy: { fetchedAt: 'desc' },
        select: { playerName: true, status: true, team: true, position: true, date: true, fetchedAt: true },
      })
      .catch(() => [] as Array<{ playerName: string; status: string | null; team: string | null; position: string | null; date: Date | null; fetchedAt: Date }>)
    // Bound per athlete (name + team/position), not first row per NAME — see matchInjuryRows.ts.
    const statusOf = injuryStatusLookup(injuries, args.sport)

    // Outgoing matched by name against the roster — the only handle the console has, and an
    // unmatched give simply stays on the roster, which errs toward reporting LESS need.
    const byName = new Map(players.map((p) => [p.name.toLowerCase(), p]))
    const outgoing = new Set(
      give.map((g) => byName.get(g.name.toLowerCase())?.sleeperId).filter((x): x is string => Boolean(x)),
    )
    const slotOf = (p: { position: string | null; name: string; team?: string | null }): RosteredSlot => ({
      position: p.position ?? '',
      unavailable: isRuledOut(statusOf({ name: p.name, team: p.team ?? null, position: p.position })),
    })
    const remaining = players.filter((p) => p.sleeperId && !outgoing.has(p.sleeperId)).map(slotOf)
    const incoming: RosteredSlot[] = get
      .filter((g) => g.position)
      .map((g) => ({ position: g.position!, unavailable: isRuledOut(g.injuryStatus ?? null) }))

    const needAfterOutgoing = computeRosterNeed({ requirements, rostered: remaining })
    // The same roster's depth — everyone counted as available — so a hole that is only a ruled-out starter reads as
    // "short this week" for the learned need premium.
    const depthAfterOutgoing = computeRosterNeed({ requirements, rostered: remaining.map((s) => ({ ...s, unavailable: false })) })
    const needAfterTrade = computeRosterNeed({ requirements, rostered: [...remaining, ...incoming] })

    const positions = [...new Set([...give, ...get].map((l) => l.position?.toUpperCase().trim()).filter(Boolean))] as string[]
    const scarcity = await getPositionScarcity({
      leagueId: args.leagueId,
      sport: args.sport,
      projectionWeek: await latestProjectionWeek().catch(() => null),
      positions,
    }).catch(() => new Map() as ScarcityBoard)

    return { ...allocateNeedFactors({ give, get, needAfterOutgoing, needAfterTrade, scarcity, learned: args.learned ?? null, depthAfterOutgoing }), gap: null }
  }
}
