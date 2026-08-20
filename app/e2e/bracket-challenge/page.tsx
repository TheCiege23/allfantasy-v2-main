import { notFound } from 'next/navigation'
import { BracketChallengeHarnessClient } from './BracketChallengeHarnessClient'

export default function BracketChallengeHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <BracketChallengeHarnessClient />
}
