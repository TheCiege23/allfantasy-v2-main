import { notFound } from 'next/navigation'
import { DraftHelperAiHarnessClient } from './DraftHelperAiHarnessClient'

export default function E2EDraftHelperAiPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <DraftHelperAiHarnessClient />
}
