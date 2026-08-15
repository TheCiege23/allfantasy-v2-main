import { notFound } from "next/navigation"
import PowerRankingsHarnessClient from "./PowerRankingsHarnessClient"

export default function E2EPowerRankingsPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return <PowerRankingsHarnessClient />
}
