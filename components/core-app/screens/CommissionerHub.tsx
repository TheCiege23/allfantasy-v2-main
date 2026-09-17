import Link from 'next/link'
import { Suspense } from 'react'
import '@/components/core-app/af-commish-hub.css'
import '@/components/core-app/af-format-hubs.css'
import { HubHeroMedia } from '@/components/core-app/hubs/HubHeroMedia'
import { CommissionerOsLink } from '@/components/core-app/hubs/CommissionerOsLink'
import { PublishStandingsToggle } from '@/components/core-app/PublishStandingsToggle'
import { WaiverOversight } from '@/components/core-app/WaiverOversight'
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
}

export function CommissionerHub({ data }: CommissionerHubProps) {
  if (!data.allowed) {
    return (
      <div className="af-ch afh" data-format="all">
        <Link className="afh-back" href="/core/commissioner">
          ← All leagues you run
        </Link>
        <header className="af-ch-head">
          <p className="af-label af-ch-eyebrow">Core · Commissioner</p>
          <h1 className="af-display af-ch-title">Commissioner</h1>
        </header>

        <div className="af-ch-blocked">
          <span className="af-ch-blocked-mark" aria-hidden>
            ⚑
          </span>
          <h2 className="af-ch-blocked-title">Commissioners and co-commissioners only</h2>
          <p className="af-ch-blocked-body">{data.reason}</p>
          {/*
            States what the viewer IS, not just what they are not. "You are a
            member of this league" is a different situation from "you are not in
            this league at all", and someone who hit this screen deserves to
            know which one they are looking at.
          */}
          <p className="af-ch-blocked-role">
            {data.role === 'member'
              ? `You are a member of ${data.leagueName}. Ask its commissioner to add you as a co-commissioner if you need this.`
              : data.role === 'viewer'
                ? `You have view-only access to ${data.leagueName}.`
                : `You are not a member of ${data.leagueName}.`}
          </p>
        </div>
      </div>
    )
  }

  const { league, role, tiles, settings, access, unread, disputes, publicStandings, art } = data
  const now = new Date()
  // Started here, awaited by the sections that show them — each inside its own boundary.
  const timeline = loadAuditTimeline(data.grant)
  const activity = loadActivityCharts(data.grant, now)
  const platformName = platformLabel(league.platform)
  const quiet = data.quietManagers

  return (
    <div className="af-ch afh" data-format="all" data-testid="commissioner-league-hub">
      <Link className="afh-back" href="/core/commissioner">
        ← All leagues you run
      </Link>

      <header className="afh-head">
        <div className="afh-title">
          <div className="afh-label">Core · Commissioner{art.label ? ` · ${art.label}` : ''}</div>
          <div className="afh-title-row">
            <span className="afh-badge" aria-hidden>
              ⚑
            </span>
            <h1>{league.name}</h1>
            <span className="af-ch-role af-label" data-role={role}>
              {role === 'commissioner' ? 'Commissioner' : 'Co-commissioner'}
            </span>
          </div>
          <p className="afh-desc">
            {league.native
              ? 'Everything it takes to run this league: what needs you, league health, the calendar, guides for the hard jobs, and a record of every change.'
              : `Everything it takes to run this league: what needs you, league health, the calendar, guides for the hard jobs, and a record of every change. AllFantasy reads ${platformName} — rules and rulings are still applied there.`}
          </p>
        </div>
        {data.viewerCanBroadcast ? (
          <div className="afh-head-actions">
            <AnnounceButton leagueId={league.id} label="Send @everyone" className="afh-btn" />
          </div>
        ) : null}
      </header>

      {/* ── Cockpit (item 1) — the tiles, carried by the key-art band ─────── */}
      <section
        className="afh-hero"
        data-kind="league"
        data-art={art.video ? 'loop' : 'still'}
        aria-label={`${league.name} right now`}
      >
        <HubHeroMedia video={art.video} poster={art.poster} />
        {art.video ? (
          <div className="afh-seal" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={art.poster} alt="" />
          </div>
        ) : null}
        <div className="afh-hero-body">
          <div className="afh-label">This league right now</div>
          <div className="afh-tiles">
            {tiles.map((t) => (
              <Tile key={t.key} tile={t} />
            ))}
          </div>
          {/* The names are the part a commissioner acts on — the count is already a tile. */}
          {quiet.length > 0 ? (
            <p className="afh-hero-note">
              Gone quiet: {quiet.slice(0, 4).join(', ')}
              {quiet.length > 4 ? ` and ${quiet.length - 4} more` : ''}. <a href="#ch-members">Member activity</a>
            </p>
          ) : null}
          {data.unclaimedTeams > 0 ? (
            <p className="afh-hero-note">
              {data.unclaimedTeams === 1 ? '1 team isn’t' : `${data.unclaimedTeams} teams aren’t`} connected to an
              AllFantasy account yet. <a href="#ch-areas">Invite managers</a>
            </p>
          ) : null}
        </div>
      </section>

      <HubNav />

      {/*
        ⚠ THE BANNER IS THE POINT, NOT DECORATION. Without it a league nobody has
        ever synced renders calm tiles — "0 unclaimed", "0 waiting on you", a
        healthy-looking screen assembled entirely out of the absence of data.
      */}
      {unread ? (
        <div className="af-ch-unread">
          <span className="af-label">Not measured yet</span>
          <p>
            This league has never synced, so nothing below has been checked. An empty task list here means we
            have not looked — not that the league is quiet.
          </p>
        </div>
      ) : null}

      {/* ── 1 · Urgent work (items 1, 10) ──────────────────────────────── */}
      <TaskCards data={data} />

      {/* ── 2 · Cockpit (item 1) — the tiles are in the band above ─────── */}
      <div className="af-ch-split">
        <Suspense fallback={<RecentChangesFallback />}>
          <RecentChanges timeline={timeline} />
        </Suspense>
        <MemberActivity data={data} />
      </div>

      {/* ── 3 · Health (item 7) ───────────────────────────────────────── */}
      <HealthPanel data={data} />

      {/* ── 4 · Calendar (item 3) ─────────────────────────────────────── */}
      <HubCalendar data={data} />

      {/* ── 5 · Guides (item 4) ───────────────────────────────────────── */}
      <HubSection id="ch-workflows" title="Step-by-step guides">
        <GuidedWorkflows workflows={data.workflows} />
      </HubSection>

      {/* ── 6 · Every league area (item 2) ────────────────────────────── */}
      <LeagueAreas data={data} />

      {/* ── Waiver oversight (handoff 2026-09-13) ─────────────────────── */}
      {data.waivers ? <WaiverOversight data={data.waivers} /> : null}

      <div className="af-ch-split">
        {/* ── How the league runs ────────────────────────────────────── */}
        <HubSection
          id="ch-rules"
          title="How this league runs"
          note={league.season != null ? <span className="af-num">{league.season}</span> : undefined}
        >
          <ul className="af-ch-settings">
            {settings.map((row) => (
              <li key={row.key}>
                <span className="af-ch-setting-key">{row.key}</span>
                {row.state.available ? (
                  <span className="af-ch-setting-value">{row.state.data}</span>
                ) : (
                  <span className="af-ch-setting-why">{row.state.reason}</span>
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
            <span className="af-label">Disputes</span>
            <p>{disputes.reason}</p>
          </div>
        </HubSection>

        {/* ── Access ────────────────────────────────────────────────── */}
        <HubSection
          id="ch-access"
          title="Who can run this league"
          note={`${access.length} ${access.length === 1 ? 'person' : 'people'}`}
        >
          {access.length > 0 ? (
            <ul className="af-ch-access">
              {access.map((a) => (
                <li key={`${a.role}-${a.handle}`}>
                  <span className="af-ch-access-mark af-num" aria-hidden>
                    {a.initials}
                  </span>
                  <span className="af-ch-access-name">
                    {a.handle}
                    {a.isYou ? <span className="af-ch-access-you"> · you</span> : null}
                  </span>
                  <span className="af-ch-access-role af-label" data-role={a.role}>
                    {a.role === 'commissioner' ? 'Commissioner' : 'Co-commissioner'}
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
                No commissioner is recorded on this league&apos;s ingested teams. That is a gap in what the
                platform published, not a league without one.
              </p>
            </div>
          )}

          {/*
            The boundary the handoff asks to be stated. Worth saying plainly to a
            co-commissioner rather than discovering it at a 403.
          */}
          {role === 'co_commissioner' ? (
            <p className="af-ch-boundary">
              As a co-commissioner you can act on everything above, including @everyone announcements. You
              cannot transfer commissionership or remove the primary commissioner, and connecting Discord is
              left to the league owner.
            </p>
          ) : null}
        </HubSection>
      </div>

      {/* ── 7 · Charts (item 5) — large, so below the working sections ─── */}
      <Suspense fallback={<ChartsFallback />}>
        <OperationalCharts data={data} activity={activity} />
      </Suspense>

      {/* ── 8 · Automations (item 8) ──────────────────────────────────── */}
      <HubSection id="ch-recipes" title="Automations">
        <AutomationRecipes leagueId={league.id} recipes={data.recipes} />
      </HubSection>

      {/* ── 9 · Connections (item 9) ──────────────────────────────────── */}
      <CommunityLinks
        data={data}
        announce={data.viewerCanBroadcast ? <AnnounceButton leagueId={league.id} /> : null}
      />

      {/* ── Public standings ────────────────────────────────────────── */}
      <section className="af-card af-ch-section af-ch-publish" data-on={publicStandings.enabled}>
        <header className="af-ch-section-head">
          <h2 className="af-label">Public standings</h2>
          <span className="af-ch-section-note" data-on={publicStandings.enabled}>
            {publicStandings.enabled ? 'Published' : 'Private'}
          </span>
        </header>

        {publicStandings.enabled ? (
          <p className="af-ch-publish-body">
            This league&apos;s standings are readable by anyone with the link, without an account, and search
            engines are allowed to index them. Team names are published; manager names are not.
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
            Off. Turning this on gives this league a public page at <code>{publicStandings.url}</code> — readable
            without an account and indexable by search engines. It publishes the league name, team names, records
            and points. It does not publish manager names.
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
      <Suspense fallback={<AuditTimelineFallback />}>
        <AuditTimeline timeline={timeline} />
      </Suspense>

      <footer className="afh-foot">
        <p>
          {league.native
            ? 'This league runs on AllFantasy, so settings and rulings saved here are the league’s own.'
            : `AllFantasy reads this league. Settings and rulings are applied on ${platformName}.`}
          {data.viewerIsOwner ? ' Health trends, manager intelligence and reports are in Commissioner OS.' : ''}
        </p>
        <Link className="afh-link" href={data.chatHref}>
          Open league chat →
        </Link>
        {/*
          Commissioner OS admits the league owner only (`resolveActiveLeagueId`), so
          a co-commissioner is not sent to a screen that would turn them away.
        */}
        {data.viewerIsOwner ? (
          <CommissionerOsLink className="afh-link" href="/commissioner-os/league-health" leagueId={league.id}>
            Health trends in Commissioner OS →
          </CommissionerOsLink>
        ) : null}
      </footer>
    </div>
  )
}

/**
 * One cockpit count, drawn on the dark band. An unmeasured tile keeps its reason
 * at every width — "—" alone would read as a zero.
 */
function Tile({ tile }: { tile: CommissionerTile }) {
  if (!tile.state.available) {
    return (
      <div className="afh-tile" data-missing="true" data-key={tile.key}>
        <b>—</b>
        <span>{tile.label}</span>
        <small>{tile.state.reason}</small>
      </div>
    )
  }
  return (
    <div className="afh-tile" data-tone={tile.tone} data-key={tile.key}>
      <b>{tile.state.data.value}</b>
      <span>{tile.label}</span>
      {tile.state.data.sub ? <small>{tile.state.data.sub}</small> : null}
    </div>
  )
}

export default CommissionerHub
