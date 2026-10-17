import { notFound } from "next/navigation"
import { getWorldCupChallengeByInvite } from "@/lib/world-cup"
import WorldCupJoinInvite from "@/components/brackets/world-cup/WorldCupJoinInvite"

export const dynamic = "force-dynamic"

export default async function JoinWorldCupBracketPage(
  props: {
    params: Promise<{ inviteCode: string }>
  }
) {
  const params = await props.params
  const invite = await getWorldCupChallengeByInvite(params.inviteCode)
  if (!invite) notFound()

  return <WorldCupJoinInvite invite={invite} />
}
