import { redirect } from "next/navigation"

export default function DashboardWorldCupLeaderboardRedirectPage({
  params,
}: {
  params: { bracketId: string }
}) {
  redirect(`/brackets/world-cup/${params.bracketId}/leaderboard`)
}
