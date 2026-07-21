import type { Metadata } from 'next'
import { V3PageShell } from '@/components/landing/v3/V3PageShell'

export const metadata: Metadata = {
  title: 'Careers | AllFantasy',
  description: 'Open roles and hiring at AllFantasy.',
}

export default function CareersPage() {
  return (
    <V3PageShell
      status="building"
      title="Careers"
      lead="We are not listing open roles publicly yet. If you are excited about fantasy sports and want to help build this, we would still like to hear from you."
    />
  )
}
