import { notFound } from 'next/navigation'
import { LeagueChatAiHarnessClient } from './LeagueChatAiHarnessClient'

export default function E2ELeagueChatAiPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <LeagueChatAiHarnessClient />
}
