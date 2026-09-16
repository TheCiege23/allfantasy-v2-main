import Link from 'next/link'
import { Suspense, type ComponentProps, type ReactNode } from 'react'
import CoreCardBoundary from '@/components/core-app/CoreCardBoundary'
import { CardFreshness } from '@/components/core-app/home/CardFreshness'
import { DecisionQueue } from '@/components/core-app/home/DecisionQueue'
import { HomeActivity, HomePrefetch } from '@/components/core-app/home/HomeClientEffects'
import { freshnessStamp, latestInstant, type CardFreshnessStamp } from '@/lib/core-app/cardFreshness'
import { rankDecisions } from '@/lib/core-app/decisionQueue'
import type { HomeCardOrder } from '@/lib/core-app/homeCardOrder'
import { homePrefetchTargets } from '@/lib/core-app/homePrefetchTargets'
import Dashboard3A, {
  Dash3ACareer,
  Dash3AChimmy,
  Dash3AExposure,
  Dash3AFollowing,
  Dash3ALeagues,
  Dash3AMatchups,
  Dash3APortfolioChart,
  Dash3AReceipts,
  Dash3ARivals,
  Dash3ARoutine,
} from '@/components/core-app/screens/Dashboard3A'
import { Dash3ATriage, type TriageBookRow } from '@/components/core-app/screens/Dash3ATriage'
import { Dash34Carryover, Dash34Coverage } from '@/components/core-app/screens/Dash34Carryover'
import { DashDraftsBand } from '@/components/core-app/screens/DashDraftsBand'
import { DashGameDayBand } from '@/components/core-app/screens/DashGameDayBand'
import { DashScheduleBand } from '@/components/core-app/screens/DashScheduleBand'
import { DashSinceLastVisit } from '@/components/core-app/screens/DashSinceLastVisit'
import { DashTradeBand } from '@/components/core-app/screens/DashTradeBand'
import { DashUserOs } from '@/components/core-app/screens/DashUserOs'
import type { Dash34Result } from '@/lib/core-app/dash34'
import { platformCountsOf } from '@/components/core-app/screens/dash3aPortfolio'

/**
 * The /core home, one streamed card at a time.
 *
 * WHY. The home used to await every one of its reads before rendering anything: the cross-league
 * summary, then a current-week read, then thirteen reads together, then the "since your last visit"
 * brief, win probabilities, drafts and the tab badges — each in line behind the last. The whole
 * home arrived when its SLOWEST read finished, so a slow receipts query held back the injury triage
 * and a cold matchup pricing held back your career card.
 *
 * Now `page.tsx` STARTS every read and hands the promises here (`HomeLoads`). Each card waits only
 * for the reads it shows, behind its own Suspense boundary and its own error boundary, and streams
 * in the moment those land. The layout is `Dashboard3A`'s, unchanged: its cards render through
 * slots in the same places.
 *
 * ⚠ ONE READ, SHARED — NEVER A READ PER CARD. `dash34` feeds eight cards directly (triage, carryover,
 * issues, matchups, Chimmy, the portfolio chart, my leagues, coverage) and three more through reads
 * that chain on it (routine, the Decision OS card, the tab badges); they all await the SAME promise,
 * so it is fetched once, exactly as before.
 *
 * ⚠ SLICES ACROSS THE CLIENT BOUNDARY, NOT THE SUMMARY. `Dashboard3A`'s cards are client components,
 * so their props are serialized into the page. Each gets only what it shows — the ranked league list,
 * the total, pre-computed platform counts — never the whole summary (every league, the injury book),
 * which would otherwise be sent once per card.
 *
 * ⚠ THE "COULD NOT READ YOUR LEAGUES" RULE SURVIVES, CARD BY CARD. When `dash34` failed, the home
 * used to be replaced by one honest panel, because its cards would otherwise claim "no leagues" or
 * "nothing is waiting on you" about data we never read. Now every card that depends on `dash34`
 * renders NOTHING without it, and the decision queue (card `issues`, the first on the page) shows
 * that same panel. Cards with their own reads (career, rivals, exposure, the bands) still render:
 * they were never about `dash34`, and a failed summary is no reason to hide a correct career record.
 *
 * 2026-09-16 — the general view's brief, in one place:
 *   - the decision queue leads the page (`DecisionQueue`, `lib/core-app/decisionQueue.ts`);
 *   - the page covers the leagues the scope switcher names (`HomeScopeInfo`, `lib/core-app/homeScope.ts`);
 *   - every major card says how old its data is (`CardFreshness`, `lib/core-app/cardFreshness.ts`);
 *   - the bands and columns follow the viewer's order (`lib/core-app/homeCardOrder.ts`);
 *   - likely destinations are prewarmed (`HomeClientEffects`), and the queue's "show more" survives
 *     Back (`homeViewState.ts`). The scroll position already does — see HomeClientEffects' header.
 */

