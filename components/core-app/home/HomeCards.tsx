import { Suspense, type ComponentProps, type ReactNode } from 'react'
import CoreCardBoundary from '@/components/core-app/CoreCardBoundary'
import Dashboard3A, {
  Dash3ACareer,
  Dash3AChimmy,
  Dash3AExposure,
  Dash3AFollowing,
  Dash3AIssues,
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
 * renders NOTHING without it, and the issues card — the first of them — shows that same panel.
 * Cards with their own reads (career, rivals, exposure, the bands) still render: they were never
 * about `dash34`, and a failed summary is no reason to hide a correct career record.
 */

export type HomeLoads = {
  /** The loader's own result — it carries `weekLabel` and `valueBasis` beyond the screens' `Dash34Data`. */
  dash34: Promise<Dash34Result | null>
  issues: Promise<ComponentProps<typeof Dash3AIssues>['issues']>
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

/* ── The cards. Each awaits only what it shows. ───────────────────────────────────────────── */

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

async function IssuesCard({ dash34, issues }: Pick<HomeLoads, 'dash34' | 'issues'>) {
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
  return <Dash3AIssues issues={list} />
}

async function MatchupsCard({ dash34, week, winProb }: Pick<HomeLoads, 'dash34' | 'week' | 'winProb'>) {
  const [data, weekAll, probabilities] = await Promise.all([dash34, week, winProb])
  if (!data) return null
  return <Dash3AMatchups leagues={data.leagues ?? []} week={weekAll} winProb={probabilities} weekLabel={data.weekLabel ?? null} />
}

async function ChimmyCard({ dash34, issues }: Pick<HomeLoads, 'dash34' | 'issues'>) {
  const [data, list] = await Promise.all([dash34, issues])
  if (!data) return null
  return <Dash3AChimmy openCount={list.length} />
}

async function CareerCard({ career }: { career: HomeLoads['career'] }) {
  return <Dash3ACareer career={await career} />
}

async function RivalsCard({ rivals }: { rivals: HomeLoads['rivals'] }) {
  return <Dash3ARivals rivals={await rivals} />
}

async function PortfolioChartCard({ dash34 }: { dash34: HomeLoads['dash34'] }) {
  const data = await dash34
  if (!data) return null
  return <Dash3APortfolioChart platformCounts={platformCountsOf(data.allLeagues ?? data.leagues ?? [])} />
}

async function ExposureCard({ exposure }: { exposure: HomeLoads['exposure'] }) {
  return <Dash3AExposure exposure={await exposure} />
}

async function FollowingCardSlot({ following }: { following: HomeLoads['following'] }) {
  return <Dash3AFollowing following={await following} />
}

async function ReceiptsCardSlot({ receipts }: { receipts: HomeLoads['receipts'] }) {
  return <Dash3AReceipts receipts={await receipts} />
}

async function LeaguesCard({ dash34 }: { dash34: HomeLoads['dash34'] }) {
  const data = await dash34
  if (!data) return null
  return <Dash3ALeagues leagues={data.leagues ?? []} totalLeagues={data.totalLeagues ?? null} />
}

async function CoverageCard({ dash34 }: { dash34: HomeLoads['dash34'] }) {
  return <Dash34Coverage data={await dash34} />
}

/* ── The home ─────────────────────────────────────────────────────────────────────────────── */

export function CoreHomeCards({
  loads,
  now,
  resetKey,
  planName,
  commissionerCount,
  syncLabel,
}: {
  loads: HomeLoads
  now: Date
  /** The URL key the screen's error boundary uses — a card's failure clears on navigation too. */
  resetKey: string
  planName: string | null
  commissionerCount: number
  /** "synced 4m ago" when fresh; null when stale or unknown. */
  syncLabel: string | null
}) {
  const card = (name: HomeCardName, content: ReactNode, placeholderHeight?: number) => (
    <CoreCardBoundary card={name} resetKey={resetKey}>
      <Suspense fallback={placeholderHeight ? <CardSkeleton height={placeholderHeight} /> : null}>{content}</Suspense>
    </CoreCardBoundary>
  )

  /*
   * ⚠ ONLY CARDS THAT ALWAYS RENDER GET A PLACEHOLDER. The bands above the dashboard and the
   * following and receipts cards render NOTHING on a quiet day — a placeholder there would paint a
   * grey block that then vanishes, which is worse than the space arriving late. The routine card
   * always renders (`buildWeeklyRoutine` never returns null), and it sits above the issues, so it
   * holds its place like the rest.
   *
   * ⚠ THE BANDS CAN STILL PUSH THE DASHBOARD DOWN when one with content lands after it. That is
   * the trade for not holding the whole home behind the slowest band; measure it (CLS by screen in
   * the browser traces) before reserving space for bands that are empty most days.
   */
  return (
    <>
      {/*
        What changed since your last visit — leads the home, by the user's
        decision (2026-09-14). It renders NOTHING when nothing changed, so a
        quiet day costs no space above the live and draft bands; on a day
        with news it is the first thing read, and each line links to the
        band or screen that holds the detail.
      */}
      {card('since-last-visit', <SinceLastVisitCard brief={loads.brief} now={now} />)}
      {/*
        Game day leads everything while a slate is live — a running game
        outranks a draft clock and a countdown. It renders only inside a
        game window (a play detected in the last few hours, or a scored
        matchup of the user's), so outside one this is not a quiet band,
        it is no band at all.
      */}
      {card('game-day', <GameDayCard strip={loads.strip} plays={loads.plays} regularSeason={loads.regularSeason} now={now} />)}
      {/*
        Drafts on the clock — leads the home whenever any league's draft
        is live right now (the founder's week). One card per live draft,
        capped at 4 with a Draft HQ overflow link. Zero live drafts, or a
        loader failure, renders NOTHING — see DashDraftsBand's header for
        the honesty rules (raw status shown, no invented timers).
      */}
      {card('drafts', <DraftsCard drafts={loads.drafts} now={now} />)}
      {/*
        Starters in doubt — the DECISION slice of the injury book.
        ⚠ ITS POSITION HAS MOVED TWICE, AND BOTH MOVES WERE RIGHT. It
        first led the page as the loader's whole 40-row book, which read
        as a wall of headshots with no decision attached, so it was
        filtered to starters-who-may-not-play and demoted. Now that the
        ordering is value-aware — a first-round back outranks a bench
        stash instead of losing to it alphabetically — the founder's
        actual ask stands: an injured starter should be the first thing
        he sees. It ranks above the trade band and the brief and below
        only a live slate and a draft on the clock, both of which are
        happening RIGHT NOW rather than needing a decision. On a day with
        no lineup decision it still renders nothing at all, which is what
        makes it safe to place this high.
      */}
      {card('triage', <TriageCard dash34={loads.dash34} now={now} />)}
      {/*
        A trade landing is news the moment it lands, and it was the one
        thing the founder named that no surface showed at all. Below the
        live/draft bands because it is not a deadline; above the brief
        because it is a fact about his leagues, not a summary of them.
      */}
      {card('trade-band', <TradeBandCard trades={loads.trades} now={now} />)}
      {/*
        34a's four unique sections (first-lock band, honesty notice,
        Chimmy brief, coverage list) — carried over so the cutover
        loses nothing 3A doesn't render. See Dash34Carryover's header
        for what was deliberately NOT carried and why.
      */}
      {card('carryover', <CarryoverCard dash34={loads.dash34} />)}
      {/*
        P4-5: the first /core surface that reads Decision OS at all — the
        deterministic user-os card for the most urgent league. Renders
        NOTHING on any failure or coverage gap; see DashUserOs's header
        for the render-nothing rules.
      */}
      {card('user-os', <UserOsCard userOs={loads.userOs} />)}
      {/*
        WHO you play this week, immediately above the section that can
        only show scores. Until a week is scored — every week before
        kickoff, and all of preseason — Dashboard3A's matchup grid is an
        empty frame, because both of its sources drop unscored rows on
        purpose. This band answers the half of the question that IS
        knowable: opponent, league, first kickoff. It renders nothing
        when the read fails or no league has a schedule on file.
      */}
      {card('schedule', <ScheduleCard schedule={loads.schedule} syncLabel={syncLabel} />)}
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
        slots={{
          routine: card('routine', <RoutineCard routine={loads.routine} />, 150),
          issues: card('issues', <IssuesCard dash34={loads.dash34} issues={loads.issues} />, 180),
          matchups: card('matchups', <MatchupsCard dash34={loads.dash34} week={loads.week} winProb={loads.winProb} />, 160),
          chimmy: card('chimmy', <ChimmyCard dash34={loads.dash34} issues={loads.issues} />, 140),
          career: card('career', <CareerCard career={loads.career} />, 150),
          rivals: card('rivals', <RivalsCard rivals={loads.rivals} />, 150),
          portfolioChart: card('portfolio-chart', <PortfolioChartCard dash34={loads.dash34} />, 200),
          exposure: card('exposure', <ExposureCard exposure={loads.exposure} />, 180),
          following: card('following', <FollowingCardSlot following={loads.following} />),
          receipts: card('receipts', <ReceiptsCardSlot receipts={loads.receipts} />),
          leagues: card('leagues', <LeaguesCard dash34={loads.dash34} />, 180),
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
  )
}
