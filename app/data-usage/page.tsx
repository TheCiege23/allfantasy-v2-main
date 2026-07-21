import type { Metadata } from 'next'
import Link from 'next/link'
import { V3PageShell, V3Section } from '@/components/landing/v3/V3PageShell'

export const metadata: Metadata = {
  title: 'Data Usage | AllFantasy',
  description: 'What league data AllFantasy reads and what it is used for.',
}

export default function DataUsagePage() {
  return (
    <V3PageShell
      status="building"
      title="Data usage"
      lead="A detailed data-usage breakdown is being written. The summary below reflects how the product works today."
    >
      <V3Section title="What we read">
        <p>
          League settings and scoring format, rosters, transactions, matchups and results, and public player data. This
          is what makes a recommendation specific to the league you are asking about rather than generic advice.
        </p>
      </V3Section>

      <V3Section title="What we do with it">
        <p>
          We analyze it to produce the insights and recommendations you see in your dashboard. We do not modify your
          leagues on other platforms.
        </p>
      </V3Section>

      <V3Section title="Removing your data">
        <p>
          You can request deletion at any time through{' '}
          <Link href="/data-deletion" style={{ color: 'var(--purple-bright)' }}>
            data deletion
          </Link>
          , and our{' '}
          <Link href="/privacy" style={{ color: 'var(--purple-bright)' }}>
            Privacy Policy
          </Link>{' '}
          covers handling in full.
        </p>
      </V3Section>
    </V3PageShell>
  )
}
