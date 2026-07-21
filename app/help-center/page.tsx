import type { Metadata } from 'next'
import Link from 'next/link'
import { V3PageShell, V3Section } from '@/components/landing/v3/V3PageShell'

export const metadata: Metadata = {
  title: 'Help Center | AllFantasy',
  description: 'Guides, answers, and support for AllFantasy.',
}

export default function HelpCenterPage() {
  return (
    <V3PageShell
      status="building"
      title="Help center"
      lead="A full searchable help center is on the way. The guides below already cover the most common questions."
    >
      <V3Section title="Available now">
        <p>
          <Link href="/import-guides" style={{ color: 'var(--purple-bright)' }}>
            Import guides
          </Link>{' '}
          — step-by-step instructions for each supported platform.
        </p>
        <p>
          <Link href="/how-it-works" style={{ color: 'var(--purple-bright)' }}>
            How AllFantasy works
          </Link>{' '}
          — what we read, what we analyze, and what we deliberately cannot do.
        </p>
        <p>
          <Link href="/contact" style={{ color: 'var(--purple-bright)' }}>
            Contact support
          </Link>{' '}
          — reach a human directly.
        </p>
      </V3Section>
    </V3PageShell>
  )
}
