import { notFound } from "next/navigation"
import UserStatsHarnessClient from "./UserStatsHarnessClient"

export default async function E2EUserStatsPage(
  props: {
    searchParams?: Promise<{ state?: string }>
  }
) {
  const searchParams = await props.searchParams
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return <UserStatsHarnessClient showEmpty={searchParams?.state === "empty"} />
}
