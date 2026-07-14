import { Suspense } from 'react'
import DraftRoomHarnessClient from '@/app/e2e/draft-room/DraftRoomHarnessClient'

export default function E2eDraftRoomHarnessPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#0a0a0f] p-6 text-sm text-white/70">Loading draft harness...</main>
      }
    >
      <DraftRoomHarnessClient />
    </Suspense>
  )
}
