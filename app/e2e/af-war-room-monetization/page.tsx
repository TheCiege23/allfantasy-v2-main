import { notFound } from 'next/navigation'
import { AfWarRoomMonetizationHarnessClient } from './AfWarRoomMonetizationHarnessClient'

export default function E2EAfWarRoomMonetizationPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <AfWarRoomMonetizationHarnessClient />
}
