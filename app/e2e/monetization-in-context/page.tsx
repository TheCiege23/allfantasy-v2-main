import { notFound } from 'next/navigation'
import { MonetizationInContextHarnessClient } from './MonetizationInContextHarnessClient'

export default function MonetizationInContextHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <MonetizationInContextHarnessClient />
}

