import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { listProposablePicks } from '@/lib/league-trade-engine/tradeValidationService'
import { resolveSleeperRosterPlayers } from '@/lib/player-identity/resolveSleeperRosterPlayers'
import { resolveProviderRosterPlayers } from '@/lib/player-identity/resolveProviderRosterPlayers'
import { byeForTeam, resolveTeamByeWeeks } from '@/lib/schedule/teamByeWeeks'
import { FIRST_ROUND_IN_MARKET_UNITS, pickValueByOverall } from '@/lib/pick-curve'
import { getPlayerValuesForNamesDbFirst } from '@/lib/fantasycalc-db'
import { resolvePlayerStock, type StockDirection } from '@/lib/trade-intel/playerStock'
import { rankTradePartners, type PartnerRanking } from '@/lib/trade-intel/partnerRanking'
import { loadLeagueTradeHistory } from '@/lib/trade-intel/partnerHistory'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { resolveCoreDepth } from '@/lib/core-app/corePaywall'
import {
  pickUnpricedReason,
  playerUnpricedReason,
  type UnpricedReason,
} from '@/lib/trade-value/unpricedReason'
import { loadImportedFuturePicks, type RosterFuturePick } from '@/lib/league-trade-engine/importedFuturePicks'
import { inventoryPickId, roundOrdinal, type InventoryPick } from '@/lib/league-trade-engine/futurePickInventory'
import { isNativeFuturePickLeague, loadNativeFuturePicks } from '@/lib/league-trade-engine/nativeFuturePicks'
import { valueBookFor, describeValueBook } from '@/lib/core-app/valueBook'
import { latestProjectionWeek, lookupProjections } from '@/lib/core-app/playerProjections'
import { computeLeagueProjectedPoints } from '@/lib/projections/leagueScoring'
import {
  generateMultiTeamTradeSuggestions,
  generateTradePartnerSuggestions,
  type ProposalLeagueMode,
  type ProposalManagerStrategy,
} from '@/lib/league-trade-engine/proposalSuggestions'
import { derivePartnerBehaviorProfiles } from '@/lib/league-trade-engine/proposalLearning'
import { enrichMultiTeamProposalSimulations, enrichProposalSimulations, hasPairedProposalSimulation } from '@/lib/league-trade-engine/proposalSimulation'
import { getTradeManagerStrategy } from '@/lib/league-trade-engine/managerStrategy'
import { signProposalEvidenceToken, type VerifiedProposalAssetEvidence } from '@/lib/league-trade-engine/proposalEvidenceToken'
import type { TradeAssetInput } from '@/lib/league-trade-engine/types'
import type { SuggestedTradeAsset } from '@/lib/league-trade-engine/proposalSuggestions'

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
  /** Current provider weekly projection used only for before/after simulation. */
  weeklyProjection: number | null
  /**
   * Why `value` is null, in words the builder prints beside "Unpriced"; null when priced.
   *
   * Optional for the same rollout reason as `stock`: a browser on the previous deploy's bundle
   * reads a response without the key.
   */
  unpricedReason?: UnpricedReason | null
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
  /** Why `value` is null; null when priced. Optional on the wire, as on a player. */
  unpricedReason?: UnpricedReason | null
  /**
   * False for a pick read from `future_draft_picks` (an imported league): it is shown and valued,
   * but `pickId` is a display id, not one a proposal can reference. Absent means proposable — the
   * `playerData` picks this route has always returned.
   */
  proposable?: boolean
  /** The team the pick originally belonged to, when that is not this roster. */
  fromTeam?: string | null
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
  /** Latest stored season simulation, expressed as 0–100; null when unavailable or inapplicable. */
  playoffProbability: number | null
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
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string; email?: string | null }
  } | null
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
    // `starters` is the league's own lineup, read by the partner ranking below.
    // `isDynasty` and `settings` (the provider's status) size and date the imported pick inventory.
    .findUnique({
      where: { id: leagueId },
      select: {
        season: true,
        sport: true,
        platform: true,
        starters: true,
        isDynasty: true,
        leagueSize: true,
        settings: true,
        leagueType: true,
        leagueVariant: true,
        bestBallMode: true,
        guillotineMode: true,
        waiverBudget: true,
        playoffTeams: true,
        playoffStartWeek: true,
      },
    })
    .catch(() => null)
  const currentSeason = Number(league?.season) || null
  const valueBook = valueBookFor(
    league?.settings,
    league?.leagueType ?? (league?.isDynasty ? 'dynasty' : null),
  )
  // Reduced Prisma doubles used by isolated route tests may not expose this new
  // delegate yet. That means "not confirmed", never a request failure.
  const strategyStore = (prisma as typeof prisma & {
    tradeManagerStrategy?: typeof prisma.tradeManagerStrategy
  }).tradeManagerStrategy
  const savedStrategy = strategyStore
    ? await getTradeManagerStrategy(leagueId, userId, { tradeManagerStrategy: strategyStore }).catch(() => null)
    : null
  const managerStrategy: ProposalManagerStrategy = savedStrategy?.active ?? 'balanced'
  const proposalMode: ProposalLeagueMode = (() => {
    const type = `${league?.leagueType ?? ''} ${league?.leagueVariant ?? ''}`.toLowerCase()
    if (league?.guillotineMode || type.includes('guillotine')) return 'guillotine'
    if (type.includes('survivor')) return 'survivor'
    if (league?.bestBallMode || type.includes('best ball') || type.includes('best_ball')) return 'best_ball'
    if (type.includes('dynasty')) return 'dynasty'
    if (type.includes('keeper')) return 'keeper'
    if (type.includes('redraft') || !type.trim()) return 'redraft'
    return 'specialty'
  })()
  const settingsBag = (league?.settings && typeof league.settings === 'object' && !Array.isArray(league.settings))
    ? league.settings as Record<string, unknown>
    : {}
  const nestedSettings = settingsBag.settings && typeof settingsBag.settings === 'object' && !Array.isArray(settingsBag.settings)
    ? settingsBag.settings as Record<string, unknown>
    : settingsBag
  const rosterPositions = (Array.isArray(settingsBag.roster_positions)
    ? settingsBag.roster_positions
    : Array.isArray(nestedSettings.roster_positions)
      ? nestedSettings.roster_positions
      : []).map(String)
  const scoring = settingsBag.scoring_settings && typeof settingsBag.scoring_settings === 'object'
    ? settingsBag.scoring_settings as Record<string, unknown>
    : {}
  const rawPpr = Number(scoring.rec ?? nestedSettings.rec ?? 1)
  const ppr: 0 | 0.5 | 1 = rawPpr >= 0.75 ? 1 : rawPpr >= 0.25 ? 0.5 : 0

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
          // The roster↔team join the imported pick inventory needs.
          id: true, claimedByUserId: true,
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
   * 🛑 AN IMPORTED LEAGUE'S PICKS WERE NEVER LISTED. They live in `future_draft_picks`, not in
   * `Roster.playerData`, and on staging 2026-09-17 no league yielded a single pick from the JSON.
   * The loader reads them only for the providers whose pick trades are synced (Sleeper, MFL) — so
   * never for a native league, whose picks come from `loadNativeFuturePicks` below.
   */
  const settingsStatus = (() => {
    const s = league?.settings
    const v = s && typeof s === 'object' && !Array.isArray(s) ? (s as Record<string, unknown>).status : null
    return typeof v === 'string' ? v : null
  })()
  const importedPicks = await loadImportedFuturePicks({
    leagueId,
    platform: league?.platform,
    isDynasty: Boolean(league?.isDynasty),
    leagueSeason: currentSeason,
    status: settingsStatus,
    teams: teams.map((t) => ({
      id: t.id,
      externalId: String(t.externalId ?? ''),
      platformUserId: t.platformUserId ?? null,
      claimedByUserId: t.claimedByUserId ?? null,
      teamName: t.teamName ?? null,
    })),
    rosters,
  }).catch(() => ({ picksByRosterId: new Map<string, RosterFuturePick[]>(), coverage: 'none' as const }))

  /*
   * 🛑 A NATIVE DYNASTY LEAGUE HAD NO PICK TO OFFER. Its `playerData.draftPicks` holds the players
   * each team drafted, not pick objects, so `listProposablePicks` found nothing and a native team
   * could never trade a future pick. These are every team's own picks in the next three rookie
   * drafts, moved where a trade moved them — and unlike an import's, they ARE proposable: the trade
   * engine settles them (`transferNativeFuturePick`) and the next rookie draft honours them.
   */
  const nativePicks = isNativeFuturePickLeague({
    platform: league?.platform,
    leagueType: league?.leagueType,
    isDynasty: league?.isDynasty,
  })
    ? await loadNativeFuturePicks(leagueId).catch(() => null)
    : null
  const nativePicksByRoster = new Map<string, InventoryPick[]>()
  for (const p of nativePicks?.picks ?? []) {
    const list = nativePicksByRoster.get(p.ownerTeamId) ?? []
    list.push(p)
    nativePicksByRoster.set(p.ownerTeamId, list)
  }
  const teamNameByRosterId = new Map(
    rosters.map((r) => [r.id, teamNameByPlatformId.get(String(r.platformUserId)) ?? null]),
  )

  /*
   * ⚠ THE UNITS MATCH THE PLAYERS BESIDE IT, WHICH IS THE ONLY REASON THE TOTAL MEANS ANYTHING.
   * Player values on this route come from `getPlayerValuesForNamesDbFirst`, i.e. FantasyCalc
   * dynasty units, and `FIRST_ROUND_IN_MARKET_UNITS` is the first-round anchor SOLVED in those same
   * units across 771 real trades. Anchoring to any other number would put picks and players on two
   * scales inside one sum.
   *
   * ⚠ AND THE SLOT IS DELIBERATELY OMITTED. A future pick has no draft position yet, so
   * `pickValueByOverall` defaults it to the middle of the round rather than assuming a favourable
   * one. A 2027 1st prices as a MID first, not an early one — the honest read when the order is
   * unknown.
   */
  const pickValue = (round: number | null): number | null =>
    round != null && Number.isFinite(round)
      ? pickValueByOverall({ round, teams: rosters.length || null, firstRoundValue: FIRST_ROUND_IN_MARKET_UNITS })
      : null
  const itemTypeFor = (season: number | null) =>
    currentSeason != null && season != null && season > currentSeason
      ? ('future_pick' as const)
      : ('rookie_pick' as const)

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
  const platform = String(league?.platform ?? 'sleeper').trim().toLowerCase()
  const resolvedForLeague = platform === 'sleeper'
    ? await resolveSleeperRosterPlayers(allRosterPlayerIds, String(league?.sport ?? 'NFL'))
    : await resolveProviderRosterPlayers(platform, allRosterPlayerIds, String(league?.sport ?? 'NFL'))

  const result: TradeableRoster[] = await Promise.all(
    rosters.map(async (r) => {
      const playerIds = getRosterPlayerIds(r.playerData)
      let players: TradeableRosterPlayer[] = playerIds.map((id) => ({
        id, name: id, position: null, team: null, imageUrl: null, byeWeek: null,
        injuryStatus: null, value: null, weeklyProjection: null, unpricedReason: null,
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
          weeklyProjection: null,
        stock: null,
        stockDelta: null,
          // Filled in one batch below — see the value pass.
          value: null,
          unpricedReason: null,
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
        playoffProbability: null,
        faabRemaining: r.faabRemaining ?? null,
        players,
        picks: [
          ...listProposablePicks(r.playerData).map((p): TradeableRosterPick => ({
            ...p,
            itemType: itemTypeFor(p.season),
            // The one way a pick goes unpriced here; see `pickValue` above.
            unpricedReason: p.round != null && Number.isFinite(p.round) ? null : pickUnpricedReason(),
            /*
             * 🛑 A PICK USED TO CARRY NO VALUE AT ALL, so the builder showed an em dash and reported
             * "1 unpriced" on a side whose total then understated it by a first-round pick. The
             * curve to price it has existed in `lib/pick-curve.ts` the whole time — it was simply
             * never called from here.
             */
            value: pickValue(p.round),
          })),
          ...(importedPicks.picksByRosterId.get(r.id) ?? []).map(
            (p: RosterFuturePick): TradeableRosterPick => ({
              pickId: inventoryPickId(p),
              season: p.season,
              round: p.round,
              label: `${p.season} ${roundOrdinal(p.round)}${p.fromTeamName ? ` (${p.fromTeamName})` : ''}`,
              itemType: itemTypeFor(p.season),
              value: pickValue(p.round),
              unpricedReason: null,
              proposable: false,
              fromTeam: p.fromTeamName,
            }),
          ),
          ...(nativePicksByRoster.get(r.id) ?? []).map((p): TradeableRosterPick => {
            const fromTeam =
              p.originalTeamId === r.id ? null : teamNameByRosterId.get(p.originalTeamId) ?? 'another team'
            return {
              pickId: inventoryPickId(p),
              season: p.season,
              round: p.round,
              label: `${p.season} ${roundOrdinal(p.round)}${fromTeam ? ` (${fromTeam})` : ''}`,
              itemType: itemTypeFor(p.season),
              value: pickValue(p.round),
              unpricedReason: null,
              proposable: true,
              fromTeam,
            }
          }),
        ],
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
   * ⚠ THE FORMAT MATCHES THE VALUE PASS BELOW ON PURPOSE. Both reads use the league-specific
   * value book so a player cannot carry two different numbers on one screen; an arrow drawn from
   * a different format series would contradict the number it sits beside, which is worse than no arrow.
   */
  const stockIds = result.flatMap((r) => r.players.map((p) => p.id)).filter(Boolean)
  const allNames = result.flatMap((r) => r.players.map((p) => p.name)).filter(Boolean)

  /*
   * ⚠ THESE TWO LOOKUPS ARE INDEPENDENT AND WERE PAID FOR IN SERIES. The stock read keys on
   * `sleeperId` and the value read keys on NAME; neither consumes the other's output, so the
   * request was simply waiting twice. Both still degrade to an empty map on their own, which is
   * what keeps a missing snapshot table from costing the rosters.
   */
  const projectionWeek = await latestProjectionWeek().catch(() => null)
  const positionBySleeperId = new Map(result.flatMap((roster) => roster.players.map((player) => [player.id, player.position] as const)))
  const [stock, projections, values] = await Promise.all([
    stockIds.length > 0
      ? resolvePlayerStock(stockIds, { format: valueBook.format, qbFormat: valueBook.qbFormat }).catch(
          () => new Map(),
        )
      : Promise.resolve(new Map()),
    stockIds.length > 0
      ? lookupProjections(stockIds, projectionWeek, { scoringSettings: scoring, positionBySleeperId }, String(league?.sport ?? 'NFL')).catch(() => new Map())
      : Promise.resolve(new Map()),
    allNames.length > 0
      ? getPlayerValuesForNamesDbFirst(allNames, {
          isDynasty: valueBook.format === 'DYNASTY',
          numQbs: valueBook.qbFormat === 'SUPERFLEX' ? 2 : 1,
          numTeams: Number(league?.leagueSize) || rosters.length || 12,
          ppr,
        }).catch(() => new Map())
      : Promise.resolve(new Map()),
  ])

  /*
   * ⚠ WHETHER THE FEED LOADED IS INFERRED, BECAUSE THE LOOKUP HIDES IT. Both of its failure paths
   * return an empty map, exactly as a read that matched nobody would. A whole league matching
   * nobody is the tell: measured on staging 2026-09-16, 10 of 223 leagues matched no one, and not
   * one of them rosters an identified NFL skill player — they hold only unidentified ids, team
   * defenses or college players, and those reasons are decided before this one is consulted.
   */
  const marketLoaded = values.size > 0
  const sport = String(league?.sport ?? 'NFL')

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
      const projection = projections.get(p.id)
      const leagueProjection = projection?.componentStats
        ? computeLeagueProjectedPoints(projection.componentStats, scoring)?.points ?? null
        : null
      p.weeklyProjection = leagueProjection ?? projection?.projectedPoints ?? null
      p.unpricedReason =
        p.value == null
          ? playerUnpricedReason({
              identified: resolvedForLeague.has(p.id),
              position: p.position,
              sport,
              marketLoaded,
            })
          : null
    }
  }

  if (proposalMode !== 'guillotine' && proposalMode !== 'survivor' && currentSeason) {
    // Some deployments and isolated route tests run with a reduced Prisma
    // surface. Missing simulation storage must reduce proposal confidence,
    // never take down the roster and partner picker.
    const simulationStore = (prisma as typeof prisma & {
      seasonSimulationResult?: typeof prisma.seasonSimulationResult
    }).seasonSimulationResult
    const latestSimulation = simulationStore
      ? await simulationStore.findFirst({
        where: { leagueId, season: currentSeason },
        orderBy: [{ weekOrPeriod: 'desc' }, { createdAt: 'desc' }],
        select: { weekOrPeriod: true, createdAt: true },
      })
        .catch(() => null)
      : null
    const simulationIsFresh = latestSimulation
      ? Date.now() - latestSimulation.createdAt.getTime() <= 10 * 24 * 60 * 60 * 1000
      : false
    const simulations = latestSimulation && simulationIsFresh && simulationStore
      ? await simulationStore.findMany({
            where: { leagueId, season: currentSeason, weekOrPeriod: latestSimulation.weekOrPeriod },
            select: { teamId: true, playoffProbability: true },
          })
          .catch(() => [])
      : []
    const probabilityByTeam = new Map(simulations.map((row) => {
      const raw = Number(row.playoffProbability)
      return [String(row.teamId), raw <= 1 ? raw * 100 : raw] as const
    }))
    for (const roster of result) {
      const probability = probabilityByTeam.get(String(roster.teamExternalId ?? ''))
        ?? probabilityByTeam.get(roster.rosterId)
      roster.playoffProbability = probability != null && Number.isFinite(probability) ? probability : null
    }
  }

  /*
   * ── WHO TO TRADE WITH (item #8) ────────────────────────────────────────────────────────────
   *
   * Ranked HERE because every input is already in hand — every roster, priced — except the
   * league's lineup (selected above) and its trade history (one light read). No provider is
   * called; the finder that did lives on /af-legacy and fetches Sleeper live.
   *
   * ⚠ FAILURE-CONTAINED. This route's job is the rosters. A ranking that throws costs the ranking
   * (`null`, which the screen reads as "not available") and never the builder.
   *
   * ⚠ ABSENT WITHOUT A VIEWER TEAM. Ranking "partners" for someone who is not in the league would
   * rank everyone, including the team being looked at.
   */
  let partnerRanking: PartnerRanking | null = null
  if (viewerTeamRosterId) {
    try {
      const teams = result.flatMap((r) =>
        r.teamExternalId ? [{ externalId: r.teamExternalId, rosterId: r.rosterId }] : [],
      )
      const history = await loadLeagueTradeHistory({
        leagueId,
        viewerRosterId: viewerTeamRosterId,
        isNative: resolveWriteAuthority(league?.platform) === 'NATIVE',
        teams,
      }).catch(() => null)
      partnerRanking = rankTradePartners({
        viewerRosterId: viewerTeamRosterId,
        rosters: result.map((r) => ({
          rosterId: r.rosterId,
          ownerName: r.ownerName,
          players: r.players.map((p) => ({ id: p.id, name: p.name, position: p.position, value: p.value })),
          picks: r.picks.map((p) => ({ pickId: p.pickId, label: p.label, value: p.value })),
        })),
        starterSlots: league?.starters ?? null,
        history,
      })
    } catch {
      partnerRanking = null
    }
  }

  const tradeStore = (prisma as typeof prisma & {
    afLeagueTrade?: typeof prisma.afLeagueTrade
  }).afLeagueTrade
  const historicalTrades = tradeStore
    ? await tradeStore.findMany({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
      take: 250,
      select: {
        proposerRosterId: true,
        receiverRosterId: true,
        status: true,
        metadata: true,
        items: { select: { itemType: true, fromRosterId: true, toRosterId: true } },
      },
      })
        .catch(() => [])
    : []
  const partnerBehavior = derivePartnerBehaviorProfiles(historicalTrades, result.map((roster) => roster.rosterId))
  const rawSuggestions = generateTradePartnerSuggestions({
    viewerRosterId: viewerTeamRosterId,
    rosters: result,
    rosterPositions,
    faabBudget: league?.waiverBudget ?? null,
    leagueMode: proposalMode,
    managerStrategy,
    partnerBehavior,
  })
  const simulatedSuggestions = enrichProposalSimulations({
    suggestions: rawSuggestions,
    rosters: result,
    viewerRosterId: viewerTeamRosterId,
    leagueMode: proposalMode,
    weeksRemaining: Math.max(1, Number(league?.playoffStartWeek ?? 14) - Number(projectionWeek?.week ?? 1)),
    playoffTeams: Math.max(2, Number(league?.playoffTeams ?? Math.min(6, rosters.length))),
  })
  const rawMultiTeamSuggestions = generateMultiTeamTradeSuggestions({
    viewerRosterId: viewerTeamRosterId,
    rosters: result,
    rosterPositions,
  })
  const simulatedMultiTeamSuggestions = enrichMultiTeamProposalSimulations({
    suggestions: rawMultiTeamSuggestions,
    rosters: result,
    viewerRosterId: viewerTeamRosterId,
    leagueMode: proposalMode,
    weeksRemaining: Math.max(1, Number(league?.playoffStartWeek ?? 14) - Number(projectionWeek?.week ?? 1)),
    playoffTeams: Math.max(2, Number(league?.playoffTeams ?? Math.min(6, rosters.length))),
  })
  const rosterById = new Map(result.map((roster) => [roster.rosterId, roster]))
  const toTradeAsset = (asset: SuggestedTradeAsset, fromRosterId: string, toRosterId: string): TradeAssetInput => ({
    itemType: asset.itemType,
    itemReference: asset.kind === 'faab' ? null : asset.id,
    fromRosterId,
    toRosterId,
    faabAmount: asset.kind === 'faab' ? asset.amount : null,
  })
  const toEvidence = (asset: SuggestedTradeAsset, fromRosterId: string, toRosterId: string): VerifiedProposalAssetEvidence => ({
    itemType: asset.itemType,
    itemReference: asset.kind === 'faab' ? null : asset.id,
    fromRosterId,
    toRosterId,
    faabAmount: asset.kind === 'faab' ? asset.amount : null,
    name: asset.name,
    value: asset.value,
    weeklyProjection: asset.kind === 'player'
      ? rosterById.get(fromRosterId)?.players.find((player) => player.id === asset.id)?.weeklyProjection ?? null
      : null,
  })
  const evidenceCapturedAt = new Date().toISOString()
  const suggestions = await Promise.all(simulatedSuggestions.map(async (suggestion) => ({
    ...suggestion,
    packages: await Promise.all(suggestion.packages.map(async (proposal) => {
      const tradeAssets = [
        ...proposal.send.map((asset) => toTradeAsset(asset, viewerTeamRosterId ?? '', suggestion.rosterId)),
        ...proposal.receive.map((asset) => toTradeAsset(asset, suggestion.rosterId, viewerTeamRosterId ?? '')),
      ]
      const evidenceAssets = [
        ...proposal.send.map((asset) => toEvidence(asset, viewerTeamRosterId ?? '', suggestion.rosterId)),
        ...proposal.receive.map((asset) => toEvidence(asset, suggestion.rosterId, viewerTeamRosterId ?? '')),
      ]
      const decisionEvidenceToken = viewerTeamRosterId && proposal.simulation?.available
        ? await signProposalEvidenceToken({
            leagueId,
            proposerRosterId: viewerTeamRosterId,
            tradeAssets,
            assets: evidenceAssets,
            managerStrategy,
            simulation: proposal.simulation,
            modelVersion: 'league-proposal-v3',
            valueSource: `FantasyCalc · ${describeValueBook(valueBook)}`,
            projectionSource: projectionWeek ? `league-scored projection feed · ${projectionWeek.season} week ${projectionWeek.week}` : 'projection feed unavailable',
            capturedAt: evidenceCapturedAt,
          })
        : null
      return { ...proposal, decisionEvidenceToken }
    })),
  })))
  const multiTeamSuggestions = await Promise.all(simulatedMultiTeamSuggestions.map(async (proposal) => {
    const tradeAssets = proposal.legs.map((leg) => toTradeAsset(leg.asset, leg.fromRosterId, leg.toRosterId))
    const evidenceAssets = proposal.legs.map((leg) => toEvidence(leg.asset, leg.fromRosterId, leg.toRosterId))
    const decisionEvidenceToken = viewerTeamRosterId && proposal.simulation?.available
      ? await signProposalEvidenceToken({
          leagueId,
          proposerRosterId: viewerTeamRosterId,
          tradeAssets,
          assets: evidenceAssets,
          managerStrategy,
          simulation: proposal.simulation,
          modelVersion: 'league-proposal-v3',
          valueSource: `FantasyCalc · ${describeValueBook(valueBook)}`,
          projectionSource: projectionWeek ? `league-scored projection feed · ${projectionWeek.season} week ${projectionWeek.week}` : 'projection feed unavailable',
          capturedAt: evidenceCapturedAt,
        })
      : null
    return { ...proposal, decisionEvidenceToken }
  }))
  const hasPairedOutcomeSimulation = hasPairedProposalSimulation({ suggestions, multiTeamSuggestions })
  const hasLeagueRosterContext = Boolean(league && (rosterPositions.length > 0 || (Array.isArray(league.starters) && league.starters.length > 0)))
  const hasPricedSuggestion = suggestions.some((suggestion) => suggestion.packages.some((proposal) => {
    const assets = [...proposal.send, ...proposal.receive]
    return assets.length > 0 && assets.every((asset) => asset.kind === 'faab' || (asset.value != null && asset.value > 0))
  }))
  const hasProjectedSuggestion = suggestions.some((suggestion) => suggestion.packages.some((proposal) => {
    const playerAssets = [...proposal.send, ...proposal.receive].filter((asset) => asset.kind === 'player')
    return playerAssets.every((asset) => rosterById.get(
      proposal.send.includes(asset) ? viewerTeamRosterId ?? '' : suggestion.rosterId,
    )?.players.find((player) => player.id === asset.id)?.weeklyProjection != null)
  }))
  const contextualGradeComplete = Boolean(
    savedStrategy && hasPairedOutcomeSimulation && hasLeagueRosterContext && hasPricedSuggestion && hasProjectedSuggestion,
  )

  /*
   * Trade depth (AF Pro, lib/core-app/coreDepthAccess.ts): who to trade with and the suggested
   * packages. The rosters are the builder and stay free. Withheld at the response, not skipped
   * upstream, because `tradeContext` below is derived from the suggestions and the propose
   * panel reads it — skipping them would change what that context says, not just what is sent.
   */
  const tradeDepth = await resolveCoreDepth(userId, 'trade_depth', { email: session?.user?.email ?? null })
  const depthOpen = tradeDepth.unlocked

  return NextResponse.json({
    rosters: result,
    viewerRosterId: viewerRosterId?.id ?? null,
    viewerTeamRosterId,
    partnerRanking: depthOpen ? partnerRanking : null,
    suggestions: depthOpen ? suggestions : [],
    multiTeamSuggestions: depthOpen ? multiTeamSuggestions : [],
    depth: tradeDepth,
    tradeContext: {
      valueBook: describeValueBook(valueBook),
      proposalModel: proposalMode.replace(/_/g, ' '),
      managerStrategy,
      strategyConfirmed: Boolean(savedStrategy),
      rosterPositions,
      faabBudget: league?.waiverBudget ?? null,
      contextualGradeComplete,
      missing: [
        ...(!hasLeagueRosterContext ? ['league roster settings'] : []),
        ...(!hasPricedSuggestion ? ['as-of asset values'] : []),
        ...(!hasProjectedSuggestion ? ['as-of player projections'] : []),
        ...(!hasPairedOutcomeSimulation ? ['paired before/after outcome simulation'] : []),
        ...(!savedStrategy ? ['manager strategy confirmation'] : []),
      ],
    },
    /*
     * How complete the imported pick lists are: `complete`, `traded_only` (the league's rookie-draft
     * size is unknown, so only picks that changed hands are listed) or `none`. The picker says so
     * rather than letting a short list read as a team with no picks.
     */
    pickCoverage: nativePicks ? 'complete' : importedPicks.coverage,
  })
}
