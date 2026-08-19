import { notFound } from 'next/navigation'
import { BracketPaidSettingsHarnessClient } from './BracketPaidSettingsHarnessClient'

export default function BracketPaidSettingsHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <BracketPaidSettingsHarnessClient />
}
