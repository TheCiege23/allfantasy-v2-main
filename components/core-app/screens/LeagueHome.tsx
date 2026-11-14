'use client'

import { MemberStatusCard } from '@/components/league-home/MemberStatusCard'
import Link from 'next/link'
import { LeagueDisplayPreferences, LeagueSection, CustomizeLeagueLink } from '@/components/league/LeagueDisplayPreferences'
import type { LeagueSectionId } from '@/lib/league/leagueSections'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
/*
 * ⚠ af-core.css FIRST, AND IT IS LOAD BEARING. This screen used to render only
 * inside AfCoreShell, which imports the token layer for everything under it. It
 * now also renders at /dashboard?league=, OUTSIDE that shell — where every
 * var(--surface) / var(--line) / var(--accent) below would resolve to nothing:
 * cards paint transparent with 0px borders and no error is thrown. Exactly the
 * failure the landing page shipped with before the same import fixed it.
 */
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-league-home.css'
import type { LeagueHomeData, SectionState } from '@/lib/core-app/leagueHome'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'
import { LeagueScoreboardPanel } from '@/components/core-app/screens/LeagueScoreboardPanel'
import { SUPPORT_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'

import { ConnectedRoster } from './ConnectedRoster'
import { RedraftHomeDeck } from './RedraftHomeDeck'
import { DynastyHomeDeck } from './DynastyHomeDeck'
import { PredictionLeaderboard } from '@/components/core-app/PredictionLeaderboard'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { platformLabel as platformName } from '@/lib/core-app/platformLinks'
import { ImportedLeagueQuickActions } from '@/components/league/ImportedLeagueQuickActions'
import { rosterLabel } from '@/lib/core-app/managerName'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { rivalLastText } from '@/lib/core-app/dashboard3aCopy'
import { rosterIdsMatch } from '@/lib/core-app/rosterIdMatch'
import { useTradeDeadlineCountdownText } from '@/components/core-app/TradeDeadlineCountdown'
import { buildHomeKpis } from '@/lib/core-app/homeKpis'
import type { TradeDeadlineCountdown } from '@/lib/trade-deadline/tradeDeadlineCountdown'
import { PROJECTION_PROVIDER_LABEL } from '@/lib/core-app/projectionProvider'
import type { StandingsLineups } from '@/lib/core-app/standingsLineups'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import { useMessages } from '@/components/i18n/useMessages'
import { leagueHomeMessages } from '@/lib/core-app/messages/leagueHome'
import { leagueOverviewGuideMessages } from '@/lib/core-app/messages/leagueOverviewGuide'
import {
  isEliminationLeague, overviewHeadline, overviewWeekLine, standingsRowsToShow, type OverviewHeadline,
} from '@/lib/core-app/leagueOverviewGuide'
import type { RailMatchup } from '@/lib/core-app/railMatchups'
import '@/components/core-app/af-league-overview-guide.css'

/**
 * "Your season at a glance": record and rank, points for, FAAB left, trade deadline (the redesign's KPI
 * row). Every tile is built from what the loader already read (lib/core-app/homeKpis.ts) and is absent
 * when its data is — the row itself is absent when every tile is. The deadline tile ticks with the same
 * countdown the Trade Center shows.
 */
function HomeKpiRow({
  data,
  tradeDeadline,
  elimination = false,
}: {
  data: LeagueHomeData
  tradeDeadline: TradeDeadlineCountdown | null
  /**
   * Leave the record tile out: an elimination league has no matchups (a W-L record and a rank counting chopped
   * teams is noise there), and a head-to-head headline already says the record and the place.
   */
  elimination?: boolean
}) {
  const m = useMessages(leagueHomeMessages)
  const built = buildHomeKpis(data)
  const kpis = elimination ? { ...built, record: null } : built
  const deadlineText = useTradeDeadlineCountdownText(tradeDeadline)
  const deadline = tradeDeadline && tradeDeadline.state !== 'none' && deadlineText ? tradeDeadline : null
  if (!kpis.record && !kpis.pointsFor && !kpis.faab && !deadline) return null
  const deadlineWeek = deadline && 'deadlineWeek' in deadline ? deadline.deadlineWeek : null
  return (
    <section className="af-lh-kpis" aria-label={m.kpisLabel} data-testid="league-home-kpis">
      {kpis.record ? (
        <div className="af-card af-lh-kpi" data-kpi="record">
          <span className="af-label">{m.kpiRecord}</span>
          <strong className="af-num af-lh-kpi-value">{kpis.record.record}</strong>
          {kpis.record.rank != null ? (
            <span className="af-lh-kpi-sub">{m.kpiRankOf(kpis.record.rank, kpis.record.teams)}</span>
          ) : null}
        </div>
      ) : null}
      {kpis.pointsFor ? (
        <div className="af-card af-lh-kpi" data-kpi="points-for">
          <span className="af-label">{m.kpiPointsFor}</span>
          <strong className="af-num af-lh-kpi-value">{kpis.pointsFor.points.toFixed(1)}</strong>
          {kpis.pointsFor.vsAverage != null ? (
            <span className="af-lh-kpi-sub" data-trend={kpis.pointsFor.vsAverage >= 0 ? 'up' : 'down'}>
              {m.kpiVsAverage(kpis.pointsFor.vsAverage)}
            </span>
          ) : kpis.pointsFor.rank != null ? (
            <span className="af-lh-kpi-sub">{m.kpiRankOf(kpis.pointsFor.rank, kpis.pointsFor.teams)}</span>
          ) : null}
        </div>
      ) : null}
      {kpis.faab ? (
        <div className="af-card af-lh-kpi" data-kpi="faab">
          <span className="af-label">{m.kpiFaab}</span>
          <strong className="af-num af-lh-kpi-value">${kpis.faab.remaining}</strong>
          <span className="af-lh-kpi-sub">{m.kpiFaabNote}</span>
        </div>
      ) : null}
      {deadline ? (
        <Link
          href={`/core/trades?league=${encodeURIComponent(data.league.id)}`}
          className="af-card af-lh-kpi af-lh-kpi--link"
          data-kpi="trade-deadline"
          data-deadline-state={deadline.state}
        >
          <span className="af-label">{m.kpiDeadline}</span>
          <strong className="af-num af-lh-kpi-value">
            {deadlineWeek != null ? m.kpiDeadlineWeek(deadlineWeek) : deadlineText}
          </strong>
          {/* "Week 12" above, "2 weeks left" here — not "Trade deadline after Week 12 · 2 weeks left" again (2026-11-14). */}
          {deadlineWeek != null ? (
            <span className="af-lh-kpi-sub" role="status" data-testid="league-home-deadline-sub">
              {deadline.state === 'weeks' ? m.kpiWeeksLeft(deadline.weeksLeft) : deadlineText}
            </span>
          ) : null}
        </Link>
      ) : null}
    </section>
  )
}

/**
 * Jump to another week.
 *
 * Writes `?week=` and lets the server re-read — no client fetch and no new API
 * route, which matters because the repo sits at the platform's route ceiling
 * and a week selector is not worth a route. It also makes the view shareable.
 *
 * Every other query param is preserved: this screen is reached with `?league=`
 * already set, and dropping it would bounce the viewer back to the league list
 * the moment they changed week.
 */
function WeekPicker({
  picker,
}: {
  picker: { weeks: number[]; selected: number; current: number | null; isFuture: boolean }
}) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  return (
    <label className="af-weekpick">
      <span className="af-weekpick-label">{copy('Week')}</span>
      <select
        className="af-weekpick-select"
        value={picker.selected}
        onChange={(e) => {
          const next = new URLSearchParams(params?.toString() ?? '')
          next.set('week', e.target.value)
          router.push(`${pathname}?${next.toString()}`, { scroll: false })
        }}
      >
        {picker.weeks.map((w) => (
          <option key={w} value={w}>
            {/* The league's own position is marked, so "now" is findable in a
                list of eighteen identical numbers. */}
            {w === picker.current ? `${w} · ${copy('now')}` : w}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * Screen 3b — Dashboard, one league selected.
 *
 * The rule the handoff opens with: season timeline, Draft HQ and Commissioner
 * Hub exist ONLY here. There is no single season calendar across 60 leagues,
 * which is why 3a carries none of them.
 *
 * ── LAYOUT ───────────────────────────────────────────────────────────────────
 * Rebuilt to the 3b screenshot: identity header, full-width season timeline,
 * then `1fr | 372px` — matchup strip, the one urgent action, Draft HQ /
 * Commissioner Hub two-up and standings on the left; Ask Chimmy, league buzz and
 * rivalry radar on the right. Under 1080px it collapses to one column and the
 * timeline scrolls horizontally with the current stage pinned in view, which is
 * the mobile frame's own behaviour.
 *
 * ⚠ TWO OF THE FOUR "MISSING" PANELS WERE NOT MISSING. Corrected after audit:
 *
 *   - MATCHUP + WIN PROBABILITY. ✅ REAL NOW. The claim that no writer produces
 *     per-week scoring was false — `lib/core-app/matchup.ts` already resolved
 *     WeeklyMatchup rows and priced both lineups against fantasy_projections for
 *     the Matchup screen. `leagueHome` now reuses that resolver. The probability
 *     renders only when the engine produced one; a matchup that could not be
 *     priced shows scores and no percentage.
 *   - RIVALRY RADAR. ✅ REAL NOW. `WeeklyMatchup.matchupId` pairs the two rosters
 *     in a week, so every past meeting is stored. Only "usually online" is
 *     genuinely absent, and that line is dropped rather than guessed.
 *   - COMMISSIONER HUB. Votes and commissioner tasks are not ingested.
 *   - LEAGUE BUZZ. League transactions are not ingested for these platforms.
 *   - RIVALRY RADAR. No head-to-head history, and nothing anywhere records when
 *     a manager is usually online.
 *
 * Each renders its frame with the reason inside rather than being dropped, so
 * the screen matches the design AND is honest about which panels are waiting on
 * an engine. A greyed-out "71%" still reads as a win probability.
 */

export type LeagueHomeProps = {
  hiddenSections?: LeagueSectionId[]
  data: LeagueHomeData
  /** The enforced trade deadline as a countdown ("Trade deadline in 3d 4h" / "Trades closed"). */
  tradeDeadline?: TradeDeadlineCountdown | null
  /** How many outstanding issues exist in OTHER leagues. */
  otherLeagueIssueCount: number
  /**
   * This league's own issues, already sorted by severity then deadline.
   *
   * ⚠ THE HANDOFF SORTS THESE BY POINT DELTA ("the higher point delta wins").
   * We do not compute a point delta for any issue — `CoreIssue` carries a
   * deadline and a severity and no projection — so the existing sort stands in,
   * which ranks a lineup that locks in an hour above one that locks tomorrow.
   * That is a different rule and it is the honest one available.
   */
  issues?: CoreIssue[]
  /**
   * The /core shell's league header is already on screen above this one.
   *
   * 🛑 THEN THIS SCREEN MUST NOT NAME THE LEAGUE A SECOND TIME. Inside the shell
   * `CoreLeagueContextBar` carries the crest, name, platform and sync age, so this
   * header printing the same name, platform and sync label directly below it put
   * each on the Overview twice. The line that stays — format, season, your record
   * — is what the bar does not show.
   *
   * ⚠ THE `<h1>` STAYS, VISUALLY HIDDEN. The bar names the league in a `<strong>`,
   * not a heading, because screens own the page heading; dropping this one would
   * leave the Overview with none.
   *
   * Off by default: at /dashboard?league= this screen renders outside the shell,
   * and there this header is the only thing naming the league.
   */
  identityInShell?: boolean
  /**
   * This week's lineups, projected — AllFantasy's engine (AF) beside the provider's (API) —
   * drawn as two columns on the Power board. DISPLAY ONLY: the power rank is all-play, computed
   * from scored weeks, and nothing here feeds it. Null draws the board as before.
   */
  lineups?: StandingsLineups | null
  /**
   * Replaces the one-sentence import banner with the fuller per-kind panel.
   *
   * A slot, so the panel's counts can stream in behind their own Suspense boundary
   * without holding back the rest of this screen. When given, the banner is not
   * rendered: every fact in the sentence is also a row in the panel, with the
   * platform named the same way, and saying it twice is noise.
   */
  coverageSlot?: React.ReactNode
  /**
   * The rail's row for THIS league (lib/core-app/railMatchups.ts) — the same standing the left rail draws.
   * The guide's headline reads it so an elimination league says "6th of 7 alive · 12.4 over the cut" on
   * both surfaces, never "0-0 · 2nd of 18" on one of them. Null keeps the head-to-head headline.
   */
  rail?: RailMatchup | null
}

function Unavailable({ reason }: { reason: string }) {
  return (
    <div className="af-unavailable">
      <span className="af-unavailable-mark" aria-hidden>
        —
      </span>
      <span className="af-unavailable-text">{reason}</span>
    </div>
  )
}

/** Two letters for a team with no crest. Never blank, never a broken image. */
function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '—'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** A titled panel. `tone` drives the 3b border colour on Commissioner Hub. */
/**
 * The other half of this league's franchise, or an offer to name it.
 *
 * 🛑 "THE 2 LEAGUES NEED TO FEEL LIKE ITS ONE AND BE SHOWN ON 1 SCREEN." This is
 * that band: on the NFL league it names the C2C half, on the C2C league it names
 * the NFL half, and it sits directly under the header on both so neither reads
 * as the primary and the other as an afterthought.
 *
 * ⚠ NOT PAIRED AND CANNOT PAIR ARE DIFFERENT, AND RENDER DIFFERENTLY. An
 * unpaired league gets the offer; a paired one gets its other half. Showing the
 * offer to someone already paired is nagging, and hiding it from everyone else
 * is how a built feature stays invisible — which is exactly what happened here:
 * the franchise API has existed all along with nothing in the app calling it.
 */
function PairedBand({
  pairing,
  leagueId,
  leagueName,
}: {
  pairing: LeagueHomeData['pairing']
  leagueId: string
  leagueName: string
}) {
  const { language } = useOptionalLanguage()
  const m = useMessages(leagueHomeMessages)
  const copy = (english: string) => coreUiCopy(english, language)
  const connectHref = `/core/connect-leagues?league=${encodeURIComponent(leagueId)}`

  if (!pairing) {
    return (
      <section className="af-card af-lh-paired af-lh-paired--offer">
        <div className="af-lh-paired-body">
          <h2 className="af-lh-paired-title">{m.pairedOfferTitle(leagueName)}</h2>
          <p className="af-lh-paired-text">
            {copy('Connect a related league to see both rosters in one shared hub, with each league’s rules, scoring and lineup close at hand.')}
          </p>
        </div>
        <Link href={connectHref} className="af-btn af-lh-paired-cta">
          {copy('Connect a league')} →
        </Link>
      </section>
    )
  }

  const { self, other, viewingRole, franchiseName } = pairing

  /*
   * ⚠ A FRANCHISE WITH ONE HALF IS A REAL STATE AND SAYS SO. `pair-leagues`
   * attaches both or neither, but a franchise can also be left half-built by the
   * older `connect-league` action, which only ever attached a college side.
   * Rendering that as a combined view would show one league labelled as two.
   */
  if (!other) {
    return (
      <section className="af-card af-lh-paired af-lh-paired--offer">
        <div className="af-lh-paired-body">
          <h2 className="af-lh-paired-title">{m.pairedHalfTitle(franchiseName)}</h2>
          <p className="af-lh-paired-text">
            {m.pairedHalfText(viewingRole)}
          </p>
        </div>
        <Link href={connectHref} className="af-btn af-lh-paired-cta">
          {copy('Add the other half')} →
        </Link>
      </section>
    )
  }

  /*
   * 🛑 THE LEAGUE YOU ARE ON COMES FIRST. On the pro league the pro side leads
   * and the college side sits under it; on the college league the order flips.
   * Neither half is "the" league and the other an afterthought — that is the
   * whole point of calling them one franchise. `self` may be null only if the
   * membership row vanished between reads, in which case we show what we have
   * rather than nothing.
   */
  const sides = pairing.sides.length > 0
    ? pairing.sides
    : [self, other].filter((sd): sd is NonNullable<typeof sd> => sd != null)
  const totalPlayers = sides.reduce((n, sd) => n + (sd.playerCount ?? 0), 0)
  const anyUnavailable = sides.some((sd) => sd.unavailableReason != null)

  return (
    <section className="af-card af-lh-paired">
      <div className="af-lh-paired-head">
        <span className="af-label af-lh-paired-kicker">{franchiseName}</span>
        {/*
          ⚠ THE COMBINED COUNT IS SUPPRESSED WHEN EITHER HALF IS UNREADABLE.
          Adding up one real roster and one we could not read reports a franchise
          smaller than it is, and looks like a fact rather than a gap.
        */}
        {!anyUnavailable ? (
          <span className="af-lh-paired-role">{m.pairedTotalPlayers(totalPlayers)}</span>
        ) : null}
      </div>
      <div className="af-lh-paired-sides">
        {sides.map((sd, i) => (
          <div
            key={`${sd.platform}:${sd.leagueId ?? sd.name}`}
            className="af-lh-paired-side"
            /* The first row is the league being viewed — styled as current. */
            data-current={i === 0 ? 'true' : 'false'}
          >
            <span className="af-label af-lh-paired-sidelabel">
              {sd.sport?.toUpperCase() || (sd.role === 'pro' ? 'Pro' : copy('College'))} {copy('league')}
              {i === 0 ? ` · ${copy('you are here')}` : ''}
            </span>
            {/*
              The crest, so the two halves read as two teams rather than two
              paragraphs. Both halves get one; only the source differs.

              ⚠ INITIALS ARE NOT A PLACEHOLDER FOR A LOGO WE FAILED TO FETCH.
              The Fantrax half can never have one — the platform publishes no
              image field anywhere in its API — so this is the finished state
              for that side, and the same fallback a Sleeper manager who never
              set an avatar already gets across the app. `alt=""` because the
              team name is rendered as text directly beneath it.
            */}
            {sd.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="af-lh-paired-crest af-lh-paired-crest--img"
                src={sd.avatarUrl}
                alt=""
                width={36}
                height={36}
                loading="lazy"
              />
            ) : (
              <span className="af-lh-paired-crest" aria-hidden>
                {initialsOf(sd.teamLabel || sd.name)}
              </span>
            )}
            <h3 className="af-lh-paired-title">
              {sd.leagueId && i !== 0 ? (
                <Link
                  href={`/core?league=${encodeURIComponent(sd.leagueId)}`}
                  className="af-lh-paired-link"
                >
                  {sd.name}
                </Link>
              ) : (
                sd.name
              )}
            </h3>
            <p className="af-lh-paired-meta">
              <span className="af-platform af-platform-chip af-lh-paired-platform" data-platform={sd.platform}>
                {sd.platform}
              </span>
              {sd.season != null ? <span> · {sd.season}</span> : null}
              {sd.teamLabel ? <span> · {sd.teamLabel}</span> : null}
            </p>
            {/*
              ⚠ A COUNT AND A REASON ARE MUTUALLY EXCLUSIVE. `playerCount` is null
              exactly when the roster could not be read, and printing "0 players"
              there would report an empty squad for a team we simply could not see.
            */}
            {sd.unavailableReason ? (
              <p className="af-lh-paired-text">_ {sd.unavailableReason}</p>
            ) : (
              <p className="af-lh-paired-text">
                {m.pairedRosterCount(sd.playerCount)}
              </p>
            )}
            {/*
              ⚠ ABSENT IS NOT "NEVER DRAFTED". A half with no draft row — the
              ordinary case for a Fantrax snapshot, which imports no draft at all
              — renders nothing here rather than claiming the league has not
              drafted. The league home makes the same distinction one panel down.
            */}
            {/*
              ⚠ A PLATFORM THAT CANNOT REPORT TRADES IS NOT A QUIET LEAGUE.
              Fantrax publishes no transactions endpoint, so its half reports the
              REASON rather than "0 trades" — which would read as a statement
              about the manager instead of about our data. Measured: this
              franchise's Sleeper half has 181 activity rows, its Fantrax half 0.
            */}
            {sd.activity ? (
              sd.activity.available ? (
                <p className="af-lh-paired-activity">
                  {sd.activity.trades} {copy(sd.activity.trades === 1 ? 'trade' : 'trades')} ·{' '}
                  {sd.activity.waivers} {copy(sd.activity.waivers === 1 ? 'waiver' : 'waivers')}
                  {sd.activity.rosterMoves > 0 ? <span> · {sd.activity.rosterMoves} {copy('moves')}</span> : null}
                </p>
              ) : (
                <p className="af-lh-paired-activity" data-unavailable="true">
                  _ {sd.activity.reason}
                </p>
              )
            ) : null}
            {sd.draft ? (
              <p className="af-lh-paired-draft" data-phase={sd.draft.phase}>
                <span className="af-lh-paired-draft-head">{sd.draft.headline}</span>
                {sd.draft.detail ? <span> · {sd.draft.detail}</span> : null}
                {sd.draft.href ? (
                  <>
                    {' '}
                    <Link href={sd.draft.href} className="af-lh-paired-link">
                      {sd.draft.phase === 'live'
                        ? `${copy('Go to the draft room')} →`
                        : sd.draft.phase === 'done'
                          ? `${copy('Open the board')} →`
                          : `${copy('Open Draft HQ')} →`}
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <ConnectedRoster sides={sides} />
    </section>
  )
}

function Panel({
  title,
  help,
  tone,
  className,
  children,
}: {
  title: string
  help?: React.ReactNode
  tone?: 'warn'
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      className={`af-card af-lh-panel${className ? ` ${className}` : ''}`}
      data-tone={tone}
    >
      <header className="af-lh-panel-head">
        <h2 className="af-label af-lh-panel-title">{title}</h2>
        {help ? <span className="af-lh-panel-help">{help}</span> : null}
      </header>
      {children}
    </section>
  )
}

function StatePanel<T>({
  title,
  help,
  tone,
  className,
  state,
  children,
  unavailableFooter,
}: {
  title: string
  help?: React.ReactNode
  tone?: 'warn'
  className?: string
  state: SectionState<T> | { available: false; reason: string }
  children: (data: T) => React.ReactNode
  /** Rendered under the reason when the section is unavailable — a way onward, not a substitute figure. */
  unavailableFooter?: React.ReactNode
}) {
  return (
    <Panel title={title} help={help} tone={tone} className={className}>
      {state.available ? (
        children((state as { available: true; data: T }).data)
      ) : (
        <>
          <Unavailable reason={state.reason} />
          {unavailableFooter}
        </>
      )}
    </Panel>
  )
}

export function LeagueHome({
  data,
  otherLeagueIssueCount,
  issues = [],
  identityInShell = false,
  hiddenSections = [],
  coverageSlot,
  lineups = null,
  tradeDeadline = null,
  rail = null,
}: LeagueHomeProps) {
  const { language } = useOptionalLanguage()
  const m = useMessages(leagueHomeMessages)
  const copy = (english: string) => coreUiCopy(english, language)
  const { league } = data
  const teamDirectory = data.teamDirectory ?? []
  const rosteredPlayerCount = data.rosteredPlayerCount ?? 0
  const platformLabel = league.platform === 'manual' ? copy('your platform') : platformName(league.platform)

  /*
   * "Needs your attention": the top THREE issues, most urgent first (the redesign
   * supersedes the old one-card rule). Three, not all — the rest stay reachable
   * from the nav counts, so nothing is hidden, it just does not crowd the row.
   * They are said once, there: the week summary's Lineup cell used to lead with the first one too.
   */
  const attention = issues.slice(0, 3)
  const kpis = buildHomeKpis(data)
  /*
   * ON A REDRAFT HOME INSIDE THE SHELL, PAGE TOOLS GO TO THE FOOT. There the header holds nothing
   * but "Customize page" and "Back to home" (the shell already names the league and has a Home
   * tab), and the imported-league bar sits under the KPIs — so on a phone two rows of buttons and a
   * support card stood between the manager and their week. Same controls, same behaviour, moved
   * below the league's content. Every other format keeps its layout.
   */
  /*
   * 2026-11-13 guide: EVERY format inside the shell puts the page tools at the foot, not only redraft. The
   * top of the Overview carried "Imported from Sleeper · Remove from my leagues (red) · Contact support"
   * above anything about the league; the guide's answer goes there now.
   */
  const toolsAtFoot = identityInShell
  const headActions = (
    <>
      <CustomizeLeagueLink returnTo={`/core?league=${encodeURIComponent(league.id)}`} className="af-btn af-btn--ghost" />
      {/*
        The READ-ONLY chip is on every signed-in screen per the shared
        contract. At /dashboard?league= this screen renders outside
        AfCoreShell, so nothing else on the page carries it.
      */}
      {identityInShell ? null : (
        <>
          <span className="af-readonly">{copy('Read-only')}</span>
          <span className="af-sync af-num" data-stale={data.syncAge.stale}>
            {data.syncAge.stale ? '⚠ ' : ''}
            {data.syncAge.label}
          </span>
        </>
      )}
      <Link href="/core" className="af-btn af-btn--ghost af-lh-back">
        {copy('Back to home')} →
      </Link>
    </>
  )
  const importedActions = !isNativePlatform(league.platform) ? (
    <ImportedLeagueQuickActions
      leagueId={league.id}
      leagueName={league.name}
      platform={platformLabel}
      canRemove={data.league.canRemoveImported === true}
      supportEvent={SUPPORT_OPEN_EVENT}
    />
  ) : null

  /* ── The guide (2026-11-13): the answer first, then this week, then everything else folded. ── */
  const g = useMessages(leagueOverviewGuideMessages)
  const elimination = isEliminationLeague(rail, league.variant)
  const preDraft = data.preSeason && rosteredPlayerCount === 0
  const pWin = data.matchup?.available ? data.matchup.data.winProbability?.pWin ?? null : null
  const head: OverviewHeadline = overviewHeadline({
    rail,
    variant: league.variant,
    preDraft,
    record: kpis.record,
    matchup: data.matchup?.available ? { opponent: data.matchup.data.opponent.name, pWin } : null,
  })
  const headline =
    head.kind === 'chopped'
      ? g.headChopped(head.week)
      : head.kind === 'alive'
        ? g.headAlive(head.rank, head.outOf, head.overCut)
        : head.kind === 'aliveUnranked'
          ? g.headAliveUnranked(head.outOf)
          : head.kind === 'preDraft'
            ? g.headPreDraft
            : head.kind === 'h2h'
              ? g.headH2h(head.rank, head.teams, head.record, null)
              : league.name
  /* This week, once, under the headline: the game (h2h) or the cut (elimination). */
  const weekLine = overviewWeekLine(head)
  const winPct = pWin != null ? Math.round(Math.max(0, Math.min(1, pWin)) * 100) : null
  const chips: Array<{ key: string; label: string; href: string }> = []
  // The win chance is said once, on the week's Matchup cell below — not again as a chip here.
  if (attention.length > 0) chips.push({ key: 'todo', label: g.chipToDo(issues.length), href: '#af-lh-attention-title' })
  const cutText =
    head.kind === 'chopped'
      ? g.cutChopped
      : head.kind === 'alive'
        ? /* The headline says the points; the cell says the places — each number once. */
          head.placesAboveCut != null && head.placesAboveCut > 0
          ? g.chipPlaces(head.placesAboveCut)
          : head.overCut != null
            ? g.cutClear(head.overCut)
            : g.cutAt
        : g.cutUnranked

  const showCommish = data.commissioner.available || 'href' in data.commissioner
  const scoreboardSection = (
    <>
      {/* ── Every game in the league ────────────────────────────────── */}
      {/*
        ⚠ THE PAGE SHOWED ONE MATCHUP — THE VIEWER'S. On a screen whose whole
        subject is the league, the other games were invisible: you could not see
        who was getting blown out, who was in a shootout, or whether next week's
        opponent was in trouble.
      */}
      <LeagueSection id="matchups"><StatePanel
        title={
          data.weekPicker && data.weekPicker.isFuture
            ? `${copy('Week')} ${data.weekPicker.selected} ${copy('in the league')}`
            : copy('This week in the league')
        }
        className="af-lh-scoreboard-panel"
        state={data.scoreboard}
        help={data.weekPicker ? <WeekPicker picker={data.weekPicker} /> : null}
      >
        {(board) => (
          <>
            {/*
              ⚠ A FUTURE WEEK MUST NOT LOOK LIKE A LIVE ONE. Nothing in it has
              happened, and the projections behind it may not even be for the
              week on screen -- the feed only holds the week ahead, so asking
              for week 10 in September prices the right players in the wrong
              week. That is still the best available answer to "who looks
              strong in week 10", and it is a different claim from a week-10
              projection. Saying which is the whole point of this line.
            */}
            {data.weekPicker?.isFuture ? (
              <p className="af-lh-weeknote">
                {m.futureWeekNotPlayed(data.weekPicker.selected)}
                {/* With no league-scored totals there are no numbers to vouch for; the board says why. */}
                {board.unpricedReason ? null : (
                  <>
                    {' '}{copy('Every number is projected from today’s rosters')}
                    {board.projectionBasis && !board.projectionBasis.matchesViewedWeek
                      ? m.futureWeekBasis(board.projectionBasis.week, data.weekPicker.selected)
                      : ''}
                    .
                  </>
                )}
              </p>
            ) : null}
            <LeagueScoreboardPanel
              board={board}
              winProbability={data.matchup.available ? data.matchup.data.winProbability : null}
            />
          </>
        )}
      </StatePanel></LeagueSection>

    </>
  )
  const draftSection = (
    <>
            <LeagueSection id="draft"><StatePanel title={copy('Draft HQ')} state={data.draftHq}>
            {(d) => (
              <div className="af-ch">
                <p className="af-ch-headline">{d.headline}</p>
                {d.detail ? <p className="af-ch-detail">{d.detail}</p> : null}
                {d.href && d.linkLabel ? (
                  <Link href={d.href} className="af-btn af-ch-open">
                    {copy(d.linkLabel)}
                  </Link>
                ) : null}
              </div>
            )}
          </StatePanel></LeagueSection>

    </>
  )
  const commishSection = (
    <>
            <LeagueSection id="commissioner"><StatePanel
            title={copy('Commissioner Hub')}
            help={<span className="af-lh-scope">{copy('Commissioners only')}</span>}
            state={data.commissioner}
            unavailableFooter={
              // A commissioner whose league can't be judged right now still gets the hub, which
              // carries the re-sync card; a non-commissioner's unavailable state has no href.
              !data.commissioner.available && 'href' in data.commissioner ? (
                <Link href={data.commissioner.href} className="af-btn af-ch-open">
                  {copy('Open the commissioner hub')}
                </Link>
              ) : null
            }
          >
            {(hub) => (
              <div className="af-ch">
                {/*
                  THE TWO FACTS A COMMISSIONER OPENS THE APP FOR: is anybody
                  checked out, and who. Everything else belongs behind the link
                  rather than crammed into a preview card.
                */}
                {/*
                  One sentence with the names (2026-11-14) — not two count tiles plus a names line saying
                  the same numbers. A league where EVERYONE is quiet is a lull, and naming the whole league
                  would read as an accusation — the hub's abandoned check says the same.
                */}
                {hub.totalManagers > 0 && hub.inactiveCount === hub.totalManagers ? (
                  <p className="af-ch-names" data-testid="league-home-commish-line">{copy('Nobody in this league has been active lately — a quiet stretch.')}</p>
                ) : hub.inactiveCount > 0 ? (
                  <p className="af-ch-names" data-testid="league-home-commish-line">
                    {g.commishInactive(hub.inactiveCount, hub.totalManagers)} {hub.inactiveNames.join(', ')}
                    {hub.inactiveCount > hub.inactiveNames.length
                      ? m.inactiveMore(hub.inactiveCount - hub.inactiveNames.length)
                      : ''}
                    .
                  </p>
                ) : (
                  <p className="af-ch-names af-ch-names--ok" data-testid="league-home-commish-line">{copy('Nobody is inactive.')}</p>
                )}
                {/* Absent, not zero, where at-risk is not measured (imported leagues). */}
                {hub.atRiskCount != null && hub.atRiskCount > 0 ? (
                  <p className="af-ch-names">{g.commishAtRisk(hub.atRiskCount)}</p>
                ) : null}
                <p className="af-ch-basis">{copy('Judged by')} {hub.basis}.</p>

                <Link href={hub.href} className="af-btn af-ch-open">
                  {copy('Open the commissioner hub')}
                </Link>
              </div>
            )}
          </StatePanel></LeagueSection>
    </>
  )

  return (
    <LeagueDisplayPreferences hidden={hiddenSections}><div className="af-lh" data-redraft={data.redraft ? 'true' : undefined} data-dynasty={data.dynasty ? 'true' : undefined}>
      {/* ── League identity ─────────────────────────────────────────── */}
      <header className="af-lh-head">
        <div className="af-lh-ident">
          <h1 className={identityInShell ? 'af-lh-name--hidden' : 'af-display af-lh-name'}>{league.name}</h1>
          <div className="af-lh-sub">
            {identityInShell ? null : (
              <span className="af-platform af-platform-chip" data-platform={league.platform}>
                {league.platform}
              </span>
            )}
            {/* A redraft deck names the format and season in its own chip ("Redraft · 2026"); saying it twice is noise. */}
            {/* So does the dynasty deck's era band ("Year 5 · 2026 season"). */}
            {league.format && !data.redraft && !data.dynasty ? <span>{league.format}</span> : null}
            {league.season && !data.redraft && !data.dynasty ? <span className="af-num">{league.season}</span> : null}
            {/* Record, rank and the trade deadline live in the KPI row below; the header does not repeat them. */}
            {data.yourTeam.available && !kpis.record ? (
              <>
                <span className="af-num">{data.yourTeam.data.record}</span>
                {data.yourTeam.data.rank != null ? (
                  <span className="af-num">#{data.yourTeam.data.rank}</span>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        {toolsAtFoot ? null : <div className="af-lh-headside">{headActions}</div>}
      </header>
      <section className="af-lho-head" data-testid="league-overview-guide" data-format={elimination ? 'elimination' : 'h2h'}>
        <span className="af-label">{g.eyebrow}</span>
        <p className="af-display af-lho-title">{headline}</p>
        {/*
          2026-11-14: the intro ("This league at a glance … Official moves are made on Sleeper") and the
          "Why it matters" paragraph are gone. Where official moves happen is said once, by the banner
          above every league tab; what this week is, is said here.
        */}
        {weekLine ? (
          <Link
            className="af-lho-week"
            data-testid="league-overview-week"
            data-week={weekLine.kind}
            href={weekLine.kind === 'game' ? `/core/matchup?league=${encodeURIComponent(league.id)}` : `/core/standings?league=${encodeURIComponent(league.id)}`}
          >
            {weekLine.kind === 'game' ? g.weekVs(weekLine.opponent, weekLine.winPct) : cutText} <span aria-hidden>→</span>
          </Link>
        ) : null}
        {chips.length > 0 ? (
          <div className="af-lho-chips">
            {chips.map((c) => (
              <Link key={c.key} className="af-lho-chip" data-chip={c.key} href={c.href}>
                {c.label}
              </Link>
            ))}
          </div>
        ) : null}
      </section>
      {/* When the draft is and what you owe — renders nothing when neither applies (components/league-home). */}
      <MemberStatusCard leagueId={league.id} />

      {/* Redraft season race — imported redraft leagues only (lib/core-app/redraftLeagueHome.ts); absent otherwise. */}
      {data.redraft ? <RedraftHomeDeck deck={data.redraft} leagueId={league.id} season={league.season} /> : null}

      {/* Dynasty Era deck — dynasty leagues only (lib/core-app/dynastyLeagueHome.ts); absent otherwise. */}
      {data.dynasty ? <DynastyHomeDeck deck={data.dynasty} leagueId={league.id} /> : null}

      {/* The record tile only when the headline does not already say it ("say each number once"). */}
      <HomeKpiRow data={data} tradeDeadline={tradeDeadline} elimination={elimination || head.kind === 'h2h'} />

      {toolsAtFoot ? null : importedActions}

      {league.variant === 'survivor_guillotine' && (
        <section className="af-card" aria-label="Survivor Guilly league">
          <span className="af-label">Survivor Guilly</span>
          <h2>Enter the island</h2>
          <p>Your lineup, tribe race, private powers, and Chop Night are ready in the league hub.</p>
          <Link className="af-btn" href={`/survivor-guillotine/${encodeURIComponent(league.id)}`}>Open league island →</Link>
        </section>
      )}

      <LeagueSection id="week"><section className="af-card af-lh-week-summary" aria-labelledby="af-lh-week-summary-title">
        <div className="af-lh-week-summary-head">
          <div><span className="af-label">{g.nextSteps}</span><h2 id="af-lh-week-summary-title">{data.preSeason && rosteredPlayerCount === 0 ? copy('Before the draft') : copy('This week')}</h2></div>
          <span className="af-lh-week-summary-fresh" data-stale={data.syncAge.stale}>{data.syncAge.label}</span>
        </div>
        <div className="af-lh-week-summary-grid" data-cells="2">
          <Link href={`/core/my-team?league=${league.id}`}>
            <span className="af-label">{g.lineup}</span>
            <strong>{data.preSeason && rosteredPlayerCount === 0 ? copy('Your roster is awaiting the draft') : g.reviewStarters}</strong>
            <span>{data.preSeason && rosteredPlayerCount === 0 ? `${teamDirectory.length} ${copy('teams imported')}` : g.checkKickoff} →</span>
          </Link>
          {/* The game and the cut are said once, under the headline (2026-11-14); this row is what to do. */}
          <div className="af-lh-week-summary-moves">
            <span className="af-label">{copy('Moves')}</span>
            <strong>{g.planMove}</strong>
            <span><Link href={`/core/trades?league=${league.id}`}>{copy('Trades')} →</Link><Link href={`/core/waivers?league=${league.id}`}>{copy('Waivers')} →</Link></span>
          </div>
        </div>
      </section></LeagueSection>

      {elimination ? null : scoreboardSection}

      {/* ── Main / side ─────────────────────────────────────────────── */}
      <div className="af-lh-grid">
        <div className="af-lh-main">
          {/*
            ⚠ THE "THIS WEEK'S MATCHUP" PANEL WAS HERE AND HAS BEEN DELETED.
            The scoreboard above shows every game in the league with yours
            marked and sorted first, so this panel printed week 1 a second time
            a few hundred pixels lower.

            The one thing it had that the scoreboard did not is the win
            probability, which now renders on your own game up there rather
            than being lost with the panel.
          */}

          {/* Needs your attention — up to three, each with the verb that fixes it */}
          {attention.length > 0 ? (
            <section className="af-lh-attention" aria-labelledby="af-lh-attention-title" data-testid="league-home-attention">
              <h2 id="af-lh-attention-title" className="af-label af-lh-attention-title">
                {m.attentionTitle}
              </h2>
              <ul className="af-lh-attention-list">
                {attention.map((issue, i) => (
                  <li
                    key={`${issue.title}-${i}`}
                    className={`af-card af-issue af-lh-urgent${i > 0 ? ' af-lh-urgent--minor' : ''}`}
                    data-severity={issue.severity}
                  >
                    <span className="af-lh-urgent-glyph" aria-hidden>
                      {issue.glyph}
                    </span>
                    <div className="af-lh-urgent-body">
                      <h3 className="af-lh-urgent-title">{issue.title}</h3>
                      <p className="af-lh-urgent-meta">{issue.meta}</p>
                    </div>
                    {issue.action ? (
                      <Link
                        href={issue.action.href}
                        className={i === 0 ? 'af-btn af-lh-urgent-cta' : 'af-btn af-btn--ghost af-lh-urgent-cta'}
                        {...(issue.action.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      >
                        {copy(issue.action.label)}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Draft HQ + Commissioner Hub, two-up — Draft HQ only before the draft (else folded), the hub only for a commissioner. */}
          <div className="af-lh-two">
            {preDraft ? draftSection : null}
            {showCommish ? commishSection : null}
          </div>

          {/* Standings */}
          <LeagueSection id="standings"><StatePanel title={copy('Standings')} state={data.standings}>
            {(rows) => (
              <div className="af-standings-wrap" data-faab={data.faabEnabled === true}>
                {/*
                  Column heads, because three numeric columns without them is a
                  guessing game. The budget column only applies to confirmed FAAB leagues.
                */}
                <div className="af-standings-head" aria-hidden>
                  <span />
                  <span />
                  <span className="af-label">W-L</span>
                  <span className="af-label">PF</span>
                  {data.faabEnabled === true ? <span className="af-label">FAAB</span> : null}
                </div>
                <ol className="af-standings">
                  {standingsRowsToShow(rows).map((t, i) => (
                    <li key={t.teamId} className="af-standings-row" data-you={t.isYou}>
                      <span className="af-standings-rank af-num">{t.rank ?? i + 1}</span>
                      <span className="af-standings-name">
                        {t.teamName}
                        {t.isYou ? <span className="af-standings-you"> — {copy('you')}</span> : null}
                      </span>
                      <span className="af-standings-record af-num">
                        {t.ties > 0 ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`}
                      </span>
                      <span className="af-standings-pf af-num">{Math.round(t.pointsFor)}</span>
                      {/*
                        ⚠ A DASH, NOT $0, WHEN WE DO NOT KNOW. The importer stores
                        null whenever it could not compute budget minus spend, and
                        a non-FAAB league can retain irrelevant imported balances.
                        "$0" would tell a manager holding a full budget that they
                        are broke.
                      */}
                      {data.faabEnabled === true ? <span className="af-standings-faab af-num">
                        {t.faabRemaining == null ? '\u2014' : `$${t.faabRemaining}`}
                      </span> : null}
                    </li>
                  ))}
                </ol>
                {/* The points are in the PF column; the bar chart that drew them again is gone (2026-11-14). */}
                <Link className="af-lh-standings-all" data-testid="league-home-standings-all" href={`/core/standings?league=${encodeURIComponent(league.id)}`}>
                  {g.fullStandings} <span aria-hidden>→</span>
                </Link>
              </div>
            )}
          </StatePanel></LeagueSection>
        </div>

        {/*
          The Ask Chimmy card that sat here is gone (2026-11-14): the league bar's Ask Chimmy and the chat
          button already open Chimmy on this league, and its "Make changes in Sleeper — AllFantasy only
          reads your league" contradicted the banner above every league tab.
        */}
      </div>

      {/*
        ── More about this league (2026-11-13 guide) ──────────────────
        Reference, history and league-wide boards: one tap away, not the page. The import coverage panel,
        the team directory, the paired-league offer, the season timeline, the power board, league buzz,
        rivalry radar and the prediction leaderboard — plus Draft HQ once the draft is done, and the
        league's every-game board in an elimination league, which has no head-to-head games.
      */}
      <details className="af-lho-more" data-testid="league-overview-more">
        <summary>{g.more}</summary>
        <div className="af-lho-more-body">
      {/*
        ── What this import could not bring across ───────────────────
        Top of the screen, above everything, because it changes how to read every
        number below it — a standings table with no schedule behind it is a
        different object from one with.

        ⚠ ONLY WHEN THERE IS SOMETHING TO SAY. `sentence` is null both when
        everything arrived and when the league predates coverage being persisted,
        and those must both stay silent: a banner on every league is one nobody
        reads by the second week.

        ⚠ AND IT NAMES THE PLATFORM, WITHOUT BLAMING IT. The sentence used to read
        "Fleaflicker doesn't publish trade history"; a `missing` bucket only means
        this import did not bring it across, so it now says exactly that and still
        names where the league came from (see importCoverageSummary's header).
      */}
      {coverageSlot !== undefined ? (
        coverageSlot
      ) : data.importCoverage.sentence ? (
        <section className="af-card af-lh-coverage" role="status" aria-label={copy('Import coverage')}>
          <span className="af-lh-coverage-glyph" aria-hidden>
            ◑
          </span>
          <p className="af-lh-coverage-text">{data.importCoverage.sentence}</p>
        </section>
      ) : null}

      {teamDirectory.length > 0 ? (
        <LeagueSection id="managers"><details className="af-card af-lh-team-directory" open={data.preSeason}>
          <summary>{copy('Teams in this league')} · {teamDirectory.length}</summary>
          {rosteredPlayerCount === 0 ? (
            <p>{copy('All teams are on file. Player rosters are empty until the draft or a later sync, so player trades cannot be analyzed yet.')}</p>
          ) : null}
          <ol>
            {teamDirectory.map((team) => (
              <li key={team.id}>
                <strong>{team.name}</strong>
                {team.ownerName && team.ownerName !== team.name ? <span>{team.ownerName}</span> : null}
                {team.isYou ? <small>{copy('you')}</small> : null}
              </li>
            ))}
          </ol>
        </details></LeagueSection>
      ) : null}

      {/* ── The other half of this franchise ────────────────────────── */}
      <LeagueSection id="pairing"><PairedBand pairing={data.pairing} leagueId={league.id} leagueName={league.name} /></LeagueSection>

      {/* ── Season timeline ─────────────────────────────────────────── */}
      {/* A redraft league's deck above carries the season track instead (same settings, same weeks). */}
      {data.redraft ? null : <LeagueSection id="timeline"><StatePanel
        title={`${copy('Season timeline')} · ${league.name}`}
        help={
          league.currentWeek != null ? (
            <span className="af-lh-here">{copy('You are here')} · {copy('week')} {league.currentWeek}</span>
          ) : undefined
        }
        className="af-lh-timeline-panel"
        state={data.timeline}
      >
        {(stages) => (
          <ol className="af-timeline">
            {stages.map((s) => (
              <li key={s.key} className="af-timeline-stage" data-state={s.state}>
                <span className="af-timeline-bar" aria-hidden />
                <span className="af-timeline-label">{s.label}</span>
                <span className="af-timeline-when af-label">{s.state === 'now' ? copy('NOW') : s.when}</span>
              </li>
            ))}
          </ol>
        )}
      </StatePanel></LeagueSection>}

      {elimination ? scoreboardSection : null}

      {/* ── Power board: all-play + movement ────────────────────────── */}
      {/*
        ⚠ STANDINGS LIE EARLY. A team can post the second-highest score in the
        league and be 0-2 because it drew the top scorer twice. All-play asks
        what the record would be against EVERYONE every week, and the gap
        between that and the real record is the schedule's contribution —
        measured rather than argued about.
      */}
      <LeagueSection id="insights"><StatePanel
        title={copy('Power board')}
        help={
          data.powerBoard.available ? (
            <span className="af-lh-here">
              {copy('through')} {data.powerBoard.data.weeksCounted}{' '}
              {copy(data.powerBoard.data.weeksCounted === 1 ? 'week' : 'weeks')}
              {lineups ? ` · AF / ${PROJECTION_PROVIDER_LABEL} ${copy('projected, week')} ${lineups.week}` : ''}
            </span>
          ) : undefined
        }
        className="af-lh-power-panel"
        state={data.powerBoard}
      >
        {(pb) => (
          <ol className="af-pb-list" data-proj={lineups ? 'true' : undefined}>
            {pb.rows.map((r) => (
              <li key={r.rosterId} className="af-pb-row">
                <span className="af-pb-rank af-num">{r.powerRank}</span>
                {/*
                  Null movement renders as nothing at all. "Unchanged" for a
                  team that has never been ranked is an invented history.
                */}
                {r.powerRankChange != null && r.powerRankChange !== 0 ? (
                  <span
                    className="af-pb-move af-num"
                    data-dir={r.powerRankChange > 0 ? 'up' : 'down'}
                    title={m.powerMoveTitle(Math.abs(r.powerRankChange), r.powerRankChange > 0)}
                  >
                    {r.powerRankChange > 0 ? '▲' : '▼'}
                    {Math.abs(r.powerRankChange)}
                  </span>
                ) : (
                  <span className="af-pb-move af-pb-move--none" aria-hidden />
                )}
                <span className="af-pb-name">
                  {rosterLabel([r.teamName, r.managerName], r.rosterId)}
                </span>
                <span className="af-pb-rec af-num" title={copy('Real head-to-head record')}>
                  {r.wins}-{r.losses}
                  {r.ties > 0 ? `-${r.ties}` : ''}
                </span>
                <span
                  className="af-pb-allplay af-num"
                  title={copy('What the record would be playing everyone every week')}
                >
                  {r.allPlayWins}-{r.allPlayLosses}
                  {r.allPlayTies > 0 ? `-${r.allPlayTies}` : ''}
                </span>
                {/*
                  Luck in WINS, because that is the unit people argue in.
                  Rounded to a tenth and only shown when it is worth a mention —
                  a 0.2-win swing is noise dressed as an insight.
                */}
                {Math.abs(r.luckWins) >= 0.5 ? (
                  <span
                    className="af-pb-luck af-num"
                    data-dir={r.luckWins > 0 ? 'lucky' : 'unlucky'}
                    title={
                      r.luckWins > 0
                        ? m.luckBetter(r.luckWins.toFixed(1))
                        : m.luckWorse(Math.abs(r.luckWins).toFixed(1))
                    }
                  >
                    {r.luckWins > 0 ? '+' : ''}
                    {r.luckWins.toFixed(1)}
                  </span>
                ) : (
                  <span className="af-pb-luck af-pb-move--none" aria-hidden />
                )}
                {lineups ? <ProjectedCells row={lineupFor(lineups, r.rosterId)} /> : null}
              </li>
            ))}
          </ol>
        )}
      </StatePanel></LeagueSection>

            {preDraft ? null : draftSection}
          <LeagueSection id="activity"><StatePanel title={copy('League buzz')} state={data.buzz}>
            {(items) => (
              <ul className="af-buzz">
                {items.map((b) => (
                  <li key={b.id} className="af-buzz-row">
                    {/*
                      The manager's own avatar. A feed of league activity should
                      read as people, not as rows — and until the attribution
                      was fixed every line here said "A manager", because it
                      joined on a column the writer hardcodes to null.
                    */}
                    {b.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="af-buzz-av" src={b.avatarUrl} alt="" width={22} height={22} />
                    ) : (
                      <span className="af-buzz-av af-buzz-av--none" aria-hidden>
                        {b.actor.charAt(0)}
                      </span>
                    )}
                    <span className="af-buzz-body">
                      <span className="af-buzz-line">
                        <span className="af-buzz-actor">{b.actor}</span>
                        <span className="af-buzz-text">{b.text}</span>
                        {/*
                          The bid, only when the provider recorded one. Rows
                          written before the emitter carried it have bid === null
                          and show nothing at all -- an unrecorded bid and a $0
                          bid are different facts, and $0 is a real, common bid.
                        */}
                        {b.bid != null ? <span className="af-buzz-bid">${b.bid}</span> : null}
                      </span>
                      {/*
                        A trade's grade: one letter per team, from THE grade (the Trade Center's
                        letter for the same deal), and who it favours. A withheld grade shows its
                        reason and no letter.
                      */}
                      {b.grades && b.grades.length > 0 ? (
                        <span className="af-buzz-grades" aria-label={copy('Trade grade for each team')}>
                          {b.grades.map((g) => (
                            <span key={g.team} className="af-buzz-grade" data-letter={g.letter}>
                              <span className="af-buzz-grade-team">{g.team}</span>
                              <b>{g.letter}</b>
                            </span>
                          ))}
                        </span>
                      ) : null}
                      {b.gradeLine ? <span className="af-buzz-grade-line">{b.gradeLine}</span> : null}
                      {/*
                        Faces for who moved. The sentence above already names
                        them; this is so a claim is recognisable before it is
                        read. Capped at five so a twelve-player trade does not
                        push the rest of the feed off the panel.
                      */}
                      {b.players && b.players.length > 0 ? (
                        <span className="af-buzz-faces">
                          {b.players.slice(0, 5).map((pl) =>
                            pl.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={pl.id}
                                className="af-buzz-face"
                                src={pl.imageUrl}
                                alt={pl.name ?? ''}
                                title={pl.label}
                                width={26}
                                height={26}
                              />
                            ) : (
                              /*
                                No headshot on file. A labelled placeholder keeps
                                the row's shape and still says who it is on hover,
                                rather than silently dropping the player.
                              */
                              <span
                                key={pl.id}
                                className="af-buzz-face af-buzz-face--none"
                                title={pl.label}
                              >
                                {(pl.name ?? '?').charAt(0)}
                              </span>
                            ),
                          )}
                          {b.players.length > 5 ? (
                            <span className="af-buzz-more">+{b.players.length - 5}</span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </StatePanel></LeagueSection>

          {/*
            Rivalry radar. Same `() => null` trap as the matchup strip above.
            The design also shows when a manager is usually online; nothing records
            that, so it is the one line omitted rather than invented.
           */}
          <LeagueSection id="insights"><StatePanel title={copy('Rivalry radar · this league')} state={data.rivalry}>
            {(rows) => (
              <div className="af-lh-rivals">
                {rows.map((r) => (
                  <div key={r.key} className="af-lh-rival">
                    <span className="af-lh-rival-body">
                      <b>{r.name}</b>
                      <em>
                        {r.meetings} {copy(r.meetings === 1 ? 'meeting' : 'meetings')}
                        {/* The last meeting rebuilt from its parts — the dashboard's own `rivalLastText` — so the
                            margin reads «te ganó por 10.0» in Spanish. A row with no parts falls back to `copy`,
                            which still turns a tied 'a tie' into 'empate'. */}
                        {r.lastResult ? ` · ${copy('last:')} ${copy(rivalLastText(r, language) ?? r.lastResult)}` : ''}
                      </em>
                    </span>
                    <b className={r.wins >= r.losses ? 'af-lh-good' : 'af-lh-bad'}>
                      {/* W–L, or W–L–T once a meeting finished level — Rivalry Radar's format. */}
                      {(r.ties ?? 0) > 0 ? `${r.wins}–${r.losses}–${r.ties}` : `${r.wins}–${r.losses}`}
                    </b>
                  </div>
                ))}
              </div>
            )}
          </StatePanel></LeagueSection>
      {/* The league chat's prediction polls, scored over the season. AF-hosted leagues only. */}
      <LeagueSection id="insights">{isNativePlatform(league.platform) ? <PredictionLeaderboard leagueId={league.id} /> : null}</LeagueSection>

        </div>
      </details>

      {/*
        ── All leagues ──────────────────────────────────────────────────
        League scope is absolute on this screen: every panel above is about this
        one league, and cross-league facts live here and nowhere else.
      */}
      {otherLeagueIssueCount > 0 ? (
        <section className="af-card af-lh-elsewhere">
          <span className="af-label">{copy('All leagues')}</span>
          <p className="af-lh-elsewhere-text">
            {m.otherLeagueIssues(otherLeagueIssueCount)}
          </p>
          <Link href="/core" className="af-lh-cardlink">
            {copy('Back to home')} →
          </Link>
        </section>
      ) : null}

      {toolsAtFoot ? (
        <footer className="af-lh-foot" data-testid="league-home-foot">
          {importedActions}
          <div className="af-lh-headside af-lh-foot-actions">{headActions}</div>
        </footer>
      ) : null}
    </div></LeagueDisplayPreferences>
  )
}

/**
 * The Power board's AF / API columns. A lineup total built from part of a lineup shows its
 * coverage (`7/9`) rather than passing for a whole one; a side the engine could not price is a
 * dash, never 0; a roster the loader did not return gets two dashes.
 *
 * rosterIdsMatch, not `===`: an MFL externalId ("0001") stops equalling the board's roster id
 * ("1") once it has been through the Int column — see rosterIdMatch.ts.
 */
function lineupFor(lineups: StandingsLineups, rosterId: string) {
  return lineups.rows.find((l) => rosterIdsMatch(l.rosterId, rosterId)) ?? null
}

function ProjectedCells({ row }: { row: StandingsLineups['rows'][number] | null }) {
  const cell = (v: number | null, from: number, of: number, title: string) =>
    v == null ? (
      <span className="af-pb-proj af-num af-pb-proj--none" title={title} aria-label={`${title}: not priced`}>
        —
      </span>
    ) : (
      <span className="af-pb-proj af-num" title={title}>
        {v.toFixed(1)}
        {from < of ? <span className="af-pb-proj-cov"> {from}/{of}</span> : null}
      </span>
    )
  return (
    <>
      <span className="af-pb-proj-af">
        {cell(row?.af ?? null, row?.afFrom ?? 0, row?.starterCount ?? 0, 'AF — AllFantasy’s own projection for this week’s lineup')}
      </span>
      {cell(row?.api ?? null, row?.apiFrom ?? 0, row?.starterCount ?? 0, `${PROJECTION_PROVIDER_LABEL} — ${PROJECTION_PROVIDER_LABEL}’s projection for this week’s lineup`)}
    </>
  )
}

export default LeagueHome
