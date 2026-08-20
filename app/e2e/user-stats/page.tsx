import { notFound } from "next/navigation"
import UserStatsHarnessClient from "./UserStatsHarnessClient"

export default function E2EUserStatsPage({
  searchParams,
}: {
  searchParams?: { state?: string }
}) {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return <UserStatsHarnessClient showEmpty={searchParams?.state === "empty"} />
}
