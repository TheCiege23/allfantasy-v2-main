import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { recordDashboardActivation } from '@/lib/analytics/recordDashboardActivation'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { deriveOutstandingIssues, lastSyncByLeagueFrom } from '@/lib/core-app/outstandingIssues'
import { mergeDash34Issues } from '@/lib/core-app/mergeDash34Issues'
import { buildHomeSignals, serializeHomeSignals } from '@/lib/core-app/homeSignals'
import { describeAge } from '@/lib/sports-data/freshnessPolicy'
import { resolveDashboardAvatarUrl } from '@/lib/dashboard/resolve-dashboard-avatar'
import { aiAccessResolver } from '@/lib/ai-access/AIAccessResolver'
import AfCoreShell, { type CoreNavKey, type RailLeague } from '@/components/core-app/AfCoreShell'
import type { UserLeague } from '@/app/dashboard/types'
import Dashboard3A from '@/components/core-app/screens/Dashboard3A'
import { Dash3ATriage, type TriageBookRow } from '@/components/core-app/screens/Dash3ATriage'
import { Dash34Carryover } from '@/components/core-app/screens/Dash34Carryover'
import { DashScheduleBand } from '@/components/core-app/screens/DashScheduleBand'
import { DashUserOs } from '@/components/core-app/screens/DashUserOs'
import { DashDraftsBand } from '@/components/core-app/screens/DashDraftsBand'
import { resolveUserOsSnapshot } from '@/lib/decision-os/userOs'
import { getCrossLeagueExposure, getRivalRecords } from '@/lib/core-app/dash3aPanels'
import { getDash34Data, imageOf, type Dash34LeagueRow } from '@/lib/core-app/dash34'
import LeagueHome from '@/components/core-app/screens/LeagueHome'
import { getLeagueHomeData } from '@/lib/core-app/leagueHome'
import PlayerFinder from '@/components/core-app/screens/PlayerFinder'
import { searchPlayers, getPlayerDetail } from '@/lib/core-app/playerFinder'
import MyTeam from '@/components/core-app/screens/MyTeam'
import { getMyTeamData } from '@/lib/core-app/myTeam'
import Matchup from '@/components/core-app/screens/Matchup'
import { getMatchupData } from '@/lib/core-app/matchup'
import Trades from '@/components/core-app/screens/Trades'
import { getTradesData } from '@/lib/core-app/trades'
import Waivers from '@/components/core-app/screens/Waivers'
import { getWaiversData } from '@/lib/core-app/waivers'
import DraftHq from '@/components/core-app/screens/DraftHq'
import { getDraftHqData } from '@/lib/core-app/draftHq'
import WarRoom from '@/components/core-app/screens/WarRoom'
import { getWarRoomData } from '@/lib/core-app/warRoom'
import LandingV4 from '@/components/core-app/screens/LandingV4'
import DashboardV2 from '@/components/core-app/screens/DashboardV2'
import Partners from '@/components/core-app/screens/Partners'
import { BusinessRetention } from '@/components/core-app/screens/BusinessRetention'
import { DiscordBridge } from '@/components/core-app/screens/DiscordBridge'
import { getDiscordBridge } from '@/lib/core-app/discordBridge'
import { BracketChallenge } from '@/components/core-app/screens/BracketChallenge'
import { getBracketChallenge } from '@/lib/core-app/bracketChallenge'
import { resolveSport } from '@/lib/brackets/sportShell'
import AuthV4 from '@/components/core-app/screens/AuthV4'
import ImportV4, { type ImportPreviewState } from '@/components/core-app/screens/ImportV4'
import { Portfolio } from '@/components/core-app/screens/Portfolio'
import { Tools } from '@/components/core-app/screens/Tools'
import { Career } from '@/components/core-app/screens/Career'
import { getCareerData } from '@/lib/core-app/career'
import { toShareCard } from '@/lib/core-app/shareCard'
import { Rankings } from '@/components/core-app/screens/Rankings'
import { RankingsFaq } from '@/components/core-app/screens/RankingsFaq'
import { RankingsCompare } from '@/components/core-app/screens/RankingsCompare'
import { getRankingsData, getCompareData, type CompareResult } from '@/lib/core-app/rankings'
import { getPortfolio } from '@/lib/core-app/portfolio'
import { getTodayStrip } from '@/lib/core-app/todayStrip'
import { getPlayFeed } from '@/lib/live/playFeedPresentation'
import { hasRegularSeasonStarted } from '@/lib/core-app/seasonPhase'
import { DashGameDayBand } from '@/components/core-app/screens/DashGameDayBand'
import { readPlayByPlayFeed } from '@/lib/live/playByPlayFeed'
import { getDraftHqAll } from '@/lib/core-app/draftHqAll'
import { getWeekAll, scoredMatchupLeagueIds } from '@/lib/core-app/weekAll'
import YourWeek from '@/components/core-app/screens/YourWeek'
import RivalryRadar from '@/components/core-app/screens/RivalryRadar'
import { getWeekBoard, getRivalryRadar } from '@/lib/core-app/weekBoard'
import SeasonOutlook from '@/components/core-app/screens/SeasonOutlook'
import { getSeasonOutlook } from '@/lib/core-app/seasonOutlook'
import NotificationsCenter from '@/components/core-app/screens/NotificationsCenter'
import { getNotificationsCenter } from '@/lib/core-app/notificationsCenter'
import CareerShare from '@/components/core-app/screens/CareerShare'
import { buildToolsHub } from '@/lib/core-app/toolsHub'
import { getTokenSpendRuleMatrixEntry } from '@/lib/tokens/pricing-matrix'

export const dynamic = 'force-dynamic'

/**
 * AF Core — every screen from the design handoff, behind ONE route.
 *
 * An optional catch-all rather than nine sibling routes on purpose: this repo
 * sits against Vercel's hard 2048-route ceiling (see
 * scripts/vercel-next-build.cjs), and nine page routes for one product surface
 * is exactly the kind of spend that pushed it there. `/core`, `/core/players`,
 * `/core/my-team` and the rest all resolve here and cost one route between them.
 *
 * Screens land incrementally. Anything not yet built renders an explicit
 * "not built yet" panel instead of a blank page or a redirect, so the nav is
 * honest about what exists.
 */

