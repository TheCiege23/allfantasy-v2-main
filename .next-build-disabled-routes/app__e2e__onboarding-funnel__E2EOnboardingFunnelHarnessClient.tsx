'use client'

import { Suspense, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import OnboardingFunnelClient from '@/app/onboarding/funnel/OnboardingFunnelClient'
import { OnboardingChecklist, ReturnPromptCards } from '@/components/onboarding-retention'
import { getSportOptions } from '@/lib/onboarding-funnel'
import type { OnboardingStepId } from '@/lib/onboarding-funnel'

const ALLOWED_STEPS = new Set<OnboardingStepId>([
  'welcome',
  'app_walkthrough',
  'sport_selection',
  'tool_suggestions',
  'league_prompt',
])

function parseStep(raw: string | null): OnboardingStepId {
  if (raw && ALLOWED_STEPS.has(raw as OnboardingStepId)) {
    return raw as OnboardingStepId
  }
  return 'welcome'
}

function HarnessBody() {
  const searchParams = useSearchParams()
  const step = parseStep(searchParams.get('step'))
  const sportOptions = useMemo(() => getSportOptions(), [])

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 to-gray-900 text-white">
      <div className="mx-auto max-w-2xl space-y-8 p-6">
        <p className="text-xs text-white/40" data-testid="e2e-onboarding-harness-label">
          E2E onboarding funnel harness (development only)
        </p>
        <OnboardingChecklist />
        <ReturnPromptCards />
        <OnboardingFunnelClient
          initialStep={step}
          sportOptions={sportOptions}
          preferredSportsInitial={[]}
          redirectOnComplete={false}
        />
      </div>
    </div>
  )
}

export default function E2EOnboardingFunnelHarnessClient() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white/60">
          Loading harness…
        </div>
      }
    >
      <HarnessBody />
    </Suspense>
  )
}
