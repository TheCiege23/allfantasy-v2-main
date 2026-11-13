'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import Dashboard3A from '@/components/core-app/screens/Dashboard3A'

/**
 * Harness only (app/e2e is 404 in production). The real AfCoreShell with Home active and no league
 * selected, around the real Dashboard3A layout. The cards are labelled PLACEHOLDERS standing in for
 * the real ones — this page exists to check the columns, not the card contents.
 */
function Placeholder({ label, height }: { label: string; height: number }) {
  return (
    <section className="af3a-card" data-testid={`placeholder-${label}`} style={{ minHeight: height }}>
      <header className="af3a-cardhead">
        <span className="af3a-label">{label.toUpperCase()}</span>
      </header>
      <p style={{ opacity: 0.6 }}>Placeholder for the {label} card.</p>
    </section>
  )
}

export default function HomeLayoutHarnessClient({ main, side }: { main: boolean; side: boolean }) {
  const mainKeys = main ? (['routine', 'matchups'] as const) : ([] as const)
  const sideKeys = side ? (['chimmy', 'career', 'rivals'] as const) : ([] as const)
  return (
    <AfCoreShell
      active="home"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <Dashboard3A
        nowLabel="just now"
        order={{ main: [...mainKeys], side: [...sideKeys], stack: [] }}
        slots={{
          routine: main ? <Placeholder label="routine" height={150} /> : null,
          issues: null,
          matchups: main ? <Placeholder label="matchups" height={160} /> : null,
          chimmy: <Placeholder label="chimmy" height={140} />,
          career: <Placeholder label="career" height={150} />,
          rivals: <Placeholder label="rivals" height={150} />,
          portfolioChart: null,
          exposure: null,
          following: null,
          receipts: null,
          leagues: <Placeholder label="leagues" height={180} />,
        }}
      />
    </AfCoreShell>
  )
}
