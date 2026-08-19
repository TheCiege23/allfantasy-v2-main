import { notFound } from "next/navigation"
import ViralLeagueInviteHarnessClient from "./ViralLeagueInviteHarnessClient"

export default async function E2EViralLeagueInvitePage(props: {
  searchParams?: Promise<{ leagueId?: string }> | { leagueId?: string }
}) {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  const sp = props.searchParams ?? {}
  const resolved =
    typeof (sp as Promise<{ leagueId?: string }>).then === "function"
      ? await (sp as Promise<{ leagueId?: string }>)
      : (sp as { leagueId?: string })
  const leagueId = resolved.leagueId?.trim() || "e2e-viral-invite-league"

  return <ViralLeagueInviteHarnessClient leagueId={leagueId} />
}
