import { notFound } from "next/navigation"
import FantasyNewsHarnessClient from "./FantasyNewsHarnessClient"

export default function E2EFantasyNewsPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return <FantasyNewsHarnessClient />
}
