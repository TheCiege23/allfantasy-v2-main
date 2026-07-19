import type { Metadata } from 'next'
import { V3PageShell } from '@/components/landing/v3/V3PageShell'

export const metadata: Metadata = {
  title: 'Partners | AllFantasy',
  description: 'Partner with AllFantasy.',
}

export default function PartnersPage() {
  return (
    <V3PageShell
      status="building"
      title="Partners"
      lead="Platform integrations, content partnerships, and league operators. If you run a fantasy community or platform and want to work together, get in touch."
    />
  )
}
