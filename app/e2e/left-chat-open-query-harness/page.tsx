import { Suspense } from 'react'
import { LeftChatOpenQueryHarnessClient } from '@/app/e2e/left-chat-open-query-harness/LeftChatOpenQueryHarnessClient'

/**
 * Route entry for the left-chat openChat harness.
 *
 * The harness CLIENT survived the mass harness deletion and was restored in
 * #408, but this page was not — restoring a directory that never contained a
 * page.tsx left a folder App Router does not serve. So
 * /e2e/left-chat-open-query-harness answered 404, and all three
 * left-chat-open-query specs failed on "element(s) not found" for tabs that
 * render perfectly well: nothing was rendering at all.
 *
 * The client reads `?openChat=` through useSearchParams, which App Router
 * requires be wrapped in a Suspense boundary — without one the build fails on
 * a missing-suspense-with-csr-bailout error rather than at runtime.
 */
export default function LeftChatOpenQueryHarnessPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#0a0a0f] p-4 text-sm text-white/70">Loading left chat harness…</main>
      }
    >
      <LeftChatOpenQueryHarnessClient />
    </Suspense>
  )
}
