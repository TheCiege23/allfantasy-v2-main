'use client'

import { useRouter } from 'next/navigation'
import { CreateLeagueV2Client } from '@/app/create-league/v2/CreateLeagueV2Client'

/**
 * Primary "Create league" route — universal 4-step flow supporting all 13 league types.
 * Delegates to the v2 client which routes to the correct API endpoint per league type.
 */
export function CreateLeaguePageClient({ userId }: { userId: string }) {
  const router = useRouter()

  return (
    <div className="min-h-screen text-white">
      <header className="relative z-30 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="touch-manipulation inline-flex h-11 min-w-[44px] items-center justify-center rounded-full border border-white/15 bg-black/20 px-3 text-lg text-white/80 hover:bg-white/10 hover:text-white"
            aria-label="Back to app"
          >
            ←
          </button>
          <h1 className="min-w-0 truncate text-center text-base font-semibold tracking-tight text-white/90 sm:text-lg">
            New league
          </h1>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => router.push('/import?returnTo=%2Fcreate-league')}
              className="touch-manipulation inline-flex min-h-[44px] items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-500/10 px-3 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/20"
              aria-label="Open import page"
            >
              Import
            </button>
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              className="touch-manipulation inline-flex min-h-[44px] items-center justify-center rounded-full border border-white/20 bg-black/20 px-3 text-xs font-semibold text-white/90 hover:bg-white/10"
              aria-label="Go to dashboard home"
            >
              Home
            </button>
          </div>
        </div>
      </header>
      <CreateLeagueV2Client userId={userId} />
    </div>
  )
}
