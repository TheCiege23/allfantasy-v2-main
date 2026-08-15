import { notFound } from "next/navigation"
import PlatformAnalyticsHarnessClient from "./PlatformAnalyticsHarnessClient"

export default function E2EPlatformAnalyticsPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }
  return <PlatformAnalyticsHarnessClient />
}
