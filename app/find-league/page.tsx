import type { Metadata } from "next"
import { FindLeagueHero } from "@/components/find-league/FindLeagueHero"
import { FindLeagueClient } from "./FindLeagueClient"

export const dynamic = "force-dynamic"

const TITLE = "Find a League | AllFantasy – Discover Leagues to Join"
const DESCRIPTION =
  "Discover leagues you can join across NFL, NHL, NBA, MLB, NCAA Basketball, NCAA Football, and Soccer. Filter by sport, league type, draft type, team count, and more."

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/find-league",
  },
}

export default function FindLeaguePage() {
  return (
    <div className="min-h-screen mode-surface mode-readable">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* The board's header: eyebrow, title and intro, translated (2026-11-05). */}
        <FindLeagueHero />
        <FindLeagueClient />
      </div>
    </div>
  )
}
