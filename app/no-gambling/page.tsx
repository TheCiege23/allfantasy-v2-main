import type { Metadata } from 'next'
import Link from 'next/link'
import { V3PageShell, V3Section } from '@/components/landing/v3/V3PageShell'

export const metadata: Metadata = {
  title: 'No Gambling Policy | AllFantasy',
  description: 'AllFantasy is a league management and analytics platform, not a gambling service.',
}

/**
 * Restates the position already published in the site footer. The formal policy
 * document is not written yet, so this is marked as in progress rather than
 * presented as a complete legal policy — do not expand it into invented legal
 * terms.
 */
export default function NoGamblingPage() {
  return (
    <V3PageShell
      status="building"
      title="No gambling policy"
      lead="The full policy document is being finalized. Our position is unambiguous and stated below."
    >
      <V3Section title="What AllFantasy is">
        <p>
          AllFantasy is a league management and analytics platform. It is not a gambling service. We do not accept
          wagers, operate contests for money, or offer prizes of monetary value.
        </p>
      </V3Section>

      <V3Section title="Related">
        <p>
          See our{' '}
          <Link href="/terms" style={{ color: 'var(--purple-bright)' }}>
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" style={{ color: 'var(--purple-bright)' }}>
            Privacy Policy
          </Link>
          .
        </p>
      </V3Section>
    </V3PageShell>
  )
}
