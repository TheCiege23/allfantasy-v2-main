import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { MyLeaguesV4 } from "@/components/core-app/screens/MyLeaguesV4"
import { getMyLeaguesData } from "@/lib/core-app/myLeagues"
import { buildMetadata, getSEOPageConfig } from "@/lib/seo"

/**
 * /leagues — cut over to the 21a "My Leagues" view.
 *
 * ⚠ THE CONNECT/RE-SYNC DASHBOARD THIS ONCE LINKED TO IS RETIRED. It moved to
 * /leagues/sync when 21a took this route, and has now been removed outright:
 * adding a league is /import's job, and it was a second import pipeline running
 * the older `/api/league/*` endpoints. Yahoo OAuth starts from /import.
 *
 * ⚠ WHAT WENT WITH IT: the per-league RE-SYNC BUTTON. The endpoints still exist
 * and still work; nothing in the UI calls them. Recorded rather than left to be
 * discovered.
 *
 * ⚠ THIS PAGE STATES NO FIGURE OF ITS OWN. Every count, tier and chip number is
 * computed in `getMyLeaguesData` from rows read on the server. The handoff's
 * numbers (61 live, 543 finished, 7/12/23/4/19/38) are its own account's, and
 * transcribing any of them here would produce a screen that disagrees with the
 * database the moment either changed.
 *
 * ⚠ force-dynamic BECAUSE THIS IS PER-USER AND URGENCY-RANKED. A cached render
 * would serve one account's leagues to another, and a stale one would report a
 * starter as available after the injury feed moved.
 */
export const metadata = buildMetadata(
  getSEOPageConfig("leagues") ?? {
    title: "My Leagues | AllFantasy",
    description: "Every league you play, sorted by what needs you.",
    canonical: "https://allfantasy.ai/leagues",
  }
)

export const dynamic = "force-dynamic"

export default async function LeaguesPage() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id

  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent("/leagues")}`)
  }

  /*
   * A failed read must not 500 the page. The empty shape renders 21a's own empty
   * state — which links to import and to sync — rather than an error boundary
   * that offers the reader nothing to press.
   */
  const data = await getMyLeaguesData(userId).catch((err) => {
    console.error("[/leagues] getMyLeaguesData failed", err)
    return null
  })

  return (
    <MyLeaguesV4
      leagues={data?.leagues ?? []}
      history={data?.history ?? []}
      counts={
        data?.counts ?? {
          live: 0,
          history: 0,
          all: 0,
          needs: 0,
          playing: 0,
          quiet: 0,
          commissioner: 0,
          drafting: 0,
          dynasty: 0,
        }
      }
      platforms={data?.platforms ?? []}
      coverage={data?.coverage ?? []}
      notice={data?.notice ?? null}
      importHref="/import"
    />
  )
}