const SCREEN_KEYS: Record<string, CoreNavKey> = {
  '': 'home',
  players: 'players',
  'my-team': 'my-team',
  'landing-preview': 'landing-preview',
  matchup: 'matchup',
  trades: 'trades',
  waivers: 'waivers',
  'war-room': 'war-room',
  'draft-hq': 'draft-hq',
  portfolio: 'portfolio',
  career: 'career',
  rankings: 'rankings',
  commissioner: 'commissioner',
  tools: 'tools',
  /*
   * The five handoff screens added in this change. Segments on the same
   * catch-all as everything else — five sibling routes for five screens is
   * exactly the spend that pushed this repo against Vercel's 2048-route
   * ceiling, and the shell is identical on all of them.
   *
   * `week` carries Rivalry Radar behind ?view=rivalries rather than taking its
   * own key: same data layer, same header, same empty state.
   */
  week: 'week',
  'season-outlook': 'season-outlook',
  share: 'share',
  notifications: 'notifications',
  /*
   * 32a lands on the EXISTING commissioner nav key rather than taking one of its
   * own. It is a commissioner surface — configuring where a league's chat goes
   * is not a manager action — so the rail should highlight Commissioner while
   * you are on it, and the shell needs no new entry.
   */
  discord: 'commissioner',
  /*
   * 28a. ONE segment for every sport — the sport is a query parameter
   * (?sport=mlb), not a route. That is the "one shell, every sport" constraint
   * expressed in the routing layer too, and it keeps six sports at zero
   * additional routes against Vercel's 2048 ceiling.
   */
  bracket: 'tools',
}

