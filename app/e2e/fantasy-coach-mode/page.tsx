import { notFound } from "next/navigation"
import FantasyCoachModeHarnessClient from "./FantasyCoachModeHarnessClient"

export default function E2EFantasyCoachModePage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return <FantasyCoachModeHarnessClient />
}
