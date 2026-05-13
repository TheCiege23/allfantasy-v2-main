import type { Metadata } from "next"
import WorldCupDiscoverClient from "@/components/brackets/world-cup/WorldCupDiscoverClient"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Discover FIFA World Cup Bracket Pools | AllFantasy",
  description:
    "Browse public FIFA World Cup bracket pools on AllFantasy. Join a pool, make your picks, and compete on the leaderboard.",
  openGraph: {
    title: "Discover FIFA World Cup Bracket Pools | AllFantasy",
    description:
      "Browse public FIFA World Cup bracket pools on AllFantasy. Join a pool, make your picks, and compete on the leaderboard.",
    type: "website",
  },
}

export default function WorldCupDiscoverPage() {
  return (
    <main className="min-h-screen bg-[#05070b] text-white">
      <WorldCupDiscoverClient />
    </main>
  )
}
