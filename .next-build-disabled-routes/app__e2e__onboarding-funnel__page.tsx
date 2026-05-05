import { notFound } from 'next/navigation'
import E2EOnboardingFunnelHarnessClient from './E2EOnboardingFunnelHarnessClient'

export default function E2EOnboardingFunnelHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return <E2EOnboardingFunnelHarnessClient />
}
