import Link from 'next/link'
import {
  COMMAND_CENTER_NAV,
  hasCommissionerAuthority,
  type CommandCenterSectionId,
  type CommandCenterViewModel,
} from '@/lib/league-command-center/types'
import { KeyValueList, Panel } from '../primitives/Panel'

/**
 * Left rail — navigation plus at-a-glance league facts.
 *
 * Navigation is a set of real `<Link>`s to `?section=…`, not client state. The
 * URL is the single source of truth for the active section.
 *
 * That choice is deliberate. `LeagueShell` mirrors its active tab into React
 * state AND back into the URL, and the resulting two-way binding produced a
 * Draft↔League infinite-swap flicker that needed a dedicated echo guard
 * (`lib/league/leagueTabSync.ts`) to contain. A one-way read from the URL
 * cannot echo, so that class of bug cannot occur here.
 */
export function CommandCenterSidebar({
  viewModel,
  activeSection,
}: {
  viewModel: CommandCenterViewModel
  activeSection: CommandCenterSectionId
}) {
  const { league, source, viewer } = viewModel
  const canSeeCommissionerNav = hasCommissionerAuthority(viewer.role)

  const visibleNav = COMMAND_CENTER_NAV.filter(
    (item) => !item.requiresCommissioner || canSeeCommissionerNav,
  )

  const trustTone =
    source.trustStatus === 'stale' || source.trustStatus === 'unknown'
      ? 'bad'
      : source.trustStatus === 'delayed'
        ? 'warn'
        : 'good'

  const { adminPreview } = viewModel

  return (
    <div className="af-cc__rail">
      {/*
        * Admin role preview. Renders ONLY when the server proved site-admin
        * status (`getAdminAccessState`) — the prototype's `?admin=` URL check is
        * deliberately not reproduced. Options are limited to roles at or below
        * the admin's real role in THIS league, so the control cannot be used to
        * reach commissioner-only data they do not otherwise have.
        */}
      {adminPreview.isAdmin && adminPreview.availableRoles.length > 1 ? (
        <Panel title="View as (admin)">
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {adminPreview.availableRoles.map((role) => {
              const isActive = role === viewer.role
              const label =
                role === 'commissioner'
                  ? 'Commissioner'
                  : role === 'co_commissioner'
                    ? 'Co-commish'
                    : 'Manager'
              const href =
                role === adminPreview.realRole
                  ? `/league/${league.leagueId}/command-center?section=${activeSection}`
                  : `/league/${league.leagueId}/command-center?section=${activeSection}&viewAs=${role}`
              return (
                <Link
                  key={role}
                  href={href}
                  className="af-cc-chip"
                  aria-current={isActive ? 'true' : undefined}
                  data-testid={`cc-viewas-${role}`}
                  style={
                    isActive
                      ? { borderColor: 'var(--cc-ops)', background: 'var(--cc-ops-wash)', color: 'var(--cc-ops)' }
                      : undefined
                  }
                >
                  {label}
                </Link>
              )
            })}
          </div>
          <p style={{ fontSize: 10.5, color: 'var(--cc-text-5)', margin: '10px 0 0', lineHeight: 1.5 }}>
            {adminPreview.previewActive
              ? `Previewing a narrower role. You are actually ${
                  adminPreview.realRole === 'commissioner' ? 'the commissioner' : 'a co-commissioner'
                } here.`
              : 'A preview can only show a narrower role than you hold in this league — it never grants access.'}
          </p>
        </Panel>
      ) : null}

      <Panel title="Navigate">
        <nav className="af-cc-nav" aria-label="Command Center sections">
          {visibleNav.map((item) => {
            const isActive = item.id === activeSection
            return (
              <Link
                key={item.id}
                href={`/league/${league.leagueId}/command-center?section=${item.id}`}
                className="af-cc-nav__item"
                aria-current={isActive ? 'page' : undefined}
                data-testid={`cc-nav-${item.id}`}
              >
                <i className={`ph ${item.icon}`} aria-hidden="true" />
                <span>{item.label}</span>
                {!item.implemented ? <span className="af-cc-nav__soon">Soon</span> : null}
              </Link>
            )
          })}
        </nav>
      </Panel>

      <Panel title="League info">
        <KeyValueList
          rows={[
            { label: 'Platform', value: `${source.label} · ${source.kindLabel}` },
            { label: 'Format', value: league.scoringFormatLabel },
            { label: 'Roster size', value: league.rosterSize ?? null },
            { label: 'Playoffs', value: league.playoffFormatLabel },
            { label: 'Trade deadline', value: league.tradeDeadlineLabel },
            {
              label: source.isNative ? 'Data' : 'Last sync',
              value: source.trustDetail,
              tone: trustTone,
            },
          ]}
        />
      </Panel>

      <Panel title="Your team">
        <KeyValueList
          rows={[
            { label: 'Team', value: viewer.teamName },
            {
              label: 'Record',
              value: viewer.record
                ? `${viewer.record.wins}-${viewer.record.losses}${
                    viewer.record.ties > 0 ? `-${viewer.record.ties}` : ''
                  }`
                : null,
            },
            { label: 'Standing', value: viewer.standingsPosition ? `#${viewer.standingsPosition}` : null },
            {
              label: 'Role',
              value:
                viewer.role === 'commissioner'
                  ? 'Commissioner'
                  : viewer.role === 'co_commissioner'
                    ? 'Co-commissioner'
                    : 'Manager',
            },
          ]}
        />
      </Panel>
    </div>
  )
}

export default CommandCenterSidebar
