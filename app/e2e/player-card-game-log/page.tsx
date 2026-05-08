import { notFound } from 'next/navigation'
import E2EPlayerCardGameLogClient from './E2EPlayerCardGameLogClient'

export default function E2EPlayerCardGameLogHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return <E2EPlayerCardGameLogClient />
}
