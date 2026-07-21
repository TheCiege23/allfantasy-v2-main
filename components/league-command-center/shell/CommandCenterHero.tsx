import Link from 'next/link'
import {
  COMMAND_CENTER_NAV,
  type CommandCenterSectionId,
  type CommandCenterViewModel,
  type SeasonPhase,
} from '@/lib/league-command-center/types'
import { Badge } from '../primitives/Panel'

/**
 * League hero — identity, provenance, and the viewer's own standing.
 *
 * Every value here is real or absent. `managerCount` of 0, a null commissioner,
 * or an unresolved week each render as an explicit gap rather than a plausible
 * placeholder, because this strip is what a user trusts to tell them which
 * league they are looking at and how current it is.
 *
 * Two things the design mockup shows are deliberately NOT rendered, because no
 * column backs them and inventing either would undermine the rest of the strip:
 *
 *  - **A week date range** ("Oct 20 – Oct 26"). The view model resolves a week
 *    number, not the calendar window it maps to, and that window is sport- and
 *    season-specific.
 *  - **A division label** ("North Division"). Divisions are not part of
 *    `CommandCenterLeagueIdentity`.
 */

const PHASE_LABEL: Record<SeasonPhase, string> = {
  preseason: 'Preseason',
  in_season: 'Regular Season',
  playoffs: 'Playoffs',
  offseason: 'Offseason',
}

export function CommandCenterHero({
  viewModel,
  activeSection,
}: {
  viewModel: CommandCenterViewModel
  activeSection: CommandCenterSectionId
}) {
  const { league, source, viewer, seasonPhase } = viewModel

  /*
   * Dual-role mode. Which "mode" the commissioner is in is derived from the
   * active section's own `requiresCommissioner` flag — one source of truth, so
   * the switcher and the sidebar can never disagree about what counts as a
   * commissioner surface. The switcher itself is the guarantee that commissioner
   * mode never *replaces* the manager experience: My Team (the personal-first
   * `overview` and its siblings) is always one click away.
   */
  const activeNav = COMMAND_CENTER_NAV.find((item) => item.id === activeSection)
  const inCommissionerMode = activeNav?.requiresCommissioner ?? false
  const ccBase = `/league/${league.leagueId}/command-center`

  const initials = league.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()

  const recordLabel = viewer.record
    ? `${viewer.record.wins}-${viewer.record.losses}${viewer.record.ties > 0 ? `-${viewer.record.ties}` : ''}`
    : null

  return (
    <header className="af-cc__hero">
      <div className="af-cc__hero-glow" aria-hidden="true" />
      <div className="af-cc__hero-inner">
        <div className="af-cc__hero-logo">
          {league.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- provider-hosted logo on an arbitrary remote host; next/image would require per-provider remotePatterns.
            <img src={league.logoUrl} alt="" />
          ) : (
            <span aria-hidden="true">{initials || '—'}</span>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="af-cc-row" style={{ gap: 9, marginBottom: 6 }}>
            <Badge tone={source.isNative ? 'brand' : 'neutral'}>{source.label}</Badge>
            <Badge tone="neutral">{source.kindLabel}</Badge>
            {/*
              Read-only is stated on the hero, not buried in a capability note,
              because it changes what every control on the page can do. It is
              derived from the same `isNative` flag the capability resolver uses,
              so the badge and the controls cannot disagree.
            */}
            {!source.isNative ? (
              <Badge tone="ops" icon="ph-lock-simple">
                Read only
              </Badge>
            ) : null}
            <Badge tone="brand">{league.scoringFormatLabel}</Badge>
          </div>

          <div className="af-cc-row" style={{ gap: 10, margin: '0 0 6px' }}>
            <h1 className="af-cc__hero-title">{league.name}</h1>
            {viewer.isCommissioner ? (
              <Badge tone="ops" icon="ph-crown-simple">
                Commissioner
              </Badge>
            ) : null}
          </div>

          <div className="af-cc__hero-meta">
            <span>
              <i className="ph ph-users-three" aria-hidden="true" />
              {league.managerCount > 0
                ? `${league.managerCount} manager${league.managerCount === 1 ? '' : 's'}`
                : 'Managers unavailable'}
            </span>
            {league.commissionerName ? (
              <span>
                <i className="ph ph-crown-simple" aria-hidden="true" />
                Commish: {league.commissionerName}
              </span>
            ) : null}
            {league.rosterSize ? (
              <span>
                <i className="ph ph-identification-card" aria-hidden="true" />
                {league.rosterSize} roster spots
              </span>
            ) : null}
            {league.playoffFormatLabel ? (
              <span>
                <i className="ph ph-trophy" aria-hidden="true" />
                {league.playoffFormatLabel}
              </span>
            ) : null}
            {league.tradeDeadlineLabel ? (
              <span>
                <i className="ph ph-arrows-left-right" aria-hidden="true" />
                {league.tradeDeadlineLabel}
              </span>
            ) : null}
            {recordLabel ? (
              <span>
                <i className="ph ph-chart-line-up" aria-hidden="true" />
                Your record: {recordLabel}
                {viewer.standingsPosition ? ` · #${viewer.standingsPosition}` : ''}
              </span>
            ) : null}
          </div>
        </div>

        {/*
          Week card. `currentWeek` is `number | null` by contract and is never
          defaulted to 1 — an unresolved week says so, because "Week 1" on a
          league in week 8 is worse than no week at all.
        */}
        <div className="af-cc__hero-week">
          <span className="af-cc__hero-week-eyebrow">{PHASE_LABEL[seasonPhase]}</span>
          <span className="af-cc__hero-week-value">
            {league.currentWeek ? `Week ${league.currentWeek}` : 'Week —'}
          </span>
          <span className="af-cc__hero-week-season">{league.seasonLabel}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 'none', alignSelf: 'flex-start' }}>
          {/*
            Dual-role switcher. Rendered only for commissioners — a plain manager
            has no commissioner mode to switch into. It never hides the manager
            experience; it moves between it (My Team) and the additive ops layer
            (Commissioner HQ).
          */}
          {viewer.isCommissioner ? (
            <div className="af-cc-roleswitch" role="group" aria-label="View mode">
              <Link
                href={`${ccBase}?section=overview`}
                className="af-cc-roleswitch__seg"
                data-active={!inCommissionerMode}
                aria-current={!inCommissionerMode ? 'true' : undefined}
                data-testid="cc-roleswitch-my-team"
              >
                <i className="ph ph-user-focus" aria-hidden="true" />
                My Team
              </Link>
              <Link
                href={`${ccBase}?section=attention`}
                className="af-cc-roleswitch__seg"
                data-active={inCommissionerMode}
                aria-current={inCommissionerMode ? 'true' : undefined}
                data-testid="cc-roleswitch-commissioner"
              >
                <i className="ph ph-crown-simple" aria-hidden="true" />
                Commissioner HQ
              </Link>
            </div>
          ) : null}

          <Link
            href={`/league/${league.leagueId}`}
            className="af-cc-action"
            style={{ background: 'rgba(28,30,43,.6)', backdropFilter: 'blur(6px)' }}
          >
            <i className="ph ph-arrow-u-up-left" aria-hidden="true" />
            Classic view
          </Link>
        </div>
      </div>
    </header>
  )
}

export default CommandCenterHero
