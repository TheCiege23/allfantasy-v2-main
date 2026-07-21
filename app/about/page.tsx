import type { Metadata } from 'next'
import { V3PageShell } from '@/components/landing/v3/V3PageShell'

export const metadata: Metadata = {
  title: 'About AllFantasy | AllFantasy',
  description: 'AllFantasy is the operating system for fantasy sports — every league you play, in one dashboard.',
}

export default function AboutPage() {
  return (
    <V3PageShell
      status="building"
      title="About AllFantasy"
      lead="We are building the operating system for fantasy sports: one place to manage every league you play, on every platform, across every sport."
    />
  )
}
