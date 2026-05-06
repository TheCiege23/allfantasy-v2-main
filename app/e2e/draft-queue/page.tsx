import { notFound } from 'next/navigation'
import E2EDraftQueueHarnessClient from './E2EDraftQueueHarnessClient'

export default function E2EDraftQueueHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return <E2EDraftQueueHarnessClient />
}
