import { notFound } from "next/navigation"
import PlatformLegacyLeaderboardPanel from "@/components/legacy-score/PlatformLegacyLeaderboardPanel"

export default function E2ELegacyScorePlatformPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return (
    <main className="min-h-screen bg-[#0a0a0f] p-6 text-white">
      <h1 className="mb-4 text-xl font-semibold">E2E Platform Legacy Harness</h1>
      <PlatformLegacyLeaderboardPanel />
    </main>
  )
}
