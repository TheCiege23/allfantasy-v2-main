import { notFound } from 'next/navigation'
import EngagementNotificationRoutingHarnessClient from './EngagementNotificationRoutingHarnessClient'

export default function EngagementNotificationRoutingHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return <EngagementNotificationRoutingHarnessClient />
}
