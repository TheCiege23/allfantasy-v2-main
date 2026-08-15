import { notFound } from "next/navigation"
import PodcastHarnessClient from "./PodcastHarnessClient"

export default async function E2EPodcastPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return <PodcastHarnessClient />
}
