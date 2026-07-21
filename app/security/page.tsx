import type { Metadata } from 'next'
import Link from 'next/link'
import { V3PageShell, V3Section } from '@/components/landing/v3/V3PageShell'

export const metadata: Metadata = {
  title: 'Security | AllFantasy',
  description: 'How AllFantasy handles access to your fantasy league data.',
}

/**
 * States only the access model that is actually implemented in the product.
 * Do not add compliance claims (SOC 2, ISO, pen-test results, encryption specs)
 * here unless they are true and verifiable — this is a customer-facing security
 * page and an unverified claim on it is a real liability.
 */
export default function SecurityPage() {
  return (
    <V3PageShell
      status="building"
      title="Security"
      lead="Full security documentation is being written. The access model below is what the product does today."
    >
      <V3Section title="Read-only access">
        <p>
          AllFantasy does not write to your leagues on other platforms. We cannot set lineups, accept trades, draft
          players, submit waiver claims, or change league settings anywhere else.
        </p>
      </V3Section>

      <V3Section title="Least access that works">
        <p>
          Sleeper imports use only your public username — no password and no token. Yahoo uses OAuth, so you sign in on
          Yahoo&rsquo;s own site and we never see your password. ESPN private leagues require session cookies, which are
          stored against your account rather than shared.
        </p>
      </V3Section>

      <V3Section title="Reporting a vulnerability">
        <p>
          If you believe you have found a security issue, please{' '}
          <Link href="/contact" style={{ color: 'var(--purple-bright)' }}>
            contact us
          </Link>{' '}
          directly rather than disclosing it publicly, and we will respond.
        </p>
      </V3Section>
    </V3PageShell>
  )
}
