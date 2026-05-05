import { redirect } from "next/navigation"

export default function DashboardWorldCupChallengeRedirectPage({
  params,
}: {
  params: { bracketId: string }
}) {
  redirect(`/brackets/world-cup/${params.bracketId}`)
}