export type HomeLoads = {
  /** The loader's own result — it carries `weekLabel` and `valueBasis` beyond the screens' `Dash34Data`. */
  dash34: Promise<Dash34Result | null>
  issues: Promise<ComponentProps<typeof DecisionQueue>['issues']>
  career: Promise<ComponentProps<typeof Dash3ACareer>['career']>
  week: Promise<ComponentProps<typeof Dash3AMatchups>['week']>
  winProb: Promise<Record<string, number>>
  exposure: Promise<ComponentProps<typeof Dash3AExposure>['exposure']>
  rivals: Promise<ComponentProps<typeof Dash3ARivals>['rivals']>
  following: Promise<ComponentProps<typeof Dash3AFollowing>['following']>
  receipts: Promise<ComponentProps<typeof Dash3AReceipts>['receipts']>
  routine: Promise<ComponentProps<typeof Dash3ARoutine>['routine']>
  userOs: Promise<{
    snapshot: ComponentProps<typeof DashUserOs>['snapshot']
    league: { id: string; name: string } | null
  }>
  schedule: Promise<ComponentProps<typeof DashScheduleBand>['board']>
  strip: Promise<ComponentProps<typeof DashGameDayBand>['strip']>
  plays: Promise<ComponentProps<typeof DashGameDayBand>['plays']>
  regularSeason: Promise<ComponentProps<typeof DashGameDayBand>['regularSeasonUnderway']>
  trades: Promise<ComponentProps<typeof DashTradeBand>['trades']>
  brief: Promise<ComponentProps<typeof DashSinceLastVisit>['brief']>
  drafts: Promise<ComponentProps<typeof DashDraftsBand>['data']>
  /** Not a card: settles once the trade scan's pending-offers cache write has. The tab badges wait on it. */
  offersSettled: Promise<void>
}

/** The render-failure boundaries' names (the `af.card` tag on a reported card failure). */
export type HomeCardName =
  | 'since-last-visit'
  | 'game-day'
  | 'drafts'
  | 'triage'
  | 'trade-band'
  | 'carryover'
  | 'user-os'
  | 'schedule'
  | 'routine'
  | 'issues'
  | 'matchups'
  | 'chimmy'
  | 'career'
  | 'rivals'
  | 'portfolio-chart'
  | 'exposure'
  | 'following'
  | 'receipts'
  | 'leagues'
  | 'coverage'

/** Holds a card's place while it streams, so the cards around it do not jump when it lands. */
function CardSkeleton({ height }: { height: number }) {
  return <div className="af-sk-block" aria-hidden="true" style={{ height, borderRadius: 14, marginBottom: 12 }} />
}

/**
 * What the home knows before any card streams: which leagues it covers, and when their data was
 * last read. Built once in `page.tsx`.
 */
export type HomeScopeInfo = {
  /** "All leagues", "NFL leagues"… */
  label: string
  /** The scope's URL value, or 'all' — keys the remembered disclosures. */
  key: string
  scoped: boolean
  /** Leagues in scope, and in the whole portfolio. */
  count: number
  total: number
}

