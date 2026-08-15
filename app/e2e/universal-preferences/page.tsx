import { notFound } from 'next/navigation'
import { UniversalPreferencesHarnessClient } from './UniversalPreferencesHarnessClient'

export default function UniversalPreferencesHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <UniversalPreferencesHarnessClient />
}
