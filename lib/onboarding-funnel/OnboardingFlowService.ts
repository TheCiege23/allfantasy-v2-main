import { prisma } from "@/lib/prisma"
import type { OnboardingFunnelState, OnboardingStepId } from "./types"
import { ONBOARDING_STEPS } from "./types"

/**
 * Manages onboarding funnel step progression and completion.
 * Flow: welcome → app_walkthrough → sport_selection → tool_suggestions → league_prompt → completed.
 */
export async function getOnboardingState(userId: string): Promise<OnboardingFunnelState | null> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { onboardingStep: true, onboardingCompletedAt: true },
  })
  if (!profile) return null

  const step = (profile.onboardingStep as OnboardingStepId | null) ?? "welcome"
  const completedAt = profile.onboardingCompletedAt ?? null
  const isComplete = step === "completed" || completedAt != null

  return {
    currentStep: isComplete ? "completed" : step,
    completedAt,
    isComplete,
  }
}

/**
 * Returns the next step in the funnel, or "completed" if already at last step.
 */
function getNextStep(current: OnboardingStepId): OnboardingStepId {
  const idx = ONBOARDING_STEPS.indexOf(current)
  if (idx < 0 || idx >= ONBOARDING_STEPS.length - 1) return "completed"
  return ONBOARDING_STEPS[idx + 1]!
}

/**
 * Advances the user to the next step, or marks funnel complete if completeFunnel is true.
 * Persists to UserProfile.
 */
export async function advanceOnboardingStep(
  userId: string,
  payload: { step: OnboardingStepId; completeFunnel?: boolean }
): Promise<{ ok: boolean; nextStep: OnboardingStepId; error?: string }> {
  const nextStep = payload.completeFunnel ? "completed" : getNextStep(payload.step)
  const completedAt = nextStep === "completed" ? new Date() : null

  try {
    await prisma.userProfile.upsert({
      where: { userId },
      update: {
        onboardingStep: nextStep,
        ...(completedAt && { onboardingCompletedAt: completedAt }),
      },
      create: {
        userId,
        onboardingStep: nextStep,
        ...(completedAt && { onboardingCompletedAt: completedAt }),
      },
    })
    return { ok: true, nextStep }
  } catch (e) {
    console.error("[OnboardingFlowService] advanceOnboardingStep error:", e)
    return { ok: false, nextStep: payload.step, error: "Failed to save progress" }
  }
}

/**
 * Marks the funnel as completed (e.g. user clicked Skip all or finished league_prompt).
 */
export async function completeOnboardingFunnel(userId: string): Promise<{ ok: boolean; error?: string }> {
  return advanceOnboardingStep(userId, { step: "league_prompt", completeFunnel: true }).then((r) =>
    r.ok ? { ok: true } : { ok: false, error: r.error }
  )
}
