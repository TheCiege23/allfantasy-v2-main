"use client"

import type { OnboardingChecklistState } from "@/lib/onboarding-retention"

export interface OnboardingProgressWidgetProps {
  initialState?: OnboardingChecklistState | null
  className?: string
}

