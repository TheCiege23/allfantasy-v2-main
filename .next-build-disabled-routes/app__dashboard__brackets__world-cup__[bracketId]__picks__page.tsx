import { redirect } from "next/navigation"

export default function DashboardWorldCupPicksRedirectPage({
  params,
}: {
  params: { bracketId: string }
}) {
  redirect(`/brackets/world-cup/${params.bracketId}/picks`)
}
