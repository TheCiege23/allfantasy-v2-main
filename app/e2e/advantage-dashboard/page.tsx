import { notFound } from 'next/navigation'
import AdvantageDashboardHarnessClient from './AdvantageDashboardHarnessClient'

export default function E2EAdvantageDashboardPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <AdvantageDashboardHarnessClient />
}
