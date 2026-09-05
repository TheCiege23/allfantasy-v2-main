import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { listProposablePicks } from '@/lib/league-trade-engine/tradeValidationService'
import { resolveSleeperRosterPlayers } from '@/lib/player-identity/resolveSleeperRosterPlayers'
import { byeForTeam, resolveTeamByeWeeks } from '@/lib/schedule/teamByeWeeks'
import { FIRST_ROUND_IN_MARKET_UNITS, pickValueByOverall } from '@/lib/pick-curve'
import { getPlayerValuesForNamesDbFirst } from '@/lib/fantasycalc-db'
import { resolvePlayerStock, type StockDirection } from '@/lib/trade-intel/playerStock'

export const dynamic = 'force-dynamic'

/**
 * A player the picker can offer.
 *
 * 🛑 EVERY FIELD BELOW `position` WAS ALREADY BEING FETCHED AND THEN THROWN AWAY. This route calls
 * `getNormalizedPlayerData` and `serializeUnifiedPlayerForApi`, which return team, headshot, bye
 * week and injury status — and the mapping below kept only `{ id, name, position }`, so the picker
 * had nothing to render but a name and had to be a search box. Widening the type costs no extra
 * query; it stops discarding a payload the request already paid for.
 */
export type TradeableRosterPlayer = {
  id: string
  name: string
  position: string | null
  /** NFL team abbreviation, for the logo beside the name. */
  team: string | null
  /** Headshot. Null is normal — many players have none, and the UI must not gap. */
  imageUrl: string | null
  /**
   * Bye week, when known.
   *
   * ⚠ NULL IS NOT WEEK 0 AND NOT "NO BYE". It means we do not know, which a roster surface must
   * render as absent rather than as a week the manager could plan around.
   */
  byeWeek: number | null
  /** Designation when one is on file; absence is not a statement of health. */
  injuryStatus: string | null
  /**
   * Which way this player's market value has moved over thirty days.
   *
   * ⚠ NULL IS "WE HAVE NOT MEASURED HIM", NOT "HE HAS NOT MOVED". The two render differently: a
   * player with no reading shows nothing, a player who genuinely held station shows the flat mark.
   * Collapsing them would state a fact about a kicker nobody tracks.
   *
   * ⚠ OPTIONAL BECAUSE IT IS NEW ON THE WIRE, not because the route is lax about setting it. This
   * is an exported response type read by a browser that may still be talking to the previous
   * deploy, and an older server omits the KEY — `undefined`, not `null`. Declaring it required
   * would state that every response carries it, which is false for the length of a rollout.
   */
  stock?: StockDirection | null
  /** The 30-day delta itself, so the arrow can carry a number rather than only a colour. */
  stockDelta?: number | null
  /**
   * Market value on the 0-10000 FantasyCalc convention, or null when the player is not on the
   * board.
   *
   * ⚠ NULL IS "NOT PRICED", NEVER 0. A zero would read as a worthless player, and the picker must
   * show those differently — an unpriced asset is exactly what makes a trade verdict decline to
   * judge, so hiding the distinction here would hide the reason downstream.
   */
  value: number | null
}

/**
 * A pick the picker may offer, already carrying the item type the trade engine
 * expects.
 *
 * ⚠ THE ITEM TYPE IS DECIDED HERE, NOT ON THE CLIENT, because it turns on the
 * league's own season and the client does not have it. Both types are gated by
 * the same `draftPickTradingAllowed` setting today, so the distinction is a
 * label rather than a permission — but it is stored on the trade item and read
 * later, so it should be right rather than uniform.
 */
