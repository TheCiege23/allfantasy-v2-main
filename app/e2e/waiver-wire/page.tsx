import { notFound } from 'next/navigation'
import { WaiverWireHarnessClient } from './WaiverWireHarnessClient'

export default function E2EWaiverWirePage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return <WaiverWireHarnessClient />
}
