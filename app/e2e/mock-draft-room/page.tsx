import { Suspense } from 'react'
import { MockDraftRoomHarnessClient } from '@/app/e2e/mock-draft-room/MockDraftRoomHarnessClient'

export default async function E2eMockDraftRoomPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>
}) {
  const sp = await searchParams
  const mode: 'setup' | 'active' = sp.mode === 'active' ? 'active' : 'setup'
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#0a0a0f] p-6 text-sm text-white/70">Loading mock draft harness…</main>
      }
    >
      <MockDraftRoomHarnessClient mode={mode} />
    </Suspense>
  )
}
