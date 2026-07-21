import type { Metadata } from 'next'
import Link from 'next/link'
import { V3PageShell, V3Section } from '@/components/landing/v3/V3PageShell'

export const metadata: Metadata = {
  title: 'Video Tutorials | AllFantasy',
  description: 'Walkthrough videos for AllFantasy.',
}

export default function VideoTutorialsPage() {
  return (
    <V3PageShell
      status="building"
      title="Video tutorials"
      lead="We have not recorded these yet. The written walkthroughs cover the same ground in the meantime."
    >
      <V3Section title="Written walkthroughs">
        <p>
          <Link href="/import-guides" style={{ color: 'var(--purple-bright)' }}>
            Import guides
          </Link>{' '}
          and{' '}
          <Link href="/how-it-works" style={{ color: 'var(--purple-bright)' }}>
            how it works
          </Link>
          .
        </p>
      </V3Section>
    </V3PageShell>
  )
}
