import { notFound } from 'next/navigation'
import HomeChatDock from '@/components/home/HomeChatDock'

export default function HomeChatDockAuditPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return (
    <main className="min-h-screen p-6">
      <h1 className="text-lg font-semibold">Home Chat Dock Audit</h1>
      <p className="mt-1 text-sm mode-muted">Internal QA route for moderation click-audit coverage.</p>
      <HomeChatDock />
    </main>
  )
}
