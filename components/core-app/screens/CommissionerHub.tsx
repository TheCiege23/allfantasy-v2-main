import CommissionerActionQueue from '@/components/core-app/CommissionerActionQueue'
import { NativeAutoSubsCommissioner } from '@/components/core-app/NativeAutoSubsControls'
import Link from 'next/link'
import { Suspense, type ReactNode } from 'react'
import '@/components/core-app/af-commish-hub.css'
import '@/components/core-app/af-format-hubs.css'
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
  OperationalCharts,
  RecentChanges,
  RecentChangesFallback,
} from '@/components/core-app/commissioner/HubReports'
import { GuidedWorkflows } from '@/components/core-app/commissioner/GuidedWorkflows'
import { AutomationRecipes } from '@/components/core-app/commissioner/AutomationRecipes'
import { AnnounceButton } from '@/components/core-app/commissioner/AnnounceButton'
import { FormatTemplateControl } from '@/components/core-app/commissioner/FormatTemplateControl'
import { CoreDepthLock, FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { StandingsLineups } from '@/lib/core-app/standingsLineups'
import { WeekLineupsBody } from '@/components/core-app/standings/WeekLineupsTable'
import { hubCopy, hubDateLocale } from '@/lib/core-app/commissionerHubCopy'

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

export type CommissionerHubProps = {
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
  const activity = depthOpen ? loadActivityCharts(data.grant, now) : null
  const platformName = platformLabel(league.platform)
  const quiet = data.quietManagers

  return (
    <div className="af-ch afh" data-format="all" data-testid="commissioner-league-hub">
      <Link className="afh-back" href="/core/commissioner">
        {t('← All leagues you run')}
      </Link>

      <header className="afh-head">
        <div className="afh-title">
          <div className="afh-label">
            {t('Core · Commissioner')}
            {art.label ? ` · ${t(art.label)}` : ''}
          </div>
          <div className="afh-title-row">
            <span className="afh-badge" aria-hidden>
              ⚑
            </span>
            <h1>{league.name}</h1>
            <span className="af-ch-role af-label" data-role={role}>
              {role === 'commissioner' ? t('Commissioner') : t('Co-commissioner')}
            </span>
          </div>
          <p className="afh-desc">
            {league.native
              ? t('Everything it takes to run this league: what needs you, league health, the calendar, guides for the hard jobs, and a record of every change.')
              : t(`Everything it takes to run this league: what needs you, league health, the calendar, guides for the hard jobs, and a record of every change. AllFantasy reads ${platformName} — rules and rulings are still applied there.`)}
          </p>
        </div>
        {data.viewerCanBroadcast ? (
          <div className="afh-head-actions">
            <AnnounceButton leagueId={league.id} label={t('Send @everyone')} className="afh-btn" />
          </div>
        ) : null}
      </header>

      <Link className="afh-btn" href="/tournament-hub">
        {t('Multi-league tournaments and weekly reports →')}
      </Link>

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
            {tiles.map((tile) => (
              <Tile key={tile.key} tile={tile} t={t} />
            ))}
          </div>
          {/* The names are the part a commissioner acts on — the count is already a tile. */}
          {quiet.length > 0 ? (
            <p className="afh-hero-note">
              {t('Gone quiet:')} {quiet.slice(0, 4).join(', ')}
              {quiet.length > 4 ? t(` and ${quiet.length - 4} more`) : ''}. <a href="#ch-members">{t('Member activity')}</a>
            </p>
          ) : null}
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

      {/* ── 1 · Urgent work (items 1, 10) ──────────────────────────────── */}
      <TaskCards data={data} language={language} />
      {data.role === 'commissioner' && <CommissionerActionQueue leagueId={league.id} />}
      {league.native && data.role === 'commissioner' && <NativeAutoSubsCommissioner leagueId={league.id} />}

      <HubSection id="ch-intelligence" title={t('Commissioner intelligence')}>
        <CommissionerOsActionsSummary leagueId={league.id} sport={league.sport} />
        <CommissionerChimmy leagueId={league.id} />
      </HubSection>

      <HubSection id="ch-format-ops" title={t('Format operations')}>
        {data.network && (
          <p className="af-ch-muted">
            {t('Network:')} <Link href="/commissioner-os/networks">{data.network.name}</Link> · {t(data.network.role)}
          </p>
        )}
        {data.formatCards.length ? (
          <ul className="af-ch-areas">
            {data.formatCards.map((card) => (
              <li key={card.key}>
                <strong>{t(card.title)}</strong>
                <p>{t(card.detail)}</p>
                <Link href={card.href}>{t(card.action)} →</Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="af-ch-muted">
            {t('No specialty mechanics were resolved for this league. Review league settings before applying format-specific rules.')}
          </p>
        )}
        {/* The owner's statement of how the league is really run, which no platform publishes. */}
        {data.formatTemplate ? <FormatTemplateControl leagueId={league.id} template={data.formatTemplate} /> : null}
      </HubSection>

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
      </HubSection>

      {/* ── 2 · Cockpit (item 1) — the tiles are in the band above ─────── */}
      <div className="af-ch-split">
        <Suspense fallback={<RecentChangesFallback language={language} />}>
          <RecentChanges timeline={timeline} language={language} />
        </Suspense>
        <HubDepthGate depth={depth} id="ch-members" what={t('Member activity')}>
          <MemberActivity data={data} language={language} />
        </HubDepthGate>
      </div>

      {/* ── 3 · Health (item 7) ───────────────────────────────────────── */}
      <HealthPanel data={data} language={language} />

      {/* ── 4 · Calendar (item 3) ─────────────────────────────────────── */}
      <HubCalendar data={data} language={language} />

      {/* ── 5 · Guides (item 4) ───────────────────────────────────────── */}
      <HubSection id="ch-workflows" title={t('Step-by-step guides')}>
        <GuidedWorkflows workflows={data.workflows} />
      </HubSection>

      {/* ── 6 · Every league area (item 2) ────────────────────────────── */}
      <LeagueAreas data={data} language={language} />

      {/* ── This week's lineups, projected (AF beside API, 2026-09-30) ── */}
      {lineups ? (
        <HubSection
          id="ch-lineups"
          title={t('This week’s lineups, projected')}
          note={<span className="af-num">{t(`week ${lineups.week}`)}</span>}
          className="af-ch-lineups"
        >
          <WeekLineupsBody lineups={lineups} caveat={t('nothing here changes a standing or a ruling.')} />
        </HubSection>
      ) : null}

      {/* ── Waiver oversight (handoff 2026-09-13) ─────────────────────── */}
      <HubDepthGate depth={depth} id="ch-waivers" what={t('Waiver oversight')}>
        {data.waivers ? <WaiverOversight data={data.waivers} /> : null}
      </HubDepthGate>

      <div className="af-ch-split">
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
        </HubSection>

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
      </div>

      {/* ── 7 · Charts (item 5) — large, so below the working sections ─── */}
      <HubDepthGate depth={depth} id="ch-reports" what={t('League charts')}>
        {activity ? (
          <Suspense fallback={<ChartsFallback language={language} />}>
            <OperationalCharts data={data} activity={activity} language={language} />
          </Suspense>
        ) : null}
      </HubDepthGate>

      {/* ── 8 · Automations (item 8) ──────────────────────────────────── */}
      <HubDepthGate depth={depth} id="ch-recipes" what={t('Automations')}>
        <HubSection id="ch-recipes" title={t('Automations')}>
          <AutomationRecipes leagueId={league.id} recipes={data.recipes} />
        </HubSection>
      </HubDepthGate>

      {/* ── 9 · Connections (item 9) ──────────────────────────────────── */}
      <CommunityLinks
        data={data}
        language={language}
        announce={data.viewerCanBroadcast ? <AnnounceButton leagueId={league.id} /> : null}
      />

      {/* ── Public standings ────────────────────────────────────────── */}
      <section className="af-card af-ch-section af-ch-publish" data-on={publicStandings.enabled}>
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

      {/* ── 10 · Audit log (item 6) — the longest table, so last ────────── */}
      <HubDepthGate depth={depth} id="ch-timeline" what={t('The full audit log')}>
        <Suspense fallback={<AuditTimelineFallback language={language} />}>
          <AuditTimeline timeline={timeline} language={language} />
        </Suspense>
      </HubDepthGate>

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
  children,
}: {
  depth: CoreDepthAccess | null
  id: string
  what: string
  children: ReactNode
}) {
  if (!depth) return <>{children}</>
  if (!depth.unlocked) {
    return (
      <div id={id} className="af-ch-depth-lock">
        <CoreDepthLock access={depth} what={what} />
      </div>
    )
  }
  if (!depth.preLaunchFree) return <>{children}</>
  // One wrapper, so the note and its section stay ONE item in the hub's grids and splits.
  return (
    <div className="af-ch-depth-open">
      <FreeUntilNote access={depth} />
      {children}
    </div>
  )
}
