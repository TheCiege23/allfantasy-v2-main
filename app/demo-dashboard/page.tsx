import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { V3PageShell } from '@/components/landing/v3/V3PageShell'
import { V3DashboardMock } from '@/components/landing/v3/V3DashboardMock'

export const metadata: Metadata = {
  title: 'Demo Dashboard | AllFantasy',
  description:
    'See what the AllFantasy unified dashboard looks like with sample data, then import your own leagues in seconds.',
}

/**
 * Static demo of the unified dashboard.
 *
 * Deliberately renders the same illustrative mock the homepage hero uses, with
 * sample data clearly labelled. It is NOT wired to a live feed — a real
 * dashboard needs real leagues, which is what the import CTA is for. Do not
 * relabel this as live data.
 */
export default function DemoDashboardPage() {
  return (
    <V3PageShell
      title="The unified dashboard"
      lead="Every league you play, across every platform and sport, on one screen. This is a static preview with sample data — import a league to see your own."
    >
      <div
        style={{
          padding: '10px 16px',
          borderRadius: 'var(--r-md)',
          border: '1px solid var(--line-2)',
          background: 'rgba(255,255,255,.03)',
          fontSize: 13.5,
          color: 'var(--text-3)',
          marginBottom: 26,
        }}
      >
        Sample data shown for illustration — not a live feed.
      </div>

      <V3DashboardMock />

      <div style={{ marginTop: 44 }}>
        <h2 style={{ fontSize: 22, marginBottom: 10 }}>See it with your own leagues</h2>
        <p style={{ fontSize: 15.5, lineHeight: 1.7, color: 'var(--text-2)', marginBottom: 18 }}>
          A Sleeper username is all it takes, and you do not need an account to try it.
        </p>
        <Link href="/#import" className="btn btn-primary">
          Import my league <ArrowRight size={16} />
        </Link>
      </div>
    </V3PageShell>
  )
}