export type TradeableRosterPick = {
  pickId: string
  season: number | null
  round: number | null
  label: string
  itemType: 'rookie_pick' | 'future_pick'
  /**
   * ⚠ NULL IS "NOT PRICED", exactly as it is on a player — never 0. A pick with no round cannot be
   * placed on the curve, and the builder renders that as an em dash and counts it toward
   * "N unpriced" rather than quietly adding nothing to a total.
   */
  value: number | null
}
export type TradeableRoster = {
  rosterId: string
  platformUserId: string
  players: TradeableRosterPlayer[]
  /**
   * Picks with a stored id. A pick without one cannot be referenced by a
   * proposal at all — see `listProposablePicks`, which the engine's own
   * ownership check uses, so this list and that check cannot disagree.
   */
  picks: TradeableRosterPick[]
  /**
   * `LeagueTeam.externalId` for this roster's owner.
   *
   * This is the id the trade analyzer means by `opponentTeamExternalId`, and
   * without it the counterparty layer — their roster holes, the waiver wire
   * they would replace from, how they have historically paid for the position —
   * never runs. It is NOT `rosterId` and it is NOT `platformUserId`.
   */
  teamExternalId: string | null
  /** Team name where the league has one, else the AllFantasy account's name. */
  ownerName: string | null
  /** Manager avatar from `LeagueTeam`, so the picker can show whose roster it is. */
  avatarUrl: string | null
  /**
   * This manager's record in the league.
   *
   * ⚠ ZEROS ARE REAL AND MEAN 0-0-0, not "unknown" — `LeagueTeam` defaults them, and pre-season
   * every team genuinely is 0-0-0. A surface that hides a 0-0 record would hide the true state.
   */
  wins: number
  losses: number
  ties: number
  /**
   * FAAB left to spend, when the league tracks it. Null means this league has no FAAB budget on
   * file — which the picker must render as "not available" rather than as $0 to offer.
   */
  faabRemaining: number | null
  /**
   * True only when `platformUserId` is an AllFantasy account id.
   *
   * ⚠ THIS IS THE WHOLE REACH QUESTION FOR A NATIVE PROPOSAL. `platformUserId`
   * holds an AF user id on native leagues and the SLEEPER user id on imported
   * ones, so on an imported league nobody here is reachable — a proposal would
   * be written to a row the counterparty can never open. False means "do not
   * offer to send them anything", not "this roster is unimportant".
   */
  canReceiveProposal: boolean
}

