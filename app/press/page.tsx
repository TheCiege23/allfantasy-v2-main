import type { Metadata } from 'next'
import { V3PageShell } from '@/components/landing/v3/V3PageShell'

export const metadata: Metadata = {
  title: 'Press Kit | AllFantasy',
  description: 'Brand assets, logos, and press resources for AllFantasy.',
}

export default function PressPage() {
  return (
    <V3PageShell
      status="building"
      title="Press kit"
      lead="Logos, brand assets, and company background for media and partners. Reach out directly in the meantime and we will send what you need."
    />
  )
}
