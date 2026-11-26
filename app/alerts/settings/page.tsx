import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { redirect } from "next/navigation"
import AlertSettingsClient from "./AlertSettingsClient"

export const dynamic = "force-dynamic"

export default async function AlertSettingsPage() {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/alerts/settings")
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 to-gray-900">
      <div className="mx-auto max-w-lg px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold text-white">Sports alerts</h1>
        <p className="mt-1 text-sm text-white/60">
          Real-time alerts in your notification bell. Tap one to open the player or league.
        </p>
        <AlertSettingsClient />
        <p className="mt-6 text-xs text-white/40">
          <a href="/settings?tab=notifications" className="text-cyan-400 hover:text-cyan-300 underline">
            All notification settings
          </a>
        </p>
      </div>
    </div>
  )
}