/**
 * Every roster's tradeable player list, for the native trade-proposal UI. Gated by league
 * membership (not the narrower owner-only check on `/api/league/roster?userId=`) since roster
 * composition is not sensitive within a league — every member can already see opponents' lineups
 * on the Matchups tab.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true, playerData: true, faabRemaining: true },
  })

  /*
   * The league's own season decides rookie-vs-future on every pick below.
   *
   * ⚠ `sport` IS SELECTED TOO, AND IT IS LOAD-BEARING. `SportsPlayer.externalId` is unique only
   * WITHIN a sport, and a bare Sleeper id collides across them — one measured id resolved to an NFL
   * receiver, an NBA guard and an NCAAB player. The resolver is scoped by this value.
   */
  const league = await prisma.league
    .findUnique({ where: { id: leagueId }, select: { season: true, sport: true } })
    .catch(() => null)
  const currentSeason = Number(league?.season) || null

  /*
   * Who among these rosters is an actual AllFantasy account, and what to call
   * them. Two lookups rather than one because the two facts come from different
   * places: reachability is an AppUser row, the NAME is the league's own team
   * name where it has one.
   */
  const platformIds = [...new Set(rosters.map((r) => r.platformUserId).filter(Boolean))]
  const [accounts, teams] = await Promise.all([
    prisma.appUser
      .findMany({
        where: { id: { in: platformIds } },
        select: { id: true, displayName: true, username: true },
      })
      .catch(() => []),
    prisma.leagueTeam
      .findMany({
        where: { leagueId },
        select: {
          platformUserId: true, teamName: true, externalId: true,
          // Already one query; these ride along rather than costing another.
          avatarUrl: true, wins: true, losses: true, ties: true,
        },
      })
      .catch(() => []),
  ])
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const namedTeams = teams.filter(
    (t) => typeof t.platformUserId === 'string' && t.platformUserId.length > 0,
  )
  const teamNameByPlatformId = new Map(
    namedTeams.map((t) => [String(t.platformUserId), t.teamName]),
  )
  const externalIdByPlatformId = new Map(
    namedTeams.map((t) => [String(t.platformUserId), String(t.externalId)]),
  )
  /** Manager identity and record, keyed the same way the name and external id already are. */
  const teamMetaByPlatformId = new Map(
    namedTeams.map((t) => [
      String(t.platformUserId),
      { avatarUrl: t.avatarUrl ?? null, wins: t.wins ?? 0, losses: t.losses ?? 0, ties: t.ties ?? 0 },
    ]),
  )

  /*
   * One derivation for the whole request. The bye is a property of the TEAM, so 32 rows answer
   * it for every player on every roster; doing it per player would be the same query 241 times.
   */
  const byeByTeam = await resolveTeamByeWeeks(String(league?.sport ?? 'NFL'), league?.season)

  /*
   * 🛑 ONE RESOLVE FOR THE WHOLE LEAGUE, NOT ONE PER ROSTER. This call used to sit INSIDE the
   * per-roster map below, so a twelve-team league fired TWELVE concurrent `sportsPlayer`
   * findMany queries — each an IN-list of ~15 ids against a ~42,000-row table — to answer one
   * question. The resolver has always taken an array; nothing in it had to change.
   *
   * ⚠ DEDUPED ACROSS ROSTERS. The same id cannot appear on two rosters in a healthy league, but
   * a mid-trade snapshot can show one on both, and asking twice for the same player is the
   * habit this commit exists to remove.
   *
   * ⚠ THE MAP IS SHARED AND READ-ONLY. Every roster looks up its own ids and writes nothing
   * back, which is what makes one map safe for all of them.
   */
  const allRosterPlayerIds = [...new Set(rosters.flatMap((r) => getRosterPlayerIds(r.playerData)))]
  const resolvedForLeague = await resolveSleeperRosterPlayers(
    allRosterPlayerIds,
    String(league?.sport ?? 'NFL'),
  )

  const result: TradeableRoster[] = await Promise.all(
    rosters.map(async (r) => {
      const playerIds = getRosterPlayerIds(r.playerData)
      let players: TradeableRosterPlayer[] = playerIds.map((id) => ({
        id, name: id, position: null, team: null, imageUrl: null, byeWeek: null,
        injuryStatus: null, value: null,
      }))
      /*
       * 🛑 THE SAME RULE AS THE MATERIALIZER, AND NOW THE SAME IMPLEMENTATION. This block used to
       * call `getNormalizedPlayerData({ surface: 'roster', … })` and fall back to `name: id`. That
       * source returns ZERO rows — measured for every call shape — so every player on an imported
       * roster arrived here named by their Sleeper id, with no position, team or image.
       *
       * ⚠ AND REPAIRING THE DATABASE DID NOT FIX IT, WHICH IS HOW THE SECOND COPY WAS FOUND. The
       * 58,559-row repair corrected `RedraftRosterPlayer`, which is what the trade VERDICT reads;
       * this route reads `Roster.playerData` and resolved it separately, so the picker went on
       * showing "11619" while pricing worked. One rule written twice, fixed once.
       */
      const resolved = resolvedForLeague
      players = playerIds.map((id) => {
        const hit = resolved.get(id)
        return {
          id,
          // Absent stays absent: the picker renders "unknown" differently from a value, and an id
          // masquerading as a name is exactly the bug this replaced.
          name: hit?.name ?? id,
          position: hit?.position ?? null,
          team: hit?.team ?? null,
          imageUrl: hit?.imageUrl ?? null,
          /*
           * DERIVED FROM THE SCHEDULE, not read from a column — there is no bye-week column
           * anywhere that holds data. A team with an incomplete schedule yields null rather than a
           * guess, so blank still means "we do not know" and never "week 0".
           */
          byeWeek: byeForTeam(byeByTeam, hit?.team),
          injuryStatus: null,
        stock: null,
        stockDelta: null,
          // Filled in one batch below — see the value pass.
          value: null,
        }
      })
      const account = accountById.get(r.platformUserId)
      const meta = teamMetaByPlatformId.get(String(r.platformUserId))
      return {
        rosterId: r.id,
        platformUserId: r.platformUserId,
        avatarUrl: meta?.avatarUrl ?? null,
        wins: meta?.wins ?? 0,
        losses: meta?.losses ?? 0,
        ties: meta?.ties ?? 0,
        faabRemaining: r.faabRemaining ?? null,
        players,
        picks: listProposablePicks(r.playerData).map((p) => ({
          ...p,
          itemType:
            currentSeason != null && p.season != null && p.season > currentSeason
              ? ('future_pick' as const)
              : ('rookie_pick' as const),
          /*
           * 🛑 A PICK USED TO CARRY NO VALUE AT ALL, so the builder showed an em dash and reported
           * "1 unpriced" on a side whose total then understated it by a first-round pick. The curve
           * to price it has existed in `lib/pick-curve.ts` the whole time — it was simply never
           * called from here.
           *
           * ⚠ THE UNITS MATCH THE PLAYERS BESIDE IT, WHICH IS THE ONLY REASON THE TOTAL MEANS
           * ANYTHING. Player values on this route come from `getPlayerValuesForNamesDbFirst`, i.e.
           * FantasyCalc dynasty units, and `FIRST_ROUND_IN_MARKET_UNITS` is the first-round anchor
           * SOLVED in those same units across 771 real trades. Anchoring to any other number would
           * put picks and players on two scales inside one sum.
           *
           * ⚠ AND THE SLOT IS DELIBERATELY OMITTED. A future pick has no draft position yet, so
           * `pickValueByOverall` defaults it to the middle of the round rather than assuming a
           * favourable one. A 2027 1st prices as a MID first, not an early one — the honest read
           * when the order is unknown.
           */
          value:
            p.round != null && Number.isFinite(p.round)
              ? pickValueByOverall({
                  round: p.round,
                  teams: rosters.length || null,
                  firstRoundValue: FIRST_ROUND_IN_MARKET_UNITS,
                })
              : null,
        })),
        teamExternalId: externalIdByPlatformId.get(r.platformUserId) ?? null,
        ownerName:
          teamNameByPlatformId.get(r.platformUserId) ||
          account?.displayName ||
          account?.username ||
          null,
        canReceiveProposal: Boolean(account),
      }
    }),
  )

  /*
   * ⚠ TWO DIFFERENT QUESTIONS, AND ANSWERING BOTH WITH ONE FIELD IS A BUG.
   *
   * `viewerRosterId` — CAN I PROPOSE FROM THIS ROSTER. `createAfLeagueTrade`
   * throws unless `proposer.platformUserId` equals the proposing user id, so
   * this uses that exact equality and nothing looser. Anything looser lights up
   * a Propose button the write then refuses.
   *
   * `viewerTeamRosterId` — WHICH TEAM IS MINE ON SCREEN. On an imported league
   * `Roster.platformUserId` holds the SLEEPER user id, so the strict predicate
   * above is null for every imported league in the product. A UI that filtered
   * "everyone but me" by it filtered nothing, and offered the manager their own
   * team as a trade partner. This resolves identity the way the rest of the
   * league surfaces do — claimed LeagueTeam first, then the linked Sleeper id.
   *
   * They are deliberately separate fields. Collapsing them either breaks the
   * counterparty list on imports or breaks the propose gate on natives.
   */
  const viewerRosterId = rosters.find((r) => r.platformUserId === userId) ?? null

  const identityIds = await (async () => {
    const ids = new Set<string>([userId])
    const claimed = await prisma.leagueTeam
      .findFirst({
        where: { leagueId, claimedByUserId: userId },
        select: { platformUserId: true },
      })
      .catch(() => null)
    if (claimed?.platformUserId) ids.add(claimed.platformUserId)
    const profile = await prisma.userProfile
      .findUnique({ where: { userId }, select: { sleeperUserId: true } })
      .catch(() => null)
    if (profile?.sleeperUserId) ids.add(profile.sleeperUserId)
    return ids
  })()

  const viewerTeamRosterId =
    viewerRosterId?.id ?? rosters.find((r) => identityIds.has(r.platformUserId))?.id ?? null

  /*
   * ── MARKET VALUE, IN ONE BATCH FOR THE WHOLE LEAGUE ────────────────────────────────────────
   *
   * Resolved after the rosters are assembled rather than inside the per-roster loop: every roster
   * in a league draws from the same valuation snapshot, so a lookup per roster would read it twelve
   * to thirty-two times for one answer.
   *
   * ⚠ THE SETTINGS MATCH `/api/trade-value/player-search` EXACTLY, and that is not incidental. The
   * picker shows search results beside roster rows; if the two resolved value under different
   * settings the SAME player would carry two different numbers on one screen, and a manager would
   * have no way to tell which the engine used. `getPlayerValuesForNamesDbFirst` defaults to
   * `numQbs: 2`, so the settings are passed explicitly rather than defaulted.
   *
   * DB-first by construction — this is a request path, and `getFantasyCalcValuesDbFirst` reads
   * `sportsDataCache` rather than the vendor. It returns an empty map on failure, so an outage
   * costs values and nothing else.
   */
  /*
   * ── THIRTY-DAY STOCK, ONE QUERY FOR THE WHOLE LEAGUE ───────────────────────────────────────
   *
   * ⚠ THE FORMAT MATCHES THE VALUE PASS BELOW ON PURPOSE. Values here are pinned to dynasty
   * one-QB so a player cannot carry two different numbers on one screen; an arrow drawn from the
   * superflex series would contradict the number it sits beside, which is worse than no arrow.
   */
  const stockIds = result.flatMap((r) => r.players.map((p) => p.id)).filter(Boolean)
  const allNames = result.flatMap((r) => r.players.map((p) => p.name)).filter(Boolean)

  /*
   * ⚠ THESE TWO LOOKUPS ARE INDEPENDENT AND WERE PAID FOR IN SERIES. The stock read keys on
   * `sleeperId` and the value read keys on NAME; neither consumes the other's output, so the
   * request was simply waiting twice. Both still degrade to an empty map on their own, which is
   * what keeps a missing snapshot table from costing the rosters.
   */
  const [stock, values] = await Promise.all([
    stockIds.length > 0
      ? resolvePlayerStock(stockIds, { format: 'DYNASTY', qbFormat: 'ONE_QB' }).catch(
          () => new Map(),
        )
      : Promise.resolve(new Map()),
    allNames.length > 0
      ? getPlayerValuesForNamesDbFirst(allNames, {
          isDynasty: true,
          numQbs: 1,
          numTeams: 12,
          ppr: 1,
        }).catch(() => new Map())
      : Promise.resolve(new Map()),
  ])

  for (const r of result) {
    for (const p of r.players) {
      const s = stock.get(p.id)
      if (s) {
        p.stock = s.direction
        p.stockDelta = s.trend30d
      }
      // Keyed lowercase by `buildPlayerValuesForNames`. A miss stays null — "not priced",
      // which the picker renders differently from a low value.
      p.value = values.get(p.name.toLowerCase())?.value ?? null
    }
  }

  return NextResponse.json({
    rosters: result,
    viewerRosterId: viewerRosterId?.id ?? null,
    viewerTeamRosterId,
  })
}
