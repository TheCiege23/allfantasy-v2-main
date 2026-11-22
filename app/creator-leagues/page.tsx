import type { Metadata } from "next"
import Link from "next/link"
import { CreatorLeaguesClient } from "./CreatorLeaguesClient"
import { getPublicSiteOrigin } from "@/lib/site-public-origin"

export const dynamic = "force-dynamic"

const TITLE = "Creator Leagues | AllFantasy – Join Leagues from Creators & Influencers"
const DESCRIPTION =
  "Discover and join leagues run by verified creators and influencers. Filter by sport, see teams filled, and join with one click."

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${getPublicSiteOrigin()}/creator-leagues` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/creator-leagues",
  },
}

export default function CreatorLeaguesPage() {
  return (
    <div className="min-h-screen mode-surface mode-readable">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Link href="/" className="text-sm font-medium mb-6 inline-block" style={{ color: "var(--muted)" }}>
          ← Home
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold mb-2" style={{ color: "var(--text)" }}>
          Creator leagues
        </h1>
        <p className="text-sm mb-8" style={{ color: "var(--muted)" }}>
          Join leagues hosted by verified creators and influencers. Each card shows the creator, league name, sport,
          league type, teams filled, and join action. Explore creator profiles and live creator stats before joining.
        </p>
        <CreatorLeaguesClient />
        <div className="mt-10 pt-6 border-t" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Want to run your own league?{" "}
            <Link href="/creators" className="font-medium" style={{ color: "var(--accent)" }}>
              View creator profiles
            </Link>{" "}
            or{" "}
            <Link href="/creator" className="font-medium" style={{ color: "var(--accent)" }}>
              get started as a creator
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}
