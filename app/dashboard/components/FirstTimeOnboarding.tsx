'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import { getChimmyStandaloneChatHref } from '@/lib/ai-product-layer/UnifiedChimmyEntryResolver'

export interface FirstTimeOnboardingProps {
  isFirstTime: boolean
  onSportSelect?: () => void
}

export function FirstTimeOnboarding({ isFirstTime, onSportSelect }: FirstTimeOnboardingProps) {
  if (!isFirstTime) return null

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-[28px] border border-emerald-400/20 bg-gradient-to-br from-emerald-400/5 to-transparent p-5">
        <div className="mb-3 text-3xl">⚽</div>
        <h3 className="text-sm font-bold text-white">Pick Your Sport</h3>
        <p className="mt-1 text-xs text-white/60">
          Choose your favorite sport to personalize your experience and unlock relevant leagues.
        </p>
        <button
          type="button"
          onClick={onSportSelect}
          className="mt-4 inline-flex items-center gap-1 rounded-lg bg-emerald-400/20 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-400/30 transition"
        >
          Select Sport
        </button>
      </div>

      <div className="rounded-[28px] border border-violet-400/20 bg-gradient-to-br from-violet-400/5 to-transparent p-5">
        <div className="mb-3 text-3xl">🤖</div>
        <h3 className="text-sm font-bold text-white">Meet Chimmy</h3>
        <p className="mt-1 text-xs text-white/60">
          Your AI assistant can help with waiver pickups, trades, schedules, and league strategy.
        </p>
        <Link
          href={getChimmyStandaloneChatHref()}
          className="mt-4 inline-flex items-center gap-1 rounded-lg bg-violet-400/20 px-3 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-400/30 transition"
        >
          Open Chimmy
        </Link>
      </div>

      <div className="rounded-[28px] border border-amber-400/20 bg-gradient-to-br from-amber-400/5 to-transparent p-5">
        <div className="mb-3 text-3xl">🎲</div>
        <h3 className="text-sm font-bold text-white">Practice Draft</h3>
        <p className="mt-1 text-xs text-white/60">
          Run a mock draft to learn how draft strategy works before the real thing.
        </p>
        <Link
          href="/tools-hub?tool=mock-draft"
          className="mt-4 inline-flex items-center gap-1 rounded-lg bg-amber-400/20 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-400/30 transition"
        >
          Mock Draft
        </Link>
      </div>
    </section>
  )
}
