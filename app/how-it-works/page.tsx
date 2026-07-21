import type { Metadata } from 'next'
import { V3PageShell, V3Section } from '@/components/landing/v3/V3PageShell'

export const metadata: Metadata = {
  title: 'How AllFantasy Works | AllFantasy',
  description:
    'AllFantasy connects to the fantasy platforms you already use, reads your league data, and shows you exactly what to do and where to go. Read-only by design.',
}

export default function HowItWorksPage() {
  return (
    <V3PageShell
      title="How AllFantasy works"
      lead="We connect to the platforms you already play on, read your league data, and turn it into clear next actions — without ever changing anything on your behalf."
    >
      <V3Section title="1. We read your data">
        <p>
          You connect a league by giving us the least access that works: a public Sleeper username, an ESPN league ID,
          or a Yahoo OAuth approval you complete on Yahoo&rsquo;s own site. We never ask for a password to another
          platform.
        </p>
      </V3Section>

      <V3Section title="2. We analyze it against your actual settings">
        <p>
          Scoring format, roster construction, league history, transactions, injuries, and schedule all feed the same
          model. A recommendation for a Half-PPR TE-premium league is not the same as one for standard scoring, and we
          treat it that way.
        </p>
      </V3Section>

      <V3Section title="3. We tell you what to do — and why">
        <p>
          Every recommendation shows its reasoning and a confidence level. You are never asked to trust a number with no
          explanation behind it.
        </p>
      </V3Section>

      <V3Section title="4. We send you to the right page to do it">
        <p>
          AllFantasy cannot set your lineup, accept a trade, or submit a waiver claim on another platform — and we do
          not pretend otherwise. Instead, every recommendation links straight to the exact page on the original site
          where you complete the action yourself. You stay in control of every change to your league.
        </p>
      </V3Section>

      <V3Section title="What we cannot do">
        <p>
          We cannot set lineups, accept or reject trades, draft players, change league settings, submit waiver claims,
          or edit anything on another company&rsquo;s platform. Read-only access is a deliberate product decision, not a
          limitation we are working around.
        </p>
      </V3Section>
    </V3PageShell>
  )
}
