import type { Metadata } from "next"
import Link from "next/link"
import { PublicLeagueDiscoveryPage } from "@/components/discovery"
import { isSupportedSport } from "@/lib/sport-scope"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

const SPORT_NAMES: Record<string, string> = {
  NFL: "NFL",
  NHL: "NHL",
  NBA: "NBA",
  MLB: "MLB",
  NCAAF: "NCAA Football",
  NCAAB: "NCAA Basketball",
  SOCCER: "Soccer",
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sport: string }>
}): Promise<Metadata> {
  const { sport } = await params
  const upper = sport?.toUpperCase() ?? ""
  if (!isSupportedSport(upper)) {
    return { title: "Discover Leagues | AllFantasy" }
  }
  const name = SPORT_NAMES[upper] ?? upper
  const title = `Discover ${name} Leagues | AllFantasy – Public & Creator Leagues`
  const description = `Browse public and creator ${name} leagues and bracket competitions. Join open leagues.`
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `/discover/leagues/${sport}`,
    },
  }
}

export default async function DiscoverLeaguesBySportPage({
  params,
}: {
  params: Promise<{ sport: string }>
}) {
  const { sport } = await params
  const upper = sport?.toUpperCase() ?? ""
  if (!isSupportedSport(upper)) notFound()

  const sportName = SPORT_NAMES[upper] ?? upper

  return (
    <div className="min-h-screen mode-surface mode-readable">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <Link
          href="/discover/leagues"
          className="text-sm font-medium mb-6 inline-block"
          style={{ color: "var(--muted)" }}
        >
          ← All leagues
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold mb-2" style={{ color: "var(--text)" }}>
          Discover {sportName} leagues
        </h1>
        <p className="text-sm mb-8" style={{ color: "var(--muted)" }}>
          Browse public and creator {sportName} leagues ranked to your current AllFantasy level.
          Commissioner invites can still unlock out-of-range leagues.
        </p>
        <PublicLeagueDiscoveryPage defaultSport={upper} />
      </div>
    </div>
  )
}
