import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { redirect } from "next/navigation"
import {
  getOnboardingState,
  getPreferredSports,
  getSportOptions,
} from "@/lib/onboarding-funnel"
import OnboardingFunnelClient from "./OnboardingFunnelClient"

export const dynamic = "force-dynamic"

export default async function OnboardingFunnelPage() {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/onboarding/funnel")
  }

  const state = await getOnboardingState(session.user.id)
  if (state?.isComplete) {
    redirect("/core")
  }

  const currentStep = state?.currentStep ?? "welcome"
  const sportOptions = getSportOptions()
  const preferredSports = await getPreferredSports(session.user.id)

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 to-gray-900 text-white">
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Get started</h1>
        <OnboardingFunnelClient
          initialStep={currentStep}
          sportOptions={sportOptions}
          preferredSportsInitial={preferredSports}
        />
      </div>
    </div>
  )
}
