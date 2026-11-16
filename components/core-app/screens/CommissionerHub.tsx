import CommissionerActionQueue from '@/components/core-app/CommissionerActionQueue'
import CommissionerWeeklyPlan from '@/components/core-app/CommissionerWeeklyPlan'
import { NativeAutoSubsCommissioner } from '@/components/core-app/NativeAutoSubsControls'
import { InactiveManagerCommissioner } from '@/components/core-app/InactiveManagerCommissioner'
import Link from 'next/link'
import { Suspense, type CSSProperties, type ReactNode } from 'react'
/*
 * The action queue, weekly plan and automation panels below are `.af-tw` panels. Their styles were
 * reaching this screen only because /core's page also imports LeagueMoves, which imports this
 * file — so anywhere the hub renders on its own, every one of those panels came out unstyled.
 * Imported first so the hub's own sheets still win where they overlap, as they do on /core.
 */
import '@/components/core-app/af-team-workspace.css'
import '@/components/core-app/af-commish-hub.css'
import '@/components/core-app/af-format-hubs.css'
import '@/components/core-app/af-core-redraft-standings.css'
import { HubHeroMedia } from '@/components/core-app/hubs/HubHeroMedia'
import { CommissionerOsLink } from '@/components/core-app/hubs/CommissionerOsLink'
import { CommissionerOsActionsSummary } from '@/components/league-hub/CommissionerOsActionsSummary'
import { CommissionerChimmy } from '@/components/core-app/commissioner/CommissionerChimmy'
import { PublishStandingsToggle } from '@/components/core-app/PublishStandingsToggle'
import { WaiverOversight } from '@/components/core-app/WaiverOversight'
import { TopicTip } from '@/components/core-app/TopicTip'
import type { CommissionerHubResult, CommissionerTile } from '@/lib/core-app/commissionerHub'
import { loadActivityCharts, loadAuditTimeline } from '@/lib/core-app/commissioner/reports'
import { platformLabel } from '@/lib/core-app/platformLinks'
import {
  CommunityLinks,
  HealthPanel,
  HubCalendar,
  HubNav,
  HubSection,
  LeagueAreas,
  MemberActivity,
  TaskCards,
} from '@/components/core-app/commissioner/HubSections'
import {
  AuditTimeline,
  AuditTimelineFallback,
  ChartsFallback,
  HealthBreakdown,
  HealthBreakdownStatic,
  OperationalCharts,
  RecentChanges,
  RecentChangesFallback,
} from '@/components/core-app/commissioner/HubReports'
import { GuidedWorkflows } from '@/components/core-app/commissioner/GuidedWorkflows'
import { AutomationRecipes } from '@/components/core-app/commissioner/AutomationRecipes'
import { LineupIntegrity } from '@/components/core-app/commissioner/LineupIntegrity'
import { EliminatedLineups } from '@/components/core-app/commissioner/EliminatedLineups'
import { FillEmptyStarters } from '@/components/core-app/commissioner/FillEmptyStarters'
import { AutomationOverview } from '@/components/core-app/commissioner/AutomationOverview'
import { OffseasonCalendar } from '@/components/core-app/commissioner/OffseasonCalendar'
import { IrAutoMove } from '@/components/core-app/commissioner/IrAutoMove'
import { OrphanAuction } from '@/components/core-app/commissioner/OrphanAuction'
import { FindLeagueListingCard } from '@/components/core-app/commissioner/FindLeagueListingCard'
import { ExternalListingCard } from '@/components/core-app/commissioner/ExternalListingCard'
import { JoinRequestsCard } from '@/components/core-app/commissioner/JoinRequestsCard'
import { DeadlineAutopilot } from '@/components/core-app/commissioner/DeadlineAutopilot'
import { StorylineStudio } from '@/components/core-app/commissioner/StorylineStudio'
import { WeeklyRecapReview } from '@/components/core-app/commissioner/WeeklyRecapReview'
import { AnnounceButton } from '@/components/core-app/commissioner/AnnounceButton'
import { WeeklyChecklist } from '@/components/core-app/commissioner/WeeklyChecklist'
import { RolloverWizard } from '@/components/core-app/commissioner/RolloverWizard'
import { FormatTemplateControl } from '@/components/core-app/commissioner/FormatTemplateControl'
import { DynastyFormatCard } from '@/components/core-app/commissioner/DynastyFormatCard'
import { CoreDepthLock, FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import { DisputeDesk } from '@/components/disputes/DisputeDesk'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { StandingsLineups } from '@/lib/core-app/standingsLineups'
import { WeekLineupsBody } from '@/components/core-app/standings/WeekLineupsTable'
import { hubCopy, hubDateLocale } from '@/lib/core-app/commissionerHubCopy'
import { healthRingPct } from '@/lib/core-app/redraftCoreRace'
import { HubFold } from '@/components/core-app/commissioner/HubFold'
import { HubFoldOpener } from '@/components/core-app/commissioner/HubFoldOpener'

/**
 * Screen 38a·9 — Commissioner Hub, the per-league commissioner cockpit.
 *
 * ── Order is the design ────────────────────────────────────────────────
 *
 * The key-art band first — it carries the cockpit's six counts, "Needs you"
 * among them — then the task cards: what needs the commissioner, each with the
 * action that deals with it. Then the rest of the cockpit (recent changes, who
 * has gone quiet, health), the reference material — calendar, guides, every
 * league area — and only then the large reports and tables. On a phone that is a
 * single column in exactly this order; the band drops its sub-lines there so the
 * task cards still start on the first screen, and nothing urgent sits below a
 * chart.
 *
 * ── Access ─────────────────────────────────────────────────────────────
 *
 * The gate lives in `getCommissionerHub`, runs server-side before any league
 * figure is read, and the same resolver decides whether the nav item is drawn at
 * all. The streamed reports take the grant that gate produced, so they cannot be
 * rendered for a league whose gate never ran.
 *
 * ⚠ A SERVER COMPONENT ON PURPOSE. The interactive pieces — guides, recipe
 * switches, calendar export, the publish switch, the announcement composer —
 * are client islands rendered only inside the granted branch, and every write
 * they make goes through a route that re-checks the role.
 *
 * ── The hub dress (five-doors restyle, 2026-09-17) ─────────────────────
 *
 * The header, key-art band and footer wear the format hubs' look (`.afh`), so
 * this screen and the all-leagues one at `/core/commissioner` read as one hub.
 * Every section below the band is unchanged — the user's call was "every
 * section kept, restyled". The tiles moved INTO the band, which is built to
 * carry exactly these counts; the band's art is the league's own format loop.
 */

type CommissionerHubProps = {
  data: CommissionerHubResult
  /**
   * This week's lineups, projected — AllFantasy's engine (AF) beside the provider's (API) — for
   * every team, as its own section. DISPLAY ONLY, and free: it is standings-grade information, not
   * commissioner depth. Null draws no section and no jump link.
   */
  lineups?: StandingsLineups | null
  /**
   * The reader's language, resolved server-side by the page. A server screen cannot read the client
   * provider; the language toggle refreshes the route, so this re-renders on a switch.
   */
  language?: string
}

export function CommissionerHub({ data, lineups = null, language = 'en' }: CommissionerHubProps) {
  const t = (english: string | null | undefined) => hubCopy(english, language)
  if (!data.allowed) {
    return (
      <div className="af-ch afh" data-format="all">
        <Link className="afh-back" href="/core/commissioner">
          {t('← All leagues you run')}
        </Link>
        <header className="af-ch-head">
          <p className="af-label af-ch-eyebrow">{t('Core · Commissioner')}</p>
          <h1 className="af-display af-ch-title">{t('Commissioner')}</h1>
        </header>

        <div className="af-ch-blocked">
          <span className="af-ch-blocked-mark" aria-hidden>
            ⚑
          </span>
          <h2 className="af-ch-blocked-title">{t('Commissioners and co-commissioners only')}</h2>
          <p className="af-ch-blocked-body">{t(data.reason)}</p>
          {/*
            States what the viewer IS, not just what they are not. "You are a
            member of this league" is a different situation from "you are not in
            this league at all", and someone who hit this screen deserves to
            know which one they are looking at.
          */}
          <p className="af-ch-blocked-role">
            {t(
              data.role === 'member'
                ? `You are a member of ${data.leagueName}. Ask its commissioner to add you as a co-commissioner if you need this.`
                : data.role === 'viewer'
                  ? `You have view-only access to ${data.leagueName}.`
                  : `You are not a member of ${data.leagueName}.`,
            )}
          </p>
        </div>
      </div>
    )
  }

  const { league, role, tiles, settings, access, unread, disputes, publicStandings, art } = data
  const now = new Date()
  // Commissioner depth (AF Commissioner). Locked, the loader skipped the waiver read and the export.
  const depth = data.depth ?? null
  const depthOpen = depth?.unlocked !== false
  // Started here, awaited by the sections that show them — each inside its own boundary.
  // The timeline also feeds the free "Recent changes" panel, so it loads either way; the charts do not.
  const timeline = loadAuditTimeline(data.grant)
  const activity = depthOpen ? loadActivityCharts(data.grant, now, language) : null
  const platformName = platformLabel(league.platform)
  const quiet = data.quietManagers
  const healthRing = healthRingPct(data.health.score)
  /*
   * 2026-11-14: the headline is the answer — how many things need you — where it was the league's name over
   * a paragraph listing everything the page holds. The count is the task cards' own (the "Needs you" tile
   * it replaces read the same number), so the headline and the cards under it cannot disagree.
   */
  const taskCount = data.tasks.cards.length + data.tasks.overflow.length
  const headline = unread
    ? t('This league hasn’t synced yet')
    : taskCount === 0
      ? t('Nothing needs you right now')
      : t(taskCount === 1 ? '1 thing needs you' : `${taskCount} things need you`)
  /* The tiles the headline and the lines under them already say: "Needs you" and "Claimed teams". */
  const shownTiles = tiles.filter((tile) => tile.key !== 'needs-you' && tile.key !== 'claimed')
  /* The score the health card leads with, on its fold — the same clamp the score ring uses. */
  const healthNote = healthRing == null ? null : `${healthRing}/100`

  return (
    <div className="af-ch afh" data-format="all" data-testid="commissioner-league-hub">
      <HubFoldOpener />
      <div className="af-ch-back-row">
        <Link className="afh-back" href="/core/commissioner">
          {t('← All leagues you run')}
        </Link>
        {/* A small link beside the way back (2026-11-14), not a full-width button above the cockpit. */}
        <Link className="af-ch-back-more" href="/tournament-hub">
          {t('Multi-league tournaments and weekly reports →')}
        </Link>
      </div>

      <header className="afh-head">
        <div className="afh-title">
          <div className="afh-label">
            {t('Core · Commissioner')} · {league.name}
            {art.label ? ` · ${t(art.label)}` : ''}
          </div>
          <div className="afh-title-row">
            <span className="afh-badge" aria-hidden>
              ⚑
            </span>
            <h1 data-testid="commissioner-headline">{headline}</h1>
            <span className="af-ch-role af-label" data-role={role}>
              {role === 'commissioner' ? t('Commissioner') : t('Co-commissioner')}
            </span>
          </div>
          {/*
            No "Everything it takes to run this league…" paragraph (2026-11-14): the page shows it. That an
            imported league's rulings are applied on its platform is said once, in the footer.
          */}
        </div>
        {data.viewerCanBroadcast ? (
          <div className="afh-head-actions">
            <AnnounceButton leagueId={league.id} label={t('Send @everyone')} className="afh-btn" />
          </div>
        ) : null}
      </header>

      {/* ── Cockpit (item 1) — the tiles, carried by the key-art band ─────── */}
      <section
        className="afh-hero"
        data-kind="league"
        data-art={art.video ? 'loop' : 'still'}
        aria-label={t(`${league.name} right now`)}
      >
        <HubHeroMedia video={art.video} poster={art.poster} />
        {art.video ? (
          <div className="afh-seal" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={art.poster} alt="" />
          </div>
        ) : null}
        <div className="afh-hero-body">
          <div className="afh-label">
            {t('This league right now')} <TopicTip topic="commissionerTiles" />
          </div>
          <div className="afh-tiles">
            {shownTiles.map((tile) => (
              <Tile key={tile.key} tile={tile} t={t} />
            ))}
          </div>
          {/*
            No "Gone quiet: …" line (2026-11-14): the "Needs you now" card names the same managers, with the
            button that deals with it, and Member activity lists them.
          */}
          {data.unclaimedTeams > 0 ? (
            <p className="afh-hero-note">
              {t(
                data.unclaimedTeams === 1
                  ? '1 team isn’t connected to an AllFantasy account yet.'
                  : `${data.unclaimedTeams} teams aren’t connected to an AllFantasy account yet.`,
              )}{' '}
              <a href="#ch-areas">{t('Invite managers')}</a>
            </p>
          ) : null}
        </div>
      </section>

      <HubNav omit={lineups ? [] : ['ch-lineups']} language={language} />

      {/*
        ⚠ THE BANNER IS THE POINT, NOT DECORATION. Without it a league nobody has
        ever synced renders calm tiles — "0 unclaimed", "0 waiting on you", a
        healthy-looking screen assembled entirely out of the absence of data.
      */}
      {unread ? (
        <div className="af-ch-unread">
          <span className="af-label">{t('Not measured yet')}</span>
          <p>
            {t(
              'This league has never synced, so nothing below has been checked. An empty task list here means we have not looked — not that the league is quiet.',
            )}
          </p>
        </div>
      ) : null}

      {/* ── This week — the weekly checklist (redraft; renders nothing for other leagues) ── */}
      {league.native ? <WeeklyChecklist leagueId={league.id} language={language} /> : null}
      {league.native && data.role === 'commissioner' ? <RolloverWizard leagueId={league.id} /> : null}
      {/* A private league's "Ask to join" requests from Find a League; renders nothing when there are none to show. */}
      {league.native && data.role === 'commissioner' ? <JoinRequestsCard leagueId={league.id} /> : null}

      {/* ── 1 · Urgent work (items 1, 10) ──────────────────────────────── */}
      <TaskCards data={data} language={language} />
      {data.role === 'commissioner' && <CommissionerActionQueue leagueId={league.id} />}
      {/*
        ── EVERYTHING BELOW "NEEDS YOU NOW" IS FOLDED (2026-11-14) ─────────────────────────────────
        Each section is one row — its title and, where there is one, the fact worth seeing closed — and
        opens in place (HubFold). The jump chips and in-page links open the fold they point into
        (HubFoldOpener). Nothing inside a section changed.
      */}
      {data.role === 'commissioner' ? (
        <HubFold id="ch-weekly" title={t('Turn this week into league action')}>
          <CommissionerWeeklyPlan key={league.id} leagueId={league.id} />
        </HubFold>
      ) : null}
      {/* Open seats → Find a League. Native only: an imported league's seats are filled on its own platform. */}
      {data.role === 'commissioner' ? (
        <HubFold id="ch-find-players" title={t('Find players for your league')}>
          {league.native ? <FindLeagueListingCard leagueId={league.id} /> : <ExternalListingCard leagueId={league.id} />}
        </HubFold>
      ) : null}
      {/*
        The AllFantasy-run league's settings cards, under ONE fold: most hide themselves when they do not
        apply, so a fold each would leave empty rows. AutoSubs always draws, so this fold is never empty.
        Their own headings stay visible inside it — there are several, and the summary names none of them.
      */}
      {league.native && data.role === 'commissioner' ? (
        <HubFold id="ch-native-settings" title={t('Lineup and roster autopilot')}>
          <AutomationOverview leagueId={league.id} />
          <OffseasonCalendar leagueId={league.id} />
          <NativeAutoSubsCommissioner leagueId={league.id} />
          <InactiveManagerCommissioner leagueId={league.id} />
          <FillEmptyStarters leagueId={league.id} />
          <EliminatedLineups leagueId={league.id} />
          <IrAutoMove leagueId={league.id} />
          <OrphanAuction leagueId={league.id} />
        </HubFold>
      ) : null}

      <HubFold id="ch-intelligence" title={t('Commissioner intelligence')}>
        <HubSection id="ch-intelligence" title={t('Commissioner intelligence')}>
          <CommissionerOsActionsSummary leagueId={league.id} sport={league.sport} />
          <CommissionerChimmy leagueId={league.id} />
        </HubSection>
      </HubFold>

      <HubFold id="ch-format-ops" title={t('Format operations')}>
      <HubSection id="ch-format-ops" title={t('Format operations')}>
        {data.network && (
          <p className="af-ch-muted">
            {t('Network:')} <Link href="/commissioner-os/networks">{data.network.name}</Link> · {t(data.network.role)}
          </p>
        )}
        {data.formatCards.length ? (
          <ul className="af-ch-areas">
            {data.formatCards.map((card) =>
              card.tone === 'dynasty' ? (
                <DynastyFormatCard key={card.key} card={card} />
              ) : (
                <li key={card.key}>
                  <strong>{t(card.title)}</strong>
                  <p>{t(card.detail)}</p>
                  <Link href={card.href}>{t(card.action)} →</Link>
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="af-ch-muted">
            {t('No specialty mechanics were resolved for this league. Review league settings before applying format-specific rules.')}
          </p>
        )}
        {/* The owner's statement of how the league is really run, which no platform publishes. */}
        {data.formatTemplate ? <FormatTemplateControl leagueId={league.id} template={data.formatTemplate} /> : null}
      </HubSection>
      </HubFold>

      <HubFold id="ch-history" title={t('Trades and draft archive')}>
      <HubSection id="ch-history" title={t('Trades and draft archive')}>
        <h3>{t('Latest trades')}</h3>
        {data.history.trades.length ? (
          <ul className="af-ch-areas">
            {data.history.trades.map((trade) => (
              <li key={trade.id}>
                <strong>{trade.label}</strong>
                <p>
                  {t(trade.status)} · {trade.source} · {new Date(trade.at).toLocaleDateString(hubDateLocale(language))}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="af-ch-muted">{data.history.tradeAvailable ? t('No trade records on file.') : t('Trade history unavailable.')}</p>
        )}
        <p className="af-ch-muted">{t(data.history.tradeNote)}</p>
        <h3>{t('Draft archive')}</h3>
        {data.history.drafts.length ? (
          data.history.drafts.map((draft) => (
            <details key={`${draft.source}-${draft.id}`}>
              <summary>
                {draft.season ?? t('Season unknown')}
                {draft.seasonBasis === 'date_inferred' ? t(' (year inferred)') : ''} · {draft.source} · {t(draft.status)} ·{' '}
                {t(draft.picks.length === 1 ? '1 pick' : `${draft.picks.length} picks`)}
              </summary>
              <ol>
                {draft.picks.map((pick) => (
                  <li key={pick.overall}>
                    {t(`Round ${pick.round}, pick ${pick.overall}: ${pick.owner} selected ${pick.player}`)}
                    {pick.corrections.length > 0 && (
                      <ul>
                        {pick.corrections.map((correction, index) => (
                          <li key={index}>
                            {t('Correction:')} {t(correction)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          ))
        ) : (
          <p className="af-ch-muted">{data.history.draftAvailable ? t('No draft sessions on file.') : t('Draft history unavailable.')}</p>
        )}
        <p className="af-ch-muted">{t(data.history.draftNote)}</p>
        {data.history.lotteryReadFailed ? <p className="af-ch-muted">{t('Lottery history is temporarily unavailable.')}</p> : null}
        {data.history.lotteries?.length ? (
          <>
            <h3>{t('Weighted lottery history')}</h3>
            <p className="af-ch-muted">{t('Recorded AllFantasy draws; older or imported results may be missing.')}</p>
            {data.history.lotteries.map((draw) => (
              <details key={draw.id}>
                <summary>{draw.season != null ? `${draw.season} · ` : ''}{new Date(draw.at).toLocaleDateString(hubDateLocale(language))}</summary>
                <ol>
                  {draw.slots.map((slot) => (
                    <li key={slot.slot}>{t('Pick')} {slot.slot}: {slot.team}{slot.odds != null ? ` · ${slot.odds.toLocaleString(hubDateLocale(language), { maximumFractionDigits: 2 })}% ${t('odds at pick 1')}` : ''}</li>
                  ))}
                </ol>
              </details>
            ))}
          </>
        ) : null}
      </HubSection>
      </HubFold>

      {/* Recent changes moved into the audit log's fold (2026-11-14): both listed the same syncs. */}
      <HubFold
        id="ch-members"
        title={t('Member activity')}
        note={quiet.length > 0 ? t(quiet.length === 1 ? '1 gone quiet' : `${quiet.length} gone quiet`) : null}
      >
        <HubDepthGate depth={depth} id="ch-members" what={t('Member activity')} language={language}>
          <MemberActivity data={data} language={language} />
        </HubDepthGate>
      </HubFold>

      {/* ── 3 · Health (item 7) ───────────────────────────────────────── */}
      {/*
        The health panel inside a `display: contents` wrapper: it changes no layout anywhere, and carries the
        engine score as `--rdc-health` for the redraft identity's score ring (af-core-redraft-standings.css).
        No score, no variable and no ring — lib/core-app/redraftCoreRace.ts healthRingPct.
      */}
      <HubFold id="ch-health" title={t('League health')} note={healthNote}>
      <div
        className="af-rdc-health"
        style={healthRing == null ? { display: 'contents' } : ({ display: 'contents', '--rdc-health': healthRing } as CSSProperties)}
        data-ring={healthRing == null ? undefined : 'true'}
      >
        <HealthPanel
          data={data}
          language={language}
          breakdown={
            activity ? (
              <Suspense fallback={<HealthBreakdownStatic data={data} reason="loading" language={language} />}>
                <HealthBreakdown data={data} activity={activity} language={language} />
              </Suspense>
            ) : (
              <HealthBreakdownStatic data={data} reason="locked" language={language} />
            )
          }
        />
      </div>
      </HubFold>

      {/* ── 4 · Calendar (item 3) ─────────────────────────────────────── */}
      <HubFold id="ch-calendar" title={t('League calendar')}>
        <HubCalendar data={data} language={language} />
      </HubFold>

      {/* ── 5 · Guides (item 4) ───────────────────────────────────────── */}
      <HubFold id="ch-workflows" title={t('Step-by-step guides')}>
        <HubSection id="ch-workflows" title={t('Step-by-step guides')}>
          <GuidedWorkflows workflows={data.workflows} />
        </HubSection>
      </HubFold>

      {/* ── 6 · Every league area (item 2) ────────────────────────────── */}
      <HubFold id="ch-areas" title={t('Every part of the league')}>
        <LeagueAreas data={data} language={language} />
      </HubFold>

      {/* ── This week's lineups, projected (AF beside API, 2026-09-30) ── */}
      {lineups ? (
        <HubFold id="ch-lineups" title={t('This week’s lineups, projected')} note={t(`week ${lineups.week}`)}>
        <HubSection
          id="ch-lineups"
          title={t('This week’s lineups, projected')}
          note={<span className="af-num">{t(`week ${lineups.week}`)}</span>}
          className="af-ch-lineups"
        >
          <WeekLineupsBody lineups={lineups} caveat={t('nothing here changes a standing or a ruling.')} />
        </HubSection>
        </HubFold>
      ) : null}

      {/* ── Waiver oversight (handoff 2026-09-13) ─────────────────────── */}
      {data.waivers || depth?.unlocked === false ? (
        <HubFold id="ch-waivers" title={t('Waiver oversight')}>
          <HubDepthGate depth={depth} id="ch-waivers" what={t('Waiver oversight')} language={language}>
            {data.waivers ? <WaiverOversight data={data.waivers} /> : null}
          </HubDepthGate>
        </HubFold>
      ) : null}

      <HubFold id="ch-rules" title={t('How this league runs')} note={league.season != null ? String(league.season) : null}>
        {/* ── How the league runs ────────────────────────────────────── */}
        <HubSection
          id="ch-rules"
          title={t('How this league runs')}
          note={league.season != null ? <span className="af-num">{league.season}</span> : undefined}
        >
          <ul className="af-ch-settings">
            {settings.map((row) => (
              <li key={row.key}>
                <span className="af-ch-setting-key">{t(row.key)}</span>
                {row.state.available ? (
                  <span className="af-ch-setting-value">{t(row.state.data)}</span>
                ) : (
                  <span className="af-ch-setting-why">{t(row.state.reason)}</span>
                )}
              </li>
            ))}
          </ul>

          {/*
            Disputes state their absence rather than being quietly left off the
            screen. The engines behind a dispute scan only read AF-native tables,
            so on an imported league "0 disputes" would be a claim with no scan
            behind it. The guide above is what a commissioner uses instead.
          */}
          <div className="af-ch-disputes">
            <span className="af-label">{t('Disputes')}</span>
            <p>{t(disputes.reason)}</p>
            {league.native && (
              <Link href={`/league/${encodeURIComponent(league.id)}/commissioner/integrity`}>{t('Open integrity monitor →')}</Link>
            )}
          </div>

          {/* Filed disputes: managers file, the commissioner rules. Works for imported leagues too. */}
          <div className="af-ch-dispute-desk" style={{ marginTop: 16 }}>
            <DisputeDesk leagueId={league.id} />
            <p className="af-ch-setting-why">
              <Link href={`/league/${encodeURIComponent(league.id)}/disputes`}>{t('Share the dispute desk with your league →')}</Link>
            </p>
          </div>

          {/* The constitution: written from these settings, changed by league vote. */}
          <p className="af-ch-setting-why" style={{ marginTop: 12 }}>
            <Link href={`/league/${encodeURIComponent(league.id)}/constitution`}>{t('League constitution and amendments →')}</Link>
          </p>

          {/* The league log: every commissioner action, readable by the league unless set commish-only. */}
          <p className="af-ch-setting-why">
            <Link href={`/league/${encodeURIComponent(league.id)}/log`}>{t('League log: who can see your actions →')}</Link>
          </p>
        </HubSection>
      </HubFold>

      <HubFold id="ch-access" title={t('Who can run this league')} note={t(access.length === 1 ? '1 person' : `${access.length} people`)}>
        {/* ── Access ────────────────────────────────────────────────── */}
        <HubSection
          id="ch-access"
          title={t('Who can run this league')}
          note={t(access.length === 1 ? '1 person' : `${access.length} people`)}
        >
          {access.length > 0 ? (
            <ul className="af-ch-access">
              {access.map((a) => (
                <li key={`${a.role}-${a.basis}-${a.handle}`}>
                  <span className="af-ch-access-mark af-num" aria-hidden>
                    {a.initials}
                  </span>
                  <span className="af-ch-access-name">
                    {a.handle}
                    {a.isYou ? <span className="af-ch-access-you"> · {t('you')}</span> : null}
                    {/*
                      An imported league has two authorities, and the row says which one this is:
                      AllFantasy's owner runs it here, the platform publishes its own commissioner.
                    */}
                    {league.native ? null : (
                      <span className="af-ch-access-basis">
                        {t(
                          a.basis === 'platform'
                            ? `On ${platformName}`
                            : a.basis === 'both'
                              ? `Here and on ${platformName}`
                              : 'Here on AllFantasy',
                        )}
                      </span>
                    )}
                  </span>
                  <span className="af-ch-access-role af-label" data-role={a.role}>
                    {a.role === 'commissioner' ? t('Commissioner') : t('Co-commissioner')}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="af-ch-empty">
              <span className="af-ch-empty-mark af-num" aria-hidden>
                —
              </span>
              <p>
                {t(
                  'No commissioner is recorded on this league’s ingested teams. That is a gap in what the platform published, not a league without one.',
                )}
              </p>
            </div>
          )}
          {!league.native && access.some((a) => a.basis === 'platform') && access.some((a) => a.basis === 'allfantasy') ? (
            <p className="af-ch-access-note">
              {t(
                `Whoever imported this league runs it here on AllFantasy. ${platformName}’s own commissioner is listed as ${platformName} publishes it — rulings are still applied there.`,
              )}
            </p>
          ) : null}

          {/*
            The boundary the handoff asks to be stated. Worth saying plainly to a
            co-commissioner rather than discovering it at a 403.
          */}
          {role === 'co_commissioner' ? (
            <p className="af-ch-boundary">
              {t(
                'As a co-commissioner you can act on everything above, including @everyone announcements. You cannot transfer commissionership or remove the primary commissioner, and connecting Discord is left to the league owner.',
              )}
            </p>
          ) : null}
        </HubSection>
      </HubFold>

      {/* ── 7 · Charts (item 5) — large, so below the working sections ─── */}
      <HubFold id="ch-reports" title={t('League at a glance')}>
        <HubDepthGate depth={depth} id="ch-reports" what={t('League charts')} language={language}>
          {activity ? (
            <Suspense fallback={<ChartsFallback language={language} />}>
              <OperationalCharts data={data} activity={activity} language={language} />
            </Suspense>
          ) : null}
        </HubDepthGate>
      </HubFold>

      {/* ── 8 · Automations (item 8) ──────────────────────────────────── */}
      <HubFold id="ch-recipes" title={t('Automations')}>
        <HubDepthGate depth={depth} id="ch-recipes" what={t('Automations')} language={language}>
          <HubSection id="ch-recipes" title={t('Automations')}>
            <AutomationRecipes leagueId={league.id} recipes={data.recipes} />
          </HubSection>
        </HubDepthGate>
      </HubFold>

      {/* Lineup integrity — free for the latest week; the card names what the plan adds. ESPN reads the kickoff capture. */}
      {league.native || league.platform === 'sleeper' || league.platform === 'espn' ? (
        <HubFold id="ch-lineup-integrity" title={t('Lineup integrity')}>
          <HubSection id="ch-lineup-integrity" title={t('Lineup integrity')}>
            <LineupIntegrity leagueId={league.id} />
          </HubSection>
        </HubFold>
      ) : null}

      {/*
        Deadline autopilot — outside the depth gate on purpose: its list and "Remind now" are free,
        and the card itself says which part is the Commissioner plan (the route enforces it).
      */}
      <HubFold id="ch-deadlines" title={t('Deadline autopilot')}>
        <HubSection id="ch-deadlines" title={t('Deadline autopilot')}>
          <DeadlineAutopilot leagueId={league.id} />
        </HubSection>
      </HubFold>

      {/*
        Storyline Studio — outside the depth gate: the card reads the AF Commissioner plan itself and
        shows the upsell without it (the route enforces the plan). Every league: an AllFantasy league
        can post and auto-post; an imported one gets Copy, shaped for its own platform's chat.
      */}
      <HubFold id="ch-storylines" title={t('Storyline Studio')}>
        <HubSection id="ch-storylines" title={t('Storyline Studio')}>
          <StorylineStudio leagueId={league.id} />
        </HubSection>
      </HubFold>

      {/*
        Weekly recap review — outside the depth gate: editing the league's own recap before it posts
        is a free commissioner control. Only where a recap runs at all (Sleeper and AllFantasy-run).
      */}
      {league.native || league.platform === 'sleeper' ? (
        <HubFold id="ch-recap" title={t('Weekly recap')}>
          <HubSection id="ch-recap" title={t('Weekly recap')}>
            <WeeklyRecapReview leagueId={league.id} />
          </HubSection>
        </HubFold>
      ) : null}

      {/* ── 9 · Connections (item 9) ──────────────────────────────────── */}
      <HubFold id="ch-communities" title={t('Connections')}>
        <CommunityLinks
          data={data}
          language={language}
          announce={data.viewerCanBroadcast ? <AnnounceButton leagueId={league.id} /> : null}
        />
      </HubFold>

      {/* ── Public standings ────────────────────────────────────────── */}
      <HubFold id="ch-public" title={t('Public standings')} note={publicStandings.enabled ? t('Published') : t('Private')}>
      <section id="ch-public" className="af-card af-ch-section af-ch-publish" data-on={publicStandings.enabled}>
        <header className="af-ch-section-head">
          <h2 className="af-label">{t('Public standings')}</h2>
          <span className="af-ch-section-note" data-on={publicStandings.enabled}>
            {publicStandings.enabled ? t('Published') : t('Private')}
          </span>
        </header>

        {publicStandings.enabled ? (
          <p className="af-ch-publish-body">
            {t(
              'This league’s standings are readable by anyone with the link, without an account, and search engines are allowed to index them. Team names are published; manager names are not.',
            )}
          </p>
        ) : (
          <p className="af-ch-publish-body">
            {/*
              ⚠ THE COPY STATES WHAT PUBLISHING ACTUALLY DOES, NOT THAT IT IS A
              FEATURE. League and team names are user-authored and often
              personal; a commissioner turning this on is publishing twelve
              people's writing, and should be told that in the same sentence as
              the offer.
            */}
            {t('Off. Turning this on gives this league a public page at')} <code>{publicStandings.url}</code>{' '}
            {t(
              '— readable without an account and indexable by search engines. It publishes the league name, team names, records and points. It does not publish manager names.',
            )}
          </p>
        )}

        {/*
          The switch itself is a client island. Access was already decided
          server-side — this renders only inside the granted branch, and the
          route re-checks `requireCommissionerRole` regardless, so the component
          cannot grant what the gate did not.
        */}
        <PublishStandingsToggle leagueId={league.id} enabled={publicStandings.enabled} url={publicStandings.url} />
      </section>
      </HubFold>

      {/*
        ── 10 · Audit log (item 6) — the longest table, so last ────────────────────────────────────
        Recent changes lives here now (2026-11-14): it and the log listed the same syncs, in two places.
        It stays free; only the full log is behind the depth lock, as before.
      */}
      <HubFold id="ch-timeline" title={t('Audit log')}>
        <Suspense fallback={<RecentChangesFallback language={language} />}>
          <RecentChanges timeline={timeline} language={language} />
        </Suspense>
        <HubDepthGate depth={depth} id="ch-timeline" what={t('The full audit log')} language={language}>
          <Suspense fallback={<AuditTimelineFallback language={language} />}>
            <AuditTimeline timeline={timeline} language={language} />
          </Suspense>
        </HubDepthGate>
      </HubFold>

      <footer className="afh-foot">
        <p>
          {league.native
            ? t('This league runs on AllFantasy, so settings and rulings saved here are the league’s own.')
            : t(`AllFantasy reads this league. Settings and rulings are applied on ${platformName}.`)}{' '}
          {t('Health trends, manager intelligence and reports are in Commissioner OS.')}
        </p>
        <Link className="afh-link" href={data.chatHref}>
          {t('Open league chat →')}
        </Link>
        <CommissionerOsLink className="afh-link" href="/commissioner-os/league-health" leagueId={league.id}>
          {t('Health trends in Commissioner OS →')}
        </CommissionerOsLink>
      </footer>
    </div>
  )
}

/**
 * One cockpit count, drawn on the dark band. An unmeasured tile keeps its reason
 * at every width — "—" alone would read as a zero.
 */
function Tile({ tile, t }: { tile: CommissionerTile; t: (english: string | null | undefined) => string }) {
  if (!tile.state.available) {
    return (
      <div className="afh-tile" data-missing="true" data-key={tile.key}>
        <b>—</b>
        <span>{t(tile.label)}</span>
        <small>{t(tile.state.reason)}</small>
      </div>
    )
  }
  return (
    <div className="afh-tile" data-tone={tile.tone} data-key={tile.key}>
      <b>{tile.state.data.value}</b>
      <span>{t(tile.label)}</span>
      {tile.state.data.sub ? <small>{t(tile.state.data.sub)}</small> : null}
    </div>
  )
}

export default CommissionerHub

/**
 * One commissioner-depth section: drawn as-is when open, marked "Free until" before launch for a
 * viewer without the plan, and replaced by the lock after it. The lock keeps the section's `id` so
 * the jump links in the nav and the hero still land somewhere that explains itself.
 *
 * ⚠ A SERVER COMPONENT, SO NOT RENDERING A SECTION IS WHAT KEEPS ITS DATA OFF THE WIRE — nothing
 * here is serialised to the browser unless a client island below it is drawn.
 */
function HubDepthGate({
  depth,
  id,
  what,
  language,
  children,
}: {
  depth: CoreDepthAccess | null
  id: string
  /** Already in the reader's language (`hubCopy`), like the lock's own words. */
  what: string
  language: string
  children: ReactNode
}) {
  if (!depth) return <>{children}</>
  if (!depth.unlocked) {
    return (
      <div id={id} className="af-ch-depth-lock">
        <CoreDepthLock access={depth} what={what} lang={language} />
      </div>
    )
  }
  if (!depth.preLaunchFree) return <>{children}</>
  // One wrapper, so the note and its section stay ONE item in the hub's grids and splits.
  return (
    <div className="af-ch-depth-open">
      <FreeUntilNote access={depth} lang={language} />
      {children}
    </div>
  )
}
