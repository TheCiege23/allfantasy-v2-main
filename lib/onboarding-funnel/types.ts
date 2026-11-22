/**
 * Onboarding funnel step identifiers.
 * Order: welcome → app_walkthrough → sport_selection → tool_suggestions → league_prompt → completed
 */
export type OnboardingStepId =
  | "welcome"
  | "app_walkthrough"
  | "sport_selection"
  | "tool_suggestions"
  | "league_prompt"
  | "completed"

export const ONBOARDING_STEPS: OnboardingStepId[] = [
  "welcome",
  "app_walkthrough",
  "sport_selection",
  "tool_suggestions",
  "league_prompt",
  "completed",
]

export interface OnboardingFunnelState {
  currentStep: OnboardingStepId
  completedAt: Date | null
  isComplete: boolean
}

