import { notFound } from "next/navigation"
import SportsAlertsHarnessClient from "./SportsAlertsHarnessClient"

export default async function E2ESportsAlertsPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return <SportsAlertsHarnessClient />
}
