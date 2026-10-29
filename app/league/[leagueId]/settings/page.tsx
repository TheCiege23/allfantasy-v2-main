import { redirect } from "next/navigation"
import { legacySettingsRouteQuery } from "@/lib/league-settings-home/settingsEntryRouting"

/**
 * Settings honesty (P2-5): this route rendered the PERSONAL settings page
 * (SettingsFullPage) behind a commissioner gate — a commissioner opening
 * "League Settings" got their own profile/appearance controls, not the
 * league's. The real league settings surface is the Settings tab inside the
 * league shell (`?view=settings`; on a native league that is the League
 * Settings page, core NFL redraft imports open the settings modal from the same
 * deep link), so send every visitor there. The league shell applies its own
 * role gating. Old links (notification `actionHref`s, Chimmy) keep their
 * target: a `?settingsPanel=` / `?panel=` they carry is passed through.
 */
export default async function LeagueSettingsPage(
  props: {
    params: Promise<{ leagueId: string }>
    searchParams?: Promise<Record<string, string | string[] | undefined>>
  }
) {
  const params = await props.params;
  const search = (await props.searchParams) ?? {}
  redirect(`/league/${params.leagueId}?${legacySettingsRouteQuery(search)}`)
}
