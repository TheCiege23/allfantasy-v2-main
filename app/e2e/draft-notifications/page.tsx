import { notFound } from "next/navigation"
import DraftNotificationsHarnessClient from "./DraftNotificationsHarnessClient"

export default async function E2EDraftNotificationsPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return <DraftNotificationsHarnessClient />
}
