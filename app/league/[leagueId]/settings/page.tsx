import { redirect } from "next/navigation"

/**
 * Settings honesty (P2-5): this route rendered the PERSONAL settings page
 * (SettingsFullPage) behind a commissioner gate — a commissioner opening
 * "League Settings" got their own profile/appearance controls, not the
 * league's. The real league settings surface is the Settings tab inside the
 * league shell (`?view=settings`; core NFL redraft leagues open the settings
 * modal from the same deep link), so send every visitor there. The league
 * shell applies its own role gating.
 */
export default function LeagueSettingsPage({
  params,
}: {
  params: { leagueId: string }
}) {
  redirect(`/league/${params.leagueId}?view=settings`)
}