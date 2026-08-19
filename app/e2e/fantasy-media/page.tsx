import { notFound } from "next/navigation"
import FantasyMediaHarnessClient from "./FantasyMediaHarnessClient"

export default function E2EFantasyMediaPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return <FantasyMediaHarnessClient />
}
