import type { Metadata } from 'next'
import { V3PageShell, V3Section } from '@/components/landing/v3/V3PageShell'
import { V3 } from '@/components/landing/v3/copy'

export const metadata: Metadata = {
  title: 'Features | AllFantasy',
  description:
    'The connected systems behind AllFantasy — Decision, Commissioner, Manager, Trade, Waiver and Draft tools, plus Chimmy Intelligence, Rankings and Legacy.',
}

export default function FeaturesPage() {
  return (
    <V3PageShell
      title="One system, many surfaces"
      lead="Each part of AllFantasy reads the same league data, so a waiver recommendation knows about your trade talks and your draft board knows about your roster holes."
    >
      {V3.os.cards.map((card) => (
        <V3Section key={card.name} title={card.name}>
          <p>{card.desc}</p>
          <p style={{ color: 'var(--text-4)', fontStyle: 'italic' }}>{card.example}</p>
        </V3Section>
      ))}

      <V3Section title="Read-only, always">
        <p>
          None of these systems write to your league on another platform. They analyze, recommend, and link you to the
          exact page where you take the action yourself.
        </p>
      </V3Section>
    </V3PageShell>
  )
}
