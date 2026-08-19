import { notFound } from "next/navigation"
import LeagueStoryHarnessClient from "./LeagueStoryHarnessClient"

export default function E2ELeagueStoryPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return <LeagueStoryHarnessClient />
}
