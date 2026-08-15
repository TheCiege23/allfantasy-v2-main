import { notFound } from 'next/navigation'
import { DashboardSoccerGroupingHarnessClient } from './DashboardSoccerGroupingHarnessClient'

export default function DashboardSoccerGroupingHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <DashboardSoccerGroupingHarnessClient />
}