function titleCase(slug: string): string {
  return slug
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

const PLATFORM_MARK: Record<string, string> = {
  sleeper: 'S',
  espn: 'E',
  yahoo: 'Y',
  cbs: 'C',
  mfl: 'M',
  fantrax: 'F',
}

export default async function AfCorePage({
  params,
  searchParams,
}: {
  params: Promise<{ screen?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { screen } = await params
  const sp = await searchParams
  const selectedLeagueId = typeof sp.league === 'string' ? sp.league : null
  const playerQuery = typeof sp.q === 'string' ? sp.q : ''
  const selectedPlayerId = typeof sp.player === 'string' ? sp.player : null
  const segment = (screen?.[0] ?? '').toLowerCase()
  const navKey = SCREEN_KEYS[segment]

  /*
   * The landing preview is served BEFORE the session gate and OUTSIDE AfCoreShell.
   *
   * Both matter and both were wrong first time round. A marketing page rendered
   * inside the signed-in chrome came out wrapped in the league rail, the app nav
   * and the topbar — it has its own nav and belongs to no league. And gating it
   * behind auth is backwards: a landing page exists for people who are NOT
   * signed in, so the redirect to /login made it unreachable by its only real
   * audience.
   */
  if (segment === 'landing-preview') {
    return <LandingV4 />
  }

  /*
   * AllFantasy for Business, at /core/partners.
   *
   * Served here rather than as its own /partners route because the repo sits at
   * Vercel's hard 2048-route ceiling — this catch-all is the whole point: every
   * handoff screen behind ONE route. Same placement rules as the landing above:
   * before the session gate and outside AfCoreShell, because it is a marketing
   * page for people who are NOT signed in and carries its own nav.
   */
  if (segment === 'partners') {
    return <Partners />
  }

  /*
   * 30b — the B2B retention case, at /core/business.
   *
   * Ungated and outside AfCoreShell for the same reason `partners` is: it is a
   * partner-facing page for people who are NOT signed in. It sits beside
   * `partners` rather than replacing it — `partners` is the offer ("here is
   * what we run over your data"), this is the argument for it ("here is why
   * offseason retention is the thing to buy"). Its demo CTA deep-links into the
   * one working demo form at /core/partners#demo rather than growing a second.
   */
  if (segment === 'business') {
    return <BusinessRetention />
  }

  // Auth previews are ungated for the same reason the landing is: sign-in and
  // sign-up exist for people who are NOT signed in.
  if (segment === 'signin-preview') {
    return <AuthV4 mode="signin" />
  }
  if (segment === 'signup-preview') {
    return <AuthV4 mode="signup" />
  }
  if (segment === 'import-preview') {
    // ?state= previews the connecting and result layouts. They are reachable
    // only deliberately, and the result panel says it carries no league data.
    const raw = typeof sp.state === 'string' ? sp.state : 'pick'
    const previewState: ImportPreviewState =
      raw === 'connecting' || raw === 'result' ? raw : 'pick'
    return <ImportV4 state={previewState} />
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/core${segment ? `/${segment}` : ''}`)}`)
  }

  /*
   * 'commissioner' was the one nav key still rendering the generic "not built
   * yet" panel — while the Commissioner Hub exists as a full page. Redirect
   * rather than apologise. Matched on `segment`, not `navKey`: /core/discord
   * shares the commissioner nav key and must keep rendering its own screen.
   */
  if (segment === 'commissioner') {
    redirect('/commissioner-hub')
  }

  // Unknown segment: fall back to home rather than 404ing a nav link.
  const activeKey: CoreNavKey = navKey ?? 'home'

  // getDashboardLeagueListForUser returns { leagues, sleeperUserId } — NOT an
  // array — and types its leagues as `unknown[]`, so nothing stops a caller from
  // mapping the payload itself. The dashboard page casts the same way.
  const leagueListPayload = await getDashboardLeagueListForUser(userId).catch(() => null)
  const leagues = (leagueListPayload?.leagues ?? []) as unknown as UserLeague[]

  /*
   * ⚠ THE RAIL IS LEAGUES YOU PLAY, NOT YOUR IMPORT HISTORY. `hasUnifiedRecord:
   * false` marks an AF Legacy board row — a past-season snapshot from the career
   * import with no row in `leagues`. One production account carries 543 of them
   * against 60 real teams, and letting them into this list is what produced a
   * 604-tile rail and a 604-row home. Same filter the home loader applies, for
   * the same reason.
   */
  const playedLeagues = leagues.filter((l) => (l as { hasUnifiedRecord?: boolean }).hasUnifiedRecord !== false)

  const rail: RailLeague[] = playedLeagues.map((l) => ({
    id: l.id,
    name: l.name,
    platform: String(l.platform ?? 'manual').toLowerCase(),
    mark: PLATFORM_MARK[String(l.platform ?? '').toLowerCase()] ?? l.name.charAt(0).toUpperCase(),
    /*
     * ⚠ THE LOADER ALREADY SELECTS avatarUrl AND logoUrl — this mapping used to
     * drop them, which is why every Sleeper chip rendered 'S' while the My
     * Leagues rows below showed real images from the SAME rows. imageOf is the
     * dash34 resolver those rows go through: logoUrl as-is, Sleeper avatar hash
     * → sleepercdn thumbs URL, anything unresolvable → null so the letter mark
     * is the genuine fallback rather than a broken <img>.
     */
    imageUrl: imageOf(l as unknown as Dash34LeagueRow),
  }))

  /*
   * ⚠ `playedLeagues`, AND THE REAL SYNC TIMESTAMPS.
   *
   * This passed `leagues` — all 606 rows on a production account, 543 of which
   * are AF Legacy board snapshots with no row in `leagues` and nothing to sync.
   * The rail two lines above already filters them out for exactly this reason.
   *
   * It also omitted `lastSyncByLeague`, which defaults every league to "never
   * read" and made the stale detector fire on all of them unconditionally.
   */
  const { issues: derivedIssues } = deriveOutstandingIssues({
    leagues: playedLeagues,
    lastSyncByLeague: lastSyncByLeagueFrom(
      playedLeagues as unknown as Array<{ id: string; lastSyncedAt?: Date | string | null }>,
    ),
  })

  // Screen 2 is the same route with a league selected — the handoff describes it
  // as the main column becoming "that league's world", not a separate page.
  const leagueHome =
    activeKey === 'home' && selectedLeagueId
      ? await getLeagueHomeData(selectedLeagueId, userId).catch(() => null)
      : null

  // Player Finder searches and selects entirely through query params — no client
  // fetch and no new API route, which matters because the repo is at the route
  // ceiling and a search box is not worth a route.
  /*
   * Portfolio is the league INVENTORY — the thing /core home deliberately is not.
   * Home answers "what needs me now" from a queue; this answers "what do I have".
   */
  const portfolio = activeKey === 'portfolio' ? await getPortfolio(userId).catch(() => null) : null

  // Career derives from imported history; ?platform= narrows it to one provider.
  const career =
    activeKey === 'career'
      ? await getCareerData(userId, typeof sp.platform === 'string' ? sp.platform : null).catch(
          () => null
        )
      : null

  /*
   * Rankings, its FAQ and the compare view share one screen key and one data
   * read. `?view=` picks the panel — three sibling routes for one product
   * surface is exactly the spend that pushed this repo against the route
   * ceiling, and the ladder is the same on all three.
   */
  const rankingsView = activeKey === 'rankings' ? (typeof sp.view === 'string' ? sp.view : null) : null
  const rankings =
    activeKey === 'rankings' ? await getRankingsData(userId).catch(() => null) : null

  // Only run the comparison when a handle was actually submitted — an empty box
  // is the initial state, not a failed lookup.
  const compareQuery =
    rankingsView === 'compare' && typeof sp.user === 'string' ? sp.user.trim() : ''
  const compare: CompareResult | null =
    rankingsView === 'compare' && compareQuery
      ? await getCompareData(userId, compareQuery).catch(() => null)
      : null

  /*
   * The share card (13b) is derived from the career read that is already in
   * hand — build rule 2 is that every number on it traces to a value 13a shows,
   * and re-reading would let the two drift within a single request.
   */
  const shareCard =
    activeKey === 'career' && sp.view === 'share' && career ? toShareCard(career) : null

  const playerMatches = activeKey === 'players' ? await searchPlayers(playerQuery).catch(() => []) : []
  /*
   * playedLeagues, NOT leagues — same reason as the rail and week loaders: the
   * unfiltered list carries AF Legacy board rows (hasUnifiedRecord: false), and
   * passing them here inflated "on N of your M leagues" to the 604 count and let
   * career-import snapshots into the every-platform table.
   */
  const playerDetail =
    activeKey === 'players' && selectedPlayerId
      ? await getPlayerDetail(
          selectedPlayerId,
          playedLeagues.map((l) => l.id),
          userId
        ).catch(() => null)
      : null

  /*
   * 28a. Not league-scoped — a bracket pool is its own thing, unrelated to the
   * leagues you play in.
   */
  const bracket =
    segment === 'bracket'
      ? await getBracketChallenge(resolveSport(typeof sp.sport === 'string' ? sp.sport : null)).catch(
          () => null,
        )
      : null

  /*
   * 32a. League-scoped and commissioner-only: getDiscordBridge returns null
   * unless this user owns the league, so a member who guesses the URL gets the
   * same "pick a league" panel as someone with none selected rather than a
   * different, informative error.
   */
  const discordBridge =
    segment === 'discord' && selectedLeagueId
      ? await getDiscordBridge(userId, selectedLeagueId).catch(() => null)
      : null

  // My team needs a league in context; without one the screen says which league
  // to pick rather than guessing at the user's "main" league.
  const myTeam =
    activeKey === 'my-team' && selectedLeagueId
      ? await getMyTeamData(selectedLeagueId, userId).catch(() => null)
      : null

  const matchup =
    activeKey === 'matchup' && selectedLeagueId
      ? await getMatchupData(selectedLeagueId, userId).catch(() => null)
      : null

  const trades =
    activeKey === 'trades' && selectedLeagueId
      ? await getTradesData(selectedLeagueId, userId).catch(() => null)
      : null

  const waivers =
    activeKey === 'waivers' && selectedLeagueId
      ? await getWaiversData(selectedLeagueId, userId).catch(() => null)
      : null

  const draftHq =
    activeKey === 'draft-hq' && selectedLeagueId
      ? await getDraftHqData(selectedLeagueId, userId).catch(() => null)
      : null

  const warRoom =
    activeKey === 'war-room' && selectedLeagueId
      ? await getWarRoomData(selectedLeagueId, userId).catch(() => null)
      : null

  const now = new Date()

  /*
   * ── 24a / 24b / 26b / 22c / 26a ────────────────────────────────────
   *
   * Each is loaded only when it is the screen being rendered. Two of them are
   * genuinely expensive — the outlook runs ten thousand simulations per league,
   * and the week board reads every WeeklyMatchup row the user's leagues have —
   * so paying for either on /core/trades would be a cost for something nobody
   * is looking at. Same rule the 34a home loader follows.
   *
   * They take `playedLeagues`, never `leagues`: the unfiltered list carries AF
   * Legacy board rows (hasUnifiedRecord: false), 543 of them on one production
   * account against 60 real teams, and none of them has a schedule to read.
   */
  const weekLeagues = playedLeagues.map((l) => ({
    id: l.id,
    name: l.name,
    platform: String(l.platform ?? ''),
    platformLeagueId: (l as { platformLeagueId?: string | null }).platformLeagueId ?? null,
    /* Only to flag elimination formats — the list already carries it. */
    leagueType: (l as { leagueType?: string | null }).leagueType ?? null,
  }))

  const rivalriesView = activeKey === 'week' && sp.view === 'rivalries'

  const weekBoard =
    activeKey === 'week' && !rivalriesView
      ? await getWeekBoard(userId, weekLeagues).catch(() => null)
      : null

  const rivalries = rivalriesView
    ? await getRivalryRadar(userId, weekLeagues).catch(() => null)
    : null

  const outlook =
    activeKey === 'season-outlook'
      ? await getSeasonOutlook(
          userId,
          playedLeagues.map((l) => ({
            id: l.id,
            name: l.name,
            platform: String(l.platform ?? ''),
            platformLeagueId: (l as { platformLeagueId?: string | null }).platformLeagueId ?? null,
            settings: (l as { settings?: unknown }).settings ?? null,
          })),
        ).catch(() => null)
      : null

  const notifications =
    activeKey === 'notifications'
      ? await getNotificationsCenter({ userId, issues: derivedIssues, now }).catch(() => null)
      : null

  /*
   * ⚠ THE NAV BADGE IS ITS OWN READ, AND IT HAS TO BE. The first version drove it
   * off `notifications?.unread`, which is only loaded when the notifications
   * screen is the one being rendered — so the badge appeared exactly on the page
   * where it was least useful and was absent everywhere else. This is an indexed
   * count on (userId, readAt), which is cheap enough to pay on every screen.
   *
   * It counts STORED notifications only. The derived "act today" rows are part
   * of the same unread number on the screen itself, but they are recomputed per
   * request and are not worth a second pass here just to bump a badge.
   */
  const [unreadNotifications, shellUser] = await Promise.all([
    prisma.platformNotification.count({ where: { userId, readAt: null } }).catch(() => 0),
    /*
     * The rail's profile chip. Read fresh from app_users rather than
     * session.user.image, which is frozen into the JWT at sign-in and goes
     * stale. avatarUrl is a full sleepercdn URL for Sleeper sign-ins and can be
     * a bare avatar hash on older rows — resolveDashboardAvatarUrl handles
     * both. Null is a real state (account has no image) and renders the
     * display-name initial, not an invented picture.
     */
    prisma.appUser
      .findUnique({
        where: { id: userId },
        select: { username: true, displayName: true, avatarUrl: true },
      })
      .catch(() => null),
  ])

  const shellProfile = {
    name: shellUser?.displayName?.trim() || shellUser?.username?.trim() || null,
    imageUrl: resolveDashboardAvatarUrl(null, shellUser?.avatarUrl) ?? null,
  }

  // 26a reads the same career payload the career screen does — no second source
  // of truth for the numbers that end up on a card the user posts publicly.
  const shareCareer =
    activeKey === 'share' ? await getCareerData(userId).catch(() => null) : null

  /*
   * The Tools hub's stat teasers. Counted, not estimated — `LeagueTrade` is the
   * table the Trades screen itself reads, so the teaser and the screen behind it
   * cannot disagree. A `catch` returns null rather than 0, because "we could not
   * count" and "there are none" are different claims and the card says so.
   */
  /*
   * ⚠ THE JOIN IS `history.sleeperLeagueId`, WHICH IS THE PLATFORM ID, NOT
   * `League.id`. `LeagueTrade` has no leagueId column at all — it hangs off
   * `LeagueTradeHistory`, which is keyed on (sleeperLeagueId, sleeperUsername).
   * That table is ingestion PROGRESS, so its row exists whether or not any trade
   * was ever loaded; counting the child rows is what actually answers "how many
   * trades do we hold".
   */
  const tradesOnFile =
    activeKey === 'tools' && weekLeagues.some((l) => l.platformLeagueId)
      ? await prisma.leagueTrade
          .count({
            where: {
              history: {
                sleeperLeagueId: {
                  in: weekLeagues
                    .map((l) => l.platformLeagueId)
                    .filter((v): v is string => typeof v === 'string' && v.length > 0),
                },
              },
            },
          })
          .catch(() => null)
      : null


  /*
   * The 34a home. Only loaded when it is the screen being rendered — it reads
   * rosters and the injury feed, and paying for that on /core/trades would be a
   * cost for something nobody is looking at.
   */
  const dash34 =
    (activeKey === 'home' || segment === 'dashboard-v2') && !selectedLeagueId
      ? await getDash34Data(userId, leagues as unknown as Dash34LeagueRow[], now).catch(() => null)
      : null

  /*
   * ONE URGENCY VOICE. dash34's brief states urgent facts — "N leagues have a
   * starter who cannot play", "N drafts are on the clock" — that
   * deriveOutstandingIssues cannot detect (its only live detectors are
   * stale_sync and draft_upcoming). Ask Chimmy's count and the "Nothing is
   * waiting on you" empty state key off this array, so without the merge the
   * queue could read clean while the brief two cards up says otherwise.
   * Synthesized from reads the loader already performed (the injury feed and
   * the draft stage), never invented — and dash34 is null on every non-home
   * screen, so the merge is the identity everywhere else.
   */
  const issues = mergeDash34Issues(derivedIssues, dash34)

  /*
   * The 3a home panels — the same loader set app/dashboard/page.tsx ran before
   * that route retired into a redirect here. Loaded ONLY when the 3a home is
   * the screen being rendered, never for the dashboard-v2 segment. Exposure and
   * rivals read every played league, but the win probability is priced ONLY for
   * the four leagues whose matchup cards actually render — getMatchupData runs
   * several queries per league, and pricing 60 of them to display four would be
   * work nobody sees.
   */
  const isHome3a = activeKey === 'home' && segment !== 'dashboard-v2' && !selectedLeagueId

  /*
   * P4-5: the /core home's ONE Decision OS read — the deterministic user-os
   * snapshot for the league that most needs the user right now. "Most urgent"
   * follows the same ladder the home itself leads with: dash34's first
   * priority === 'urgent' league (a starter who cannot play), then its first
   * priority === 'draft' league, then the head of the issues queue (already
   * sorted severity-then-deadline inside deriveOutstandingIssues), falling
   * back to the first played league.
   * One league only, loaded only when the 3a home renders, and resolved
   * directly rather than through /api/decision-os/user-os: membership is
   * already established by the league list read above, and
   * resolveUserOsSnapshot scopes every fact to the caller's own managerId.
   * It never throws, and a null here renders NOTHING — see DashUserOs.
   */
  const dash34Ranked = dash34?.allLeagues ?? dash34?.leagues ?? []
  const homeUserOsAnchorId =
    dash34Ranked.find((l) => l.priority === 'urgent')?.id ??
    dash34Ranked.find((l) => l.priority === 'draft')?.id ??
    issues.find((i) => i.leagueId != null)?.leagueId ??
    null
  const homeUserOsLeague = isHome3a
    ? (playedLeagues.find((l) => l.id === homeUserOsAnchorId) ?? playedLeagues[0] ?? null)
    : null

  const [
    homeCareer,
    homeWeek,
    homeExposure,
    homeRivals,
    homeUserOs,
    homeSchedule,
    homeStrip,
    homePlays,
    homeRegularSeason,
  ] = isHome3a
    ? await Promise.all([
        getCareerData(userId).catch(() => null),
        getWeekAll(userId, weekLeagues).catch(() => null),
        getCrossLeagueExposure(userId, playedLeagues.map((l) => l.id)).catch(() => null),
        getRivalRecords(userId, playedLeagues.map((l) => l.id)).catch(() => null),
        homeUserOsLeague
          ? resolveUserOsSnapshot(homeUserOsLeague.id, userId).catch(() => null)
          : Promise.resolve(null),
        /*
         * WHO you play, which getWeekAll cannot answer: it drops every 0-0 row
         * by design, so before a week is scored the matchup section has
         * nothing to render. getWeekBoard pairs on matchupId without ever
         * reading points, and costs three set-based queries plus one shared
         * cached kickoff read no matter how many leagues — the same shape as
         * its neighbours here, not a per-league fan-out. `activeKey` is 'home'
         * on this branch and 'week' on the other caller above, so the two are
         * mutually exclusive and nothing is fetched twice.
         */
        getWeekBoard(userId, weekLeagues).catch(() => null),
        /*
         * The game-day pair. Both were built for the dashboard-v2 segment and
         * mounted nowhere else, so the home had nothing that moved during the
         * six hours a manager actually sits in it. getPlayFeed is
         * readPlayByPlayFeed plus headshots and a composed headline; both
         * return quiet values off a slate ([] and an unavailable record), and
         * the band renders nothing on them.
         */
        getTodayStrip(
          userId,
          playedLeagues.map((l) => ({
            id: l.id,
            name: l.name,
            sport: (l as { sport?: string | null }).sport ?? null,
            platformLeagueId: (l as { platformLeagueId?: string | null }).platformLeagueId ?? null,
            /* The health tile's primary gate — see the v2 caller's note. */
            lastSyncedAt: (l as { lastSyncedAt?: Date | string | null }).lastSyncedAt ?? null,
          })),
          now,
        ).catch(() => null),
        getPlayFeed(12).catch(() => []),
        /*
         * Has the regular season actually kicked off? The game-day band claimed
         * in prose that it must not render over preseason football and then did
         * not enforce it — a live-looking band over a Saturday exhibition
         * nobody's lineup scores. Cached and user-independent, so it costs
         * nothing per viewer.
         */
        hasRegularSeasonStarted('NFL').catch(() => false),
      ])
    : [null, null, null, null, null, null, null, [], false]

  /*
   * ⚠ PRICE THE CARDS THAT RENDER, NOT THE FIRST FOUR LEAGUES. Dashboard3A's
   * matchup grid shows `scored.slice(0, 4)` — live-scored leagues first, then
   * weekAll's scored rows — and `scoredMatchupLeagueIds` replicates that exact
   * derivation from the same inputs. Pricing `playedLeagues.slice(0, 4)` paid
   * several queries per league for cards showing a DIFFERENT league — or,
   * before the season starts, no card at all. When the scored set is empty,
   * nothing is priced: zero round-trips instead of four.
   *
   * Serial after the Promise.all because it needs `homeWeek`; it only runs
   * when at least one card will render, which is exactly when the work is
   * visible.
   */
  const scoredIds = isHome3a
    ? scoredMatchupLeagueIds(
        (dash34?.leagues ?? []).filter((l) => l.score).map((l) => l.id),
        homeWeek,
      )
    : []
  const homeMatchups =
    scoredIds.length > 0
      ? await Promise.all(
          scoredIds.map((id) =>
            getMatchupData(id, userId)
              .then((m) => ({ id, m }))
              .catch(() => ({ id, m: null })),
          ),
        )
      : null

  /*
   * Only leagues whose BOTH lineups priced land here. An absent entry renders no
   * percentage at all rather than a hedged one — a greyed-out probability still
   * reads as a probability.
   */
  const winProb: Record<string, number> = {}
  for (const { id, m } of homeMatchups ?? []) {
    if (m?.winProbability.available) winProb[id] = m.winProbability.data.pWin
  }

  /*
   * Drafts on the clock — the same cross-league aggregator the dashboard-v2
   * segment reads (three set-based queries regardless of league count), called
   * here ONLY for the 3a home. `isHome3a` is false when segment ===
   * 'dashboard-v2', so the v2 dispatch below never pays for this twice.
   * playedLeagues, NOT leagues, for the same AF-Legacy reason as the v2 call
   * site — the unfiltered list carries hundreds of past-season board rows. A
   * loader failure is null, and null renders NOTHING — see DashDraftsBand.
   */
  const homeDrafts = isHome3a
    ? await getDraftHqAll(
        userId,
        playedLeagues.map((l) => ({
          id: l.id,
          name: l.name,
          platform: String(l.platform ?? ''),
          imageUrl: (l as { avatarUrl?: string | null }).avatarUrl ?? null,
        })),
      ).catch(() => null)
    : null

  /*
   * The activation funnel signal, carried over from /dashboard when that route
   * retired into a redirect here — a cut-over that silently stopped counting
   * activations would be invisible until someone asked why the funnel died.
   * Contract unchanged: not awaited, never throws, idempotent per user, and a
   * null league list means "unknown", not "zero".
   */
  if (isHome3a) {
    void recordDashboardActivation({
      userId,
      leagueCount: leagueListPayload ? leagueListPayload.leagues.length : null,
      getCookie: (name) => cookies().get(name)?.value,
    })
  }

  /*
   * Dashboard v2 — served AFTER the session gate (a signed-in surface that needs
   * the user's leagues) but OUTSIDE AfCoreShell, because it brings its own 300px
   * left panel. Inside the shell it would render a league rail beside a league
   * panel.
   *
   * No new route: a segment on the existing catch-all, which is what this route
   * exists for. The repo sits at Vercel's hard 2048-route ceiling.
   */

  /*
   * ⚠ SYNC AGE IS NOW READ, NOT ASSUMED. This was hardcoded to `null` — "never
   * synced" — with a comment saying a per-league timestamp was not wired through.
   * It is: the league list already selects `League.lastSyncedAt`. Measured on
   * production it is null for all 98 leagues, so the label does not change today,
   * but it will the moment a sync runs, and the shell no longer lies about
   * whether it is looking.
   */
  const lastSynced = playedLeagues.reduce<Date | null>((latest, l) => {
    const raw = (l as { lastSyncedAt?: Date | string | null }).lastSyncedAt
    if (!raw) return latest
    const d = raw instanceof Date ? raw : new Date(raw)
    if (Number.isNaN(d.getTime())) return latest
    return latest == null || d > latest ? d : latest
  }, null)
  const syncAge = describeAge('roster', lastSynced, now)

  /*
   * The plan chip and token meter. The handoff is explicit that the meter must be
   * visible BEFORE anything spends, and Chimmy is the only thing that spends — so
   * the number belongs in the chrome, not on the screen that happens to open the
   * chat. `null` on a read failure omits the chip rather than showing a made-up
   * tier or a zero balance the user does not actually have.
   */
  const access = await aiAccessResolver.resolveForUser({ userId, now }).catch(() => null)
  const plan = access
    ? {
        // Plan ids are slugs — 'war_room', 'supreme'. Rendering one raw puts an
        // internal identifier in the chrome of the signed-in home.
        name: access.hasSubscription
          ? titleCase(access.subscription.plans[0] ?? 'premium')
          : access.trial.inTrial
            ? `Trial · ${access.trial.daysRemaining}d left`
            : 'Free',
        tokensLeft: access.tokenBalance,
      }
    : null

  /*
   * Placed AFTER `plan` and `syncAge` are computed, not before. It reads both,
   * and the first version of this dispatch sat above their declarations — tsc
   * caught it as use-before-declaration rather than it failing at runtime.
   */
  if (segment === 'dashboard-v2') {
    /*
     * Both of these are CROSS-LEAGUE, which is why they can feed this screen.
     * getDraftHqData and getWarRoomData take a leagueId — they are per-league
     * and cannot back a cross-league module. Wiring one of them to a single
     * arbitrary league would put one league's draft under a header that says
     * "all leagues", so those sections stay placeholders until an aggregator
     * exists.
     */
    const [careerData, portfolioData, draftData, weekData, stripData, playEvents] = await Promise.all([
      getCareerData(userId).catch(() => null),
      getPortfolio(userId).catch(() => null),
      /*
       * playedLeagues, NOT leagues. The unfiltered list carries AF Legacy board
       * rows (hasUnifiedRecord: false) — 543 of them on one production account
       * against 60 real teams. Passing those in would widen the IN () clause to
       * 604 ids and put past-season snapshots in a live draft rail. Same filter
       * the rail and the home loader apply, for the same reason.
       */
      getDraftHqAll(
        userId,
        playedLeagues.map((l) => ({
          id: l.id,
          name: l.name,
          platform: String(l.platform ?? ''),
          imageUrl: (l as { avatarUrl?: string | null }).avatarUrl ?? null,
        })),
      ).catch(() => null),
      getWeekAll(
        userId,
        playedLeagues.map((l) => ({
          id: l.id,
          name: l.name,
          platform: String(l.platform ?? ''),
          platformLeagueId: (l as { platformLeagueId?: string | null }).platformLeagueId ?? null,
        })),
      ).catch(() => null),
      /*
       * The three top cards. `lastSyncedAt` is passed through because it is the
       * health tile's primary gate — the engine reports high confidence on the
       * strength of roster rows alone, and production has 873 rosters across
       * leagues that have never once been synced. Dropping this field here would
       * silently re-open the exact bug the tile exists to prevent.
       */
      getTodayStrip(
        userId,
        playedLeagues.map((l) => ({
          id: l.id,
          name: l.name,
          sport: (l as { sport?: string | null }).sport ?? null,
          platformLeagueId: (l as { platformLeagueId?: string | null }).platformLeagueId ?? null,
          lastSyncedAt: (l as { lastSyncedAt?: Date | string | null }).lastSyncedAt ?? null,
        })),
        now,
      ).catch(() => null),
      /*
       * The live play feed — the same cache the dashboard API's `plays` payload
       * reads (`getPlayFeed` is this reader plus headshots). [] on a quiet day;
       * a feed failure must never take down the dashboard.
       */
      readPlayByPlayFeed(12).catch(() => []),
    ])
    return (
      <DashboardV2
        data={dash34}
        weekLabel={dash34?.weekLabel ?? null}
        career={careerData}
        portfolio={portfolioData}
        drafts={draftData}
        week={weekData}
        strip={stripData}
        plays={playEvents}
        nowIso={now.toISOString()}
        planName={plan?.name ?? null}
        syncedLabel={syncAge.stale ? null : syncAge.label}
        commissionerCount={playedLeagues.filter((l) => Boolean(l.isCommissioner)).length}
      />
    )
  }

  const commissionerCount = playedLeagues.filter((l) => Boolean(l.isCommissioner)).length

  /*
   * The Chimmy price the drawer shows BEFORE the user sends anything, read from
   * the real catalog rather than typed in. `ai_chimmy_chat_message` is the rule
   * /api/chat/chimmy actually spends against.
   */
  const chimmyTokenCost = getTokenSpendRuleMatrixEntry('ai_chimmy_chat_message')?.tokenCost ?? null

  /*
   * 23b docks the drawer beside the content on league-scoped screens — a roster
   * or a matchup, where "who should I flex" is asked about the thing on screen.
   * Cross-league screens overlay instead: there is no single place to lose.
   */
  const dockable =
    selectedLeagueId != null &&
    (activeKey === 'my-team' ||
      activeKey === 'matchup' ||
      activeKey === 'trades' ||
      activeKey === 'waivers' ||
      activeKey === 'draft-hq' ||
      activeKey === 'war-room' ||
      activeKey === 'home')

  return (
    <AfCoreShell
      active={activeKey}
      leagues={rail}
      syncAge={{ label: syncAge.label, stale: syncAge.stale }}
      selectedLeagueId={selectedLeagueId}
      weekLabel={dash34?.weekLabel ?? null}
      plan={plan}
      commissionerCount={commissionerCount}
      notificationCount={unreadNotifications}
      profile={shellProfile}
      comms={{
        leagues: playedLeagues.slice(0, 12).map((l) => ({
          id: l.id,
          name: l.name,
          platform: String(l.platform ?? 'manual').toLowerCase(),
        })),
        chimmyTokenCost,
        dockable,
        supportEmail: (session?.user as { email?: string | null } | undefined)?.email ?? null,
        /*
         * Carried over from the /core home's old floating bubble, which the
         * shell's launcher replaced. Without this the badge would simply have
         * disappeared when that bubble was removed.
         */
        unread: dash34?.chatUnread ?? 0,
        /*
         * The home's own claims, handed to the assistant the user opens FROM
         * those claims. Derived from the same dash34 facts that feed the brief
         * and the issues queue, so the three cannot disagree. Ids and counts
         * only — the route resolves names itself; see lib/core-app/homeSignals.ts
         * for why nothing free-text crosses that boundary.
         */
        homeSignals: serializeHomeSignals(buildHomeSignals(dash34, issues.length)),
      }}
    >
      {segment === 'bracket' ? (
        bracket ? (
          <BracketChallenge data={bracket} />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Bracket Challenge
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              The team list for this sport could not be read just now. Nothing is lost — reload, or
              pick another sport.
            </p>
          </div>
        )
      ) : segment === 'discord' ? (
        discordBridge ? (
          <DiscordBridge data={discordBridge} />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Discord bridge
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              Pick a league you commission from the rail. The bridge is configured per league —
              which channel a league posts to, and in which direction, only means something inside
              one league.
            </p>
          </div>
        )
      ) : leagueHome ? (
        <LeagueHome
          data={leagueHome}
          otherLeagueIssueCount={issues.filter((i) => i.leagueId !== leagueHome.league.id).length}
          // 3b renders one urgent action. Already sorted by severity then
          // deadline inside deriveOutstandingIssues, so the head of this list is
          // the row the screen shows.
          issues={issues.filter((i) => i.leagueId === leagueHome.league.id)}
        />
      ) : activeKey === 'my-team' ? (
        myTeam ? (
          <MyTeam data={myTeam} />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              My team
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              Pick a league from the rail to see your lineup. This screen is scoped to one league —
              your roster, slots and lock time only mean something inside a single league&apos;s rules.
            </p>
          </div>
        )
      ) : activeKey === 'matchup' ? (
        matchup ? (
          <Matchup data={matchup} />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Matchup
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              Pick a league from the rail to see its matchup. A head-to-head only means something
              inside one league&apos;s schedule and scoring.
            </p>
          </div>
        )
      ) : activeKey === 'trades' ? (
        trades ? (
          <Trades data={trades} />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Trades
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              Pick a league from the rail. Every trade grade is scored against one league&apos;s own
              scoring and roster rules, so trades only mean something inside a league.
            </p>
          </div>
        )
      ) : activeKey === 'waivers' ? (
        waivers ? (
          <Waivers data={waivers} />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Waivers
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              Pick a league from the rail. FAAB, waiver order and bid pricing are all per-league.
            </p>
          </div>
        )
      ) : activeKey === 'draft-hq' ? (
        draftHq ? (
          <DraftHq data={draftHq} />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Draft HQ
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              Pick a league from the rail. Draft order, pick slots and board settings are all
              per-league.
            </p>
          </div>
        )
      ) : activeKey === 'war-room' ? (
        warRoom ? (
          <WarRoom data={warRoom} />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              War Room
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              Pick a league from the rail. The board, the clock and the queue all belong to one
              league&apos;s draft.
            </p>
          </div>
        )
      ) : activeKey === 'players' ? (
        <PlayerFinder
          query={playerQuery}
          matches={playerMatches}
          detail={playerDetail}
          leagueCount={playedLeagues.length}
        />
      ) : activeKey === 'week' ? (
        /*
         * 24a and 24b share one screen key. `?view=rivalries` picks the panel —
         * they read the same WeeklyMatchup rows through the same pairing, and two
         * sibling routes for one data layer is the spend that pushed this repo
         * against the route ceiling.
         */
        rivalriesView ? (
          rivalries ? (
            <RivalryRadar data={rivalries} weekHref="/core/week" />
          ) : (
            <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
              <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
                Rivalry Radar
              </h1>
              <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
                We could not read your matchup history just now. This is a read failure on our side,
                not a sign that you have never played anybody.
              </p>
            </div>
          )
        ) : weekBoard ? (
          <YourWeek data={weekBoard} rivalriesHref="/core/week?view=rivalries" />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Your week
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not read this week&apos;s matchups just now. This is a read failure on our
              side, not a week with no games.
            </p>
          </div>
        )
      ) : activeKey === 'season-outlook' ? (
        outlook ? (
          <SeasonOutlook data={outlook} />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Season Outlook
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not run the simulations just now. This is a read failure on our side, not a
              season with nothing left to decide.
            </p>
          </div>
        )
      ) : activeKey === 'notifications' ? (
        notifications ? (
          <NotificationsCenter data={notifications} />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Notifications
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not read your notifications just now. This is a read failure on our side, not
              an empty inbox.
            </p>
          </div>
        )
      ) : activeKey === 'share' ? (
        shareCareer ? (
          <CareerShare
            career={shareCareer}
            leagues={playedLeagues.slice(0, 12).map((l) => ({
              id: l.id,
              name: l.name,
              platform: String(l.platform ?? 'manual').toLowerCase(),
            }))}
            selectedLeagueId={selectedLeagueId}
            /*
             * ⚠ NULL BECAUSE THE CALL IS NOT CHARGED, NOT BECAUSE WE DID NOT LOOK.
             * /api/share/generate-copy takes no token spend and has no rule in
             * lib/tokens/pricing-matrix.ts. The button says "included in your
             * plan" rather than printing a price we do not take. If a caption
             * spend rule is ever added, read it here the way the drawer reads
             * `ai_chimmy_chat_message`.
             */
            tokenCost={null}
            /*
             * The real reward, from server/api-route-modules/legacy/share-reward:
             * tokensAwarded is 1 and the route gates on one share per day. The
             * handoff flags the vague "earn tokens for sharing" copy as a bug
             * precisely because it states no number.
             */
            reward={{ tokensPerShare: 1, oncePerDay: true }}
          />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Career Share
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not read your career just now, and this card is built from it. This is a read
              failure on our side, not a career with nothing in it.
            </p>
          </div>
        )
      ) : activeKey === 'tools' ? (
        <Tools
          data={buildToolsHub({
            issues,
            stats: {
              leaguesPlayed: playedLeagues.length,
              /*
               * Read, not estimated. These feed the "Understand something" cards'
               * stat teasers, and a teaser that overstates what is on file is the
               * same lie as an invented deadline.
               */
              tradesOnFile,
              /*
               * ⚠ LEAGUES, AND THE FIELD IS NAMED FOR IT. This briefly read
               * `seasonsOnFile: playedLeagues.length`, which put a league count
               * under the word "seasons" on the Manager Psychology card — a
               * dynasty league running six years is one league and six seasons,
               * so the two are not interchangeable. Career history is a separate
               * read and is not worth paying for to fill a teaser.
               */
              connectedLeagues: playedLeagues.filter(
                (l) => (l as { platformLeagueId?: string | null }).platformLeagueId,
              ).length,
            },
            selectedLeagueId,
          })}
        />
      ) : activeKey === 'rankings' ? (
        rankingsView === 'compare' ? (
          <RankingsCompare result={compare} query={compareQuery} />
        ) : rankings ? (
          rankingsView === 'faq' ? (
            <RankingsFaq data={rankings} />
          ) : (
            <Rankings data={rankings} board={typeof sp.board === 'string' ? sp.board : null} />
          )
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Rankings
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not read the rankings just now. This is a read failure on our side, not a sign
              that nobody is ranked.
            </p>
          </div>
        )
      ) : activeKey === 'career' ? (
        career ? (
          <Career
            data={career}
            view={typeof sp.view === 'string' ? sp.view : null}
            share={shareCard}
          />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Career
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not read your career history just now. This is a read failure on our side, not a
              sign that you have none.
            </p>
          </div>
        )
      ) : activeKey === 'portfolio' ? (
        portfolio ? (
          <Portfolio data={portfolio} />
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Portfolio
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not load your leagues just now. This is a read failure on our side, not a
              sign that you have none.
            </p>
          </div>
        )
      ) : activeKey === 'home' ? (
        /*
         * ⚠ THIS REPLACED THE "OUTSTANDING ISSUES" QUEUE, AND THE QUEUE IS WHY.
         * That screen derived one row per league per problem and rendered 604 of
         * them — the same "League data is stale" sentence, 604 times — for a real
         * account. 34a leads with the single most time-critical thing, then a
         * league list ranked by what needs you, capped, with the account-wide
         * facts stated once. The queue's one genuinely load-bearing feature, the
         * "not yet watched" disclosure, is carried across as `coverage`.
         */
        dash34 ? (
          <>
            {/*
              Drafts on the clock — leads the home whenever any league's draft
              is live right now (the founder's week). One card per live draft,
              capped at 4 with a Draft HQ overflow link. Zero live drafts, or a
              loader failure, renders NOTHING — see DashDraftsBand's header for
              the honesty rules (raw status shown, no invented timers).
            */}
            {/*
              Game day leads everything while a slate is live — a running game
              outranks a draft clock and a countdown. It renders only inside a
              game window (a play detected in the last few hours, or a scored
              matchup of the user's), so outside one this is not a quiet band,
              it is no band at all.
            */}
            <DashGameDayBand
              strip={homeStrip}
              plays={homePlays}
              now={now}
              regularSeasonUnderway={homeRegularSeason}
            />
            <DashDraftsBand data={homeDrafts} now={now} />
            {/*
              34a's four unique sections (first-lock band, honesty notice,
              Chimmy brief, coverage list) — carried over so the cutover
              loses nothing 3A doesn't render. See Dash34Carryover's header
              for what was deliberately NOT carried and why.
            */}
            <Dash34Carryover data={dash34} />
            {/*
              P4-5: the first /core surface that reads Decision OS at all — the
              deterministic user-os card for the most urgent league. Renders
              NOTHING on any failure or coverage gap; see DashUserOs's header
              for the render-nothing rules.
            */}
            <DashUserOs
              snapshot={homeUserOs}
              leagueId={homeUserOsLeague?.id ?? null}
              leagueName={homeUserOsLeague?.name ?? null}
            />
            {/*
              Starters in doubt — the DECISION slice of the injury book (see
              Dash3ATriage's filter). ⚠ DELIBERATELY NOT FIRST: as a leading
              wall of headshots it buried the page under noise
              (founder-reported 2026-08-24); it now sits under the first-lock
              band and renders nothing on days with no lineup decisions.
            */}
            <Dash3ATriage
              book={(dash34.book ?? null) as unknown as TriageBookRow[] | null}
              now={now}
              valueBasis={dash34.valueBasis ?? null}
            />
            {/*
              WHO you play this week, immediately above the section that can
              only show scores. Until a week is scored — every week before
              kickoff, and all of preseason — Dashboard3A's matchup grid is an
              empty frame, because both of its sources drop unscored rows on
              purpose. This band answers the half of the question that IS
              knowable: opponent, league, first kickoff. It renders nothing
              when the read fails or no league has a schedule on file.
            */}
            <DashScheduleBand
              board={homeSchedule}
              syncLabel={syncAge.stale ? null : syncAge.label}
            />
            {/*
              3a mounted as the screen BODY. It ships its own rail/nav/topbar
              for the standalone render it was built for; af-core-shell.css
              suppresses that chrome under .af-content so the shell's own
              rail, nav and topbar stand alone.
            */}
            <Dashboard3A
              issues={issues}
              exposure={homeExposure}
              rivals={homeRivals}
              winProb={winProb}
              data={dash34}
              career={homeCareer}
              week={homeWeek}
              weekLabel={dash34.weekLabel ?? null}
              planName={plan?.name ?? null}
              commissionerCount={commissionerCount}
              nowLabel={syncAge.stale ? null : syncAge.label}
            />
          </>
        ) : (
          <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
            <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
              Your leagues
            </h1>
            <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
              We could not read your leagues just now. This is a read failure on our side, not a sign
              that you have none.
            </p>
          </div>
        )
      ) : (
        <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
          <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
            {activeKey.replace(/-/g, ' ')}
          </h1>
          <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
            This screen is part of the core-app redesign and has not been built yet. It is listed in
            the nav so the shell matches the design, and says so rather than rendering an empty page.
          </p>
        </div>
      )}
    </AfCoreShell>
  )
}
