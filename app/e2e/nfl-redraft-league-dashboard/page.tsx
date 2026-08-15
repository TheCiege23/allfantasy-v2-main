import { notFound } from 'next/navigation'
import NflRedraftLeagueDashboardHarnessClient from './NflRedraftLeagueDashboardHarnessClient'

export default function NflRedraftLeagueDashboardHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return <NflRedraftLeagueDashboardHarnessClient />
}
