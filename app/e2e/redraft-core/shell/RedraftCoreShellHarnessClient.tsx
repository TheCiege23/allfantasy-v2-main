'use client'

import AfCoreShell, { type CoreNavKey } from '@/components/core-app/AfCoreShell'
import { coreShellRedraftSport } from '@/lib/core-app/coreShellRedraftIdentity'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

/** Screens the /core shell renders for a native league (home redirects to /league/[id] — see the page). */
const SCREENS: CoreNavKey[] = ['my-team', 'matchup', 'waivers', 'trades', 'players', 'draft-hq', 'week', 'season-outlook']

type Props = { sport: string; platform: string; leagueType: string; identityOff: boolean; screen: string }

/**
 * Harness only (app/e2e is 404 in production). The chrome — root attributes, sidebar, top bar, league
 * switcher, rail, phone tab bar — is the real AfCoreShell; the body is a labelled FIXTURE of card and
 * page-ground text so the tokens can be judged on both grounds. It is not any /core screen.
 */
export default function RedraftCoreShellHarnessClient(props: Props) {
  const sport = normalizeToSupportedSport(props.sport)
  const league = { id: 'e2e-redraft-core', name: 'Sunday Night Redraft', platform: props.platform, mark: 'SN', sport }
  const other = { id: 'e2e-redraft-core-2', name: 'Office Dynasty', platform: 'sleeper', mark: 'OD', sport: 'NFL' }
  const redraftSport = props.identityOff
    ? null
    : coreShellRedraftSport({ platform: props.platform, sport, leagueType: props.leagueType })
  const active = (SCREENS as string[]).includes(props.screen) ? (props.screen as CoreNavKey) : 'my-team'
  return (
    <AfCoreShell
      active={active}
      leagues={[league, other]}
      selectedLeagueId={league.id}
      nativeLeague
      redraftSport={redraftSport}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: league.id, label: league.name, favoriteIds: [], leagues: [league, other] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
      railMatchups={{ [league.id]: { yourTeam: 'Ciege Squad', yourAvatarUrl: null, yourScore: 112.4, opponentTeam: 'Hardwood Heroes', opponentAvatarUrl: null, opponentScore: 104.2, scored: true, week: 9 } } as never}
    >
      <div data-testid="redraft-core-fixture" style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
        <p className="af-eyebrow">Harness fixture · page ground ({redraftSport ?? 'default look'})</p>
        <section className="af-card" style={{ padding: 18 }}>
          <h2 style={{ margin: '0 0 6px' }}>Card heading on --surface</h2>
          <p style={{ color: 'var(--text2)', margin: '0 0 12px' }}>Secondary text on a card. The link and the primary button read the re-pointed accent.</p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="af-btn">Primary action</button>
            <button type="button" className="af-btn af-btn--ghost">Secondary</button>
            <a href="#fixture" style={{ color: 'var(--accent)', fontWeight: 700 }}>Accent link →</a>
          </div>
        </section>
        <p style={{ color: 'var(--text2)' }}>Page-ground body text (--text2 over the art and the hero wash).</p>
      </div>
    </AfCoreShell>
  )
}
