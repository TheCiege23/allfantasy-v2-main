import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { deriveOutstandingIssues } from '@/lib/core-app/outstandingIssues'
import { describeAge } from '@/lib/sports-data/freshnessPolicy'
import { aiAccessResolver } from '@/lib/ai-access/AIAccessResolver'
import AfCoreShell, { type CoreNavKey, type RailLeague } from '@/components/core-app/AfCoreShell'
import type { UserLeague } from '@/app/dashboard/types'
import Dashboard34 from '@/components/core-app/screens/Dashboard34'
import { getDash34Data, type Dash34LeagueRow } from '@/lib/core-app/dash34'
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
import AuthV4 from '@/components/core-app/screens/AuthV4'
import ImportV4, { type ImportPreviewState } from '@/components/core-app/screens/ImportV4'
import { Portfolio } from '@/components/core-app/screens/Portfolio'
import { Tools } from '@/components/core-app/screens/Tools'
import { Career } from '@/components/core-app/screens/Career'
import { getCareerData } from '@/lib/core-app/career'
import { getPortfolio } from '@/lib/core-app/portfolio'
import { getDraftHqAll } from '@/lib/core-app/draftHqAll'
import { getWeekAll } from '@/lib/core-app/weekAll'

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
  }))

  const { issues } = deriveOutstandingIssues({ leagues })

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

  const playerMatches = activeKey === 'players' ? await searchPlayers(playerQuery).catch(() => []) : []
  const playerDetail =
    activeKey === 'players' && selectedPlayerId
      ? await getPlayerDetail(
          selectedPlayerId,
          leagues.map((l) => l.id),
          userId
        ).catch(() => null)
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
   * The 34a home. Only loaded when it is the screen being rendered — it reads
   * rosters and the injury feed, and paying for that on /core/trades would be a
   * cost for something nobody is looking at.
   */
  const dash34 =
    (activeKey === 'home' || segment === 'dashboard-v2') && !selectedLeagueId
      ? await getDash34Data(userId, leagues as unknown as Dash34LeagueRow[], now).catch(() => null)
      : null

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
    const [careerData, portfolioData, draftData, weekData] = await Promise.all([
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
        playedLeagues.map((l) => ({ id: l.id, name: l.name, platform: String(l.platform ?? '') })),
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
    ])
    return (
      <DashboardV2
        data={dash34}
        weekLabel={dash34?.weekLabel ?? null}
        career={careerData}
        portfolio={portfolioData}
        drafts={draftData}
        week={weekData}
        nowIso={now.toISOString()}
        planName={plan?.name ?? null}
        syncedLabel={syncAge.stale ? null : syncAge.label}
      />
    )
  }

  const commissionerCount = playedLeagues.filter((l) => Boolean(l.isCommissioner)).length

  return (
    <AfCoreShell
      active={activeKey}
      leagues={rail}
      syncAge={{ label: syncAge.label, stale: syncAge.stale }}
      selectedLeagueId={selectedLeagueId}
      weekLabel={dash34?.weekLabel ?? null}
      plan={plan}
      commissionerCount={commissionerCount}
    >
      {leagueHome ? (
        <LeagueHome
          data={leagueHome}
          otherLeagueIssueCount={issues.filter((i) => i.leagueId !== leagueHome.league.id).length}
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
          leagueCount={leagues.length}
        />
      ) : activeKey === 'tools' ? (
        <Tools />
      ) : activeKey === 'career' ? (
        career ? (
          <Career data={career} view={typeof sp.view === 'string' ? sp.view : null} />
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
          <Dashboard34 data={dash34} />
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
