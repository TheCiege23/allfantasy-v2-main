import type { Metadata } from 'next'
import { V3PageShell, V3Section } from '@/components/landing/v3/V3PageShell'

export const metadata: Metadata = {
  title: 'Roadmap | AllFantasy',
  description: "What AllFantasy is building next.",
}

export default function RoadmapPage() {
  return (
    <V3PageShell
      status="building"
      title="Roadmap"
      lead="A public roadmap is coming. Here is what we can say concretely today."
    >
      <V3Section title="In progress">
        <p>
          Import support for Fantrax, MyFantasyLeague, and Fleaflicker. These are listed on the homepage as coming soon
          rather than supported, because they are not connectable yet.
        </p>
      </V3Section>
      <V3Section title="Available today">
        <p>Sleeper, ESPN, and Yahoo imports, plus native AllFantasy leagues with full commissioner tools.</p>
      </V3Section>
    </V3PageShell>
  )
}
