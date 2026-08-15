import { notFound } from "next/navigation"
import RankingsV2HarnessClient from "./RankingsV2HarnessClient"

export default function E2ERankingsV2Page() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return <RankingsV2HarnessClient />
}
