import { notFound } from "next/navigation"
import PlatformHallOfFamePanel from "@/components/hall-of-fame/PlatformHallOfFamePanel"

export default function E2EHallOfFamePlatformPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return (
    <main className="min-h-screen bg-[#0a0a0f] p-6 text-white">
      <h1 className="mb-4 text-xl font-semibold">E2E Platform Hall of Fame Harness</h1>
      <PlatformHallOfFamePanel />
    </main>
  )
}
