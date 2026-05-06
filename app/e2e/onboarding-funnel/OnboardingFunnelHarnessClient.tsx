"use client"

import type { OnboardingStepId } from "@/lib/onboarding-funnel"
import OnboardingFunnelClient from "@/app/onboarding/funnel/OnboardingFunnelClient"
import {
  OnboardingChecklist,
  OnboardingProgressWidget,
  ReturnPromptCards,
  WelcomeFlow,
} from "@/components/onboarding-retention"

export default function OnboardingFunnelHarnessClient({
  initialStep,
  sportOptions,
}: {
  initialStep: OnboardingStepId
  sportOptions: { value: string; label: string }[]
}) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-950 to-gray-900 px-4 py-8 text-white">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-xl font-semibold">Onboarding Funnel Harness</h1>
        <p className="mb-6 text-sm text-white/70">
          E2E harness for onboarding click-path validation.
        </p>
        <div className="space-y-8">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <OnboardingFunnelClient
              initialStep={initialStep}
              sportOptions={sportOptions}
              preferredSportsInitial={[]}
              redirectOnComplete={false}
            />
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
            <h2 className="text-sm font-semibold text-white/90">Prompt 149 Components</h2>
            <OnboardingProgressWidget />
            <OnboardingChecklist />
            <ReturnPromptCards />
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <WelcomeFlow compact initialStep="welcome" />
          </section>
        </div>
      </div>
    </main>
  )
}