/** The newest injury report behind the summary's book — the triage and decision stamps. */
function injuriesAt(data: Dash34Result | null): string | null {
  const latest = latestInstant((data?.book ?? []).map((row) => (row as { reportedAt?: string | null }).reportedAt ?? null))
  return latest ? latest.toISOString() : null
}

function Stamps({ stamps }: { stamps: CardFreshnessStamp[] }) {
  return <CardFreshness stamps={stamps} />
}

/* ── The cards. Each awaits only what it shows. ───────────────────────────────────────────── */

/**
 * The decision queue — the home's first card. Also decides what to prewarm, because the queue is
 * what the reader is most likely to act on (lib/core-app/homePrefetchTargets.ts).
 */
async function DecisionsCard({
  dash34,
  issues,
  trades,
  now,
  scope,
  rostersStamp,
  prefetch,
}: Pick<HomeLoads, 'dash34' | 'issues' | 'trades'> & {
  now: Date
  scope: HomeScopeInfo
  rostersStamp: CardFreshnessStamp
  prefetch: { unreadNotifications: number; gameDayActive: boolean }
}) {
  const [data, list] = await Promise.all([dash34, issues])
  if (!data) {
    // The panel that used to replace the whole home when this read failed — see the header.
    return (
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
  }
  return (
    <DecisionQueue
      issues={list}
      scopeLabel={scope.label}
      scopeKey={scope.key}
      nowIso={now.toISOString()}
      freshness={
        <Stamps stamps={[rostersStamp, freshnessStamp('Injury reports', injuriesAt(data), now, { missing: 'none-yet' })]} />
      }
    >
      {/*
        Streamed on its own: the trade scan is the slowest read on the home, and prewarming is idle
        work that must never hold the queue back. Renders nothing visible.
      */}
      <Suspense fallback={null}>
        <PrefetchTargets decisions={rankDecisions(list)} trades={trades} prefetch={prefetch} />
      </Suspense>
    </DecisionQueue>
  )
}

async function PrefetchTargets({
  decisions,
  trades,
  prefetch,
}: {
  decisions: ReturnType<typeof rankDecisions>
  trades: HomeLoads['trades']
  prefetch: { unreadNotifications: number; gameDayActive: boolean }
}) {
  const recent = await trades.catch(() => [])
  const targets = homePrefetchTargets({
    decisions,
    unreadNotifications: prefetch.unreadNotifications,
    gameDayActive: prefetch.gameDayActive,
    hasRecentTrades: Array.isArray(recent) && recent.length > 0,
  })
  return <HomePrefetch targets={targets} />
}

async function SinceLastVisitCard({ brief, now }: { brief: HomeLoads['brief']; now: Date }) {
  return <DashSinceLastVisit brief={await brief} now={now} />
}

async function GameDayCard({
  strip,
  plays,
  regularSeason,
  now,
}: Pick<HomeLoads, 'strip' | 'plays' | 'regularSeason'> & { now: Date }) {
  const [stripData, playFeed, underway] = await Promise.all([strip, plays, regularSeason])
  return <DashGameDayBand strip={stripData} plays={playFeed} now={now} regularSeasonUnderway={underway} />
}

async function DraftsCard({ drafts, now }: { drafts: HomeLoads['drafts']; now: Date }) {
  return <DashDraftsBand data={await drafts} now={now} />
}

async function TriageCard({ dash34, now }: { dash34: HomeLoads['dash34']; now: Date }) {
  const data = await dash34
  if (!data) return null
  return (
    <Dash3ATriage
      book={(data.book ?? null) as unknown as TriageBookRow[] | null}
      now={now}
      valueBasis={data.valueBasis ?? null}
      freshness={<Stamps stamps={[freshnessStamp('Injury reports', injuriesAt(data), now, { missing: 'none-yet' })]} />}
    />
  )
}

async function TradeBandCard({ trades, now }: { trades: HomeLoads['trades']; now: Date }) {
  return <DashTradeBand trades={await trades} now={now} />
}

async function CarryoverCard({ dash34 }: { dash34: HomeLoads['dash34'] }) {
  return <Dash34Carryover data={await dash34} />
}

async function UserOsCard({ userOs }: { userOs: HomeLoads['userOs'] }) {
  const { snapshot, league } = await userOs
  return <DashUserOs snapshot={snapshot} leagueId={league?.id ?? null} leagueName={league?.name ?? null} />
}

async function ScheduleCard({ schedule, syncLabel }: { schedule: HomeLoads['schedule']; syncLabel: string | null }) {
  return <DashScheduleBand board={await schedule} syncLabel={syncLabel} />
}

async function RoutineCard({ routine }: { routine: HomeLoads['routine'] }) {
  return <Dash3ARoutine routine={await routine} />
}

async function MatchupsCard({
  dash34,
  week,
  winProb,
  now,
}: Pick<HomeLoads, 'dash34' | 'week' | 'winProb'> & { now: Date }) {
  const [data, weekAll, probabilities] = await Promise.all([dash34, week, winProb])
  if (!data) return null
  return (
    <Dash3AMatchups
      leagues={data.leagues ?? []}
      week={weekAll}
      winProb={probabilities}
      weekLabel={data.weekLabel ?? null}
      freshness={<Stamps stamps={[freshnessStamp('Scores', weekAll?.scoresAt ?? null, now, { missing: 'none-yet' })]} />}
    />
  )
}

async function ChimmyCard({ dash34, issues }: Pick<HomeLoads, 'dash34' | 'issues'>) {
  const [data, list] = await Promise.all([dash34, issues])
  if (!data) return null
  return <Dash3AChimmy openCount={list.length} />
}

/*
 * The cards below are all built from what the league syncs wrote — rosters, weekly results, league
 * history — so they carry the same "League data" stamp: the newest sync among the leagues in view.
 */
type LeagueStamp = { leagueStamp: CardFreshnessStamp }

async function CareerCard({ career, leagueStamp }: { career: HomeLoads['career'] } & LeagueStamp) {
  return <Dash3ACareer career={await career} freshness={<Stamps stamps={[leagueStamp]} />} />
}

async function RivalsCard({ rivals, leagueStamp }: { rivals: HomeLoads['rivals'] } & LeagueStamp) {
  return <Dash3ARivals rivals={await rivals} freshness={<Stamps stamps={[leagueStamp]} />} />
}

async function PortfolioChartCard({ dash34, leagueStamp }: { dash34: HomeLoads['dash34'] } & LeagueStamp) {
  const data = await dash34
  if (!data) return null
  return (
    <Dash3APortfolioChart
      platformCounts={platformCountsOf(data.allLeagues ?? data.leagues ?? [])}
      freshness={<Stamps stamps={[leagueStamp]} />}
    />
  )
}

async function ExposureCard({ exposure, leagueStamp }: { exposure: HomeLoads['exposure'] } & LeagueStamp) {
  return <Dash3AExposure exposure={await exposure} freshness={<Stamps stamps={[leagueStamp]} />} />
}

async function FollowingCardSlot({ following }: { following: HomeLoads['following'] }) {
  return <Dash3AFollowing following={await following} />
}

async function ReceiptsCardSlot({ receipts }: { receipts: HomeLoads['receipts'] }) {
  return <Dash3AReceipts receipts={await receipts} />
}

async function LeaguesCard({ dash34, leagueStamp }: { dash34: HomeLoads['dash34'] } & LeagueStamp) {
  const data = await dash34
  if (!data) return null
  return (
    <Dash3ALeagues
      leagues={data.leagues ?? []}
      totalLeagues={data.totalLeagues ?? null}
      freshness={<Stamps stamps={[leagueStamp]} />}
    />
  )
}

async function CoverageCard({ dash34 }: { dash34: HomeLoads['dash34'] }) {
  return <Dash34Coverage data={await dash34} />
}

/* ── The home ─────────────────────────────────────────────────────────────────────────────── */

/** A filtered home says so above everything, with the way back to every league. */
function ScopeNote({ scope }: { scope: HomeScopeInfo }) {
  return (
    <p className="af-home-scope" role="status">
      <span>
        Showing <b>{scope.label}</b> — {scope.count} of {scope.total} {scope.total === 1 ? 'league' : 'leagues'}.
        Everything below covers only these.
      </span>
      <Link href="/core?scope=all">Show all leagues</Link>
    </p>
  )
}

export function CoreHomeCards({
  loads,
  now,
  resetKey,
  planName,
  commissionerCount,
  syncLabel,
  scope,
  leagueDataAt,
  order,
  prefetch,
}: {
  loads: HomeLoads
  now: Date
  /** The URL key the screen's error boundary uses — a card's failure clears on navigation too. */
  resetKey: string
  planName: string | null
  commissionerCount: number
  /** "synced 4m ago" when fresh; null when stale or unknown. */
  syncLabel: string | null
  scope: HomeScopeInfo
  /** The newest `lastSyncedAt` among the leagues in scope, as ISO — the "League data" stamp. */
  leagueDataAt: string | null
  /** Per-viewer card order — lib/core-app/homeCardOrder.ts. */
  order: HomeCardOrder
  /** What the prewarm needs beyond the queue itself. */
  prefetch: { unreadNotifications: number; gameDayActive: boolean }
}) {
  const card = (name: HomeCardName, content: ReactNode, placeholderHeight?: number) => (
    /*
     * `data-home-card` is what the usage counts read (HomeActivity). `display: contents` keeps the
     * wrapper out of the layout, so the grid and flex rules around each card are unchanged.
     */
    <div key={name} data-home-card={name} style={{ display: 'contents' }}>
      <CoreCardBoundary card={name} resetKey={resetKey}>
        <Suspense fallback={placeholderHeight ? <CardSkeleton height={placeholderHeight} /> : null}>{content}</Suspense>
      </CoreCardBoundary>
    </div>
  )

  const leagueStamp = freshnessStamp('League data', leagueDataAt, now, { staleRule: 'roster' })

  /*
   * ⚠ ONLY CARDS THAT ALWAYS RENDER GET A PLACEHOLDER. The bands above the dashboard and the
   * following and receipts cards render NOTHING on a quiet day — a placeholder there would paint a
   * grey block that then vanishes, which is worse than the space arriving late. The routine card
   * always renders (`buildWeeklyRoutine` never returns null), and so does the decision queue.
   *
   * ⚠ THE BANDS CAN STILL PUSH THE DASHBOARD DOWN when one with content lands after it. That is
   * the trade for not holding the whole home behind the slowest band; measure it (CLS by screen in
   * the browser traces) before reserving space for bands that are empty most days.
   *
   * WHY EACH BAND SITS WHERE IT DOES BY DEFAULT — `order.bands` is this list unless a live slate, a
   * live draft or the reader's own habits move a band up (lib/core-app/homeCardOrder.ts):
   *   since-last-visit  news, leads the bands by the user's decision (2026-09-14); nothing on a quiet day.
   *   game-day          only inside a game window; a running game outranks a countdown.
   *   drafts            any league's draft live right now; capped at 4 with a Draft HQ link.
   *   triage            an injured STARTER — the founder's ask. Value-aware, so a first-round back
   *                     outranks a bench stash. Renders nothing when no lineup decision is pending.
   *   trade-band        a trade landing is news the moment it lands; a fact, not a deadline.
   *   carryover         34a's first-lock band, honesty notice, Chimmy brief (see Dash34Carryover).
   *   user-os           the Decision OS card for the most urgent league; nothing on any gap.
   *   schedule          WHO you play, above the section that can only show scores — before a week
   *                     is scored the matchup grid is empty on purpose.
   */
  const bands: Record<HomeCardOrder['bands'][number], ReactNode> = {
    'since-last-visit': card('since-last-visit', <SinceLastVisitCard brief={loads.brief} now={now} />),
    'game-day': card(
      'game-day',
      <GameDayCard strip={loads.strip} plays={loads.plays} regularSeason={loads.regularSeason} now={now} />,
    ),
    drafts: card('drafts', <DraftsCard drafts={loads.drafts} now={now} />),
    triage: card('triage', <TriageCard dash34={loads.dash34} now={now} />),
    'trade-band': card('trade-band', <TradeBandCard trades={loads.trades} now={now} />),
    carryover: card('carryover', <CarryoverCard dash34={loads.dash34} />),
    'user-os': card('user-os', <UserOsCard userOs={loads.userOs} />),
    schedule: card('schedule', <ScheduleCard schedule={loads.schedule} syncLabel={syncLabel} />),
  }

  return (
    <HomeActivity>
      {scope.scoped ? <ScopeNote scope={scope} /> : null}

      {scope.scoped && scope.count === 0 ? (
        /*
         * A scope that matches nothing — a sport or platform you no longer play, favorites on a new
         * device. Said plainly, rather than rendering a home of cards that each claim "nothing here"
         * about leagues that were simply filtered out.
         */
        <div className="af-frame af-home-scope-empty">
          <h2>No leagues in this view</h2>
          <p>
            None of your leagues match &ldquo;{scope.label}&rdquo;
            {scope.key === 'fav' ? ' — star a league in the league picker at the top to add it here' : ''}.{' '}
            <Link href="/core?scope=all">Show all leagues</Link>
          </p>
        </div>
      ) : (
        <>
          {/*
            The five most urgent decisions lead the home — the user's instruction (2026-09-16),
            ahead of the news bands, because a decision is what the reader can act on. It replaced
            the "Outstanding issues" section inside the dashboard below; see DecisionQueue.
          */}
          {card(
            'issues',
            <DecisionsCard
              dash34={loads.dash34}
              issues={loads.issues}
              trades={loads.trades}
              now={now}
              scope={scope}
              rostersStamp={leagueStamp}
              prefetch={prefetch}
            />,
            220,
          )}

          {order.bands.map((name) => bands[name])}

          {/*
            3a mounted as the screen BODY. It ships its own rail/nav/topbar
            for the standalone render it was built for; af-core-shell.css
            suppresses that chrome under .af-content so the shell's own
            rail, nav and topbar stand alone. Its cards arrive through slots.
          */}
          <Dashboard3A
            planName={planName}
            commissionerCount={commissionerCount}
            nowLabel={syncLabel}
            order={{ main: order.main, side: order.side, stack: order.stack }}
            slots={{
              routine: card('routine', <RoutineCard routine={loads.routine} />, 150),
              // Rendered at the top of the home instead — `order.main` leaves it out.
              issues: null,
              matchups: card(
                'matchups',
                <MatchupsCard dash34={loads.dash34} week={loads.week} winProb={loads.winProb} now={now} />,
                160,
              ),
              chimmy: card('chimmy', <ChimmyCard dash34={loads.dash34} issues={loads.issues} />, 140),
              career: card('career', <CareerCard career={loads.career} leagueStamp={leagueStamp} />, 150),
              rivals: card('rivals', <RivalsCard rivals={loads.rivals} leagueStamp={leagueStamp} />, 150),
              portfolioChart: card(
                'portfolio-chart',
                <PortfolioChartCard dash34={loads.dash34} leagueStamp={leagueStamp} />,
                200,
              ),
              exposure: card('exposure', <ExposureCard exposure={loads.exposure} leagueStamp={leagueStamp} />, 180),
              following: card('following', <FollowingCardSlot following={loads.following} />),
              receipts: card('receipts', <ReceiptsCardSlot receipts={loads.receipts} />),
              leagues: card('leagues', <LeaguesCard dash34={loads.dash34} leagueStamp={leagueStamp} />, 180),
            }}
          />
          {/*
            The coverage disclosure, at the foot where a footnote belongs.
            It used to sit third on the page: leading with everything we
            cannot see sets the tone to apology before the reader has seen
            anything the product does know.
          */}
          {card('coverage', <CoverageCard dash34={loads.dash34} />)}
        </>
      )}
    </HomeActivity>
  )
}
