import { notFound } from 'next/navigation'
import { WaiverWireLiveHarnessClient } from './WaiverWireLiveHarnessClient'

export default function E2EWaiverWireLivePage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <WaiverWireLiveHarnessClient />
}
