import { notFound } from "next/navigation"
import OnboardingFunnelHarnessClient from "./OnboardingFunnelHarnessClient"
import type { OnboardingStepId } from "@/lib/onboarding-funnel"
import { ONBOARDING_STEPS, getSportOptions } from "@/lib/onboarding-funnel"

export default async function E2EOnboardingFunnelPage(props: {
  searchParams?: Promise<{ step?: string }> | { step?: string }
}) {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  const sp = props.searchParams ?? {}
  const resolved =
    typeof (sp as Promise<{ step?: string }>).then === "function"
      ? await (sp as Promise<{ step?: string }>)
      : (sp as { step?: string })

  const requestedStep = String(resolved.step ?? "").trim().toLowerCase()
  const matchedStep = (ONBOARDING_STEPS.find((step) => step === requestedStep) ??
    "welcome") as OnboardingStepId

  return (
    <OnboardingFunnelHarnessClient
      initialStep={matchedStep}
      sportOptions={getSportOptions()}
    />
  )
}
