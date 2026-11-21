'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'

/** The shell around a SAMPLE screen body, with the strip pointed at `/core/<screen>`. */
export default function ScreenGuideHarnessClient({ screen }: { screen: string }) {
  return (
    <AfCoreShell
      active="home"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
      screenGuidePath={screen ? `/core/${screen}` : '/core'}
    >
      <div data-testid="screen-guide-harness" style={{ padding: 24, border: '1px dashed var(--line2)', borderRadius: 14, color: 'var(--muted)' }}>
        <h1 style={{ margin: 0, color: 'var(--text)', fontSize: 22 }}>Sample screen</h1>
        <p>The screen’s own content renders here. Sample placeholder.</p>
      </div>
    </AfCoreShell>
  )
}
