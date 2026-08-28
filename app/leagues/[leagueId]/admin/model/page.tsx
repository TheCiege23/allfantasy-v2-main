import { redirect } from "next/navigation"

/**
 * `/leagues/[leagueId]/admin/model` — redirect only. The screen now lives on the
 * core shell at `/core/model-admin?league=<id>`.
 *
 * WHY IT MOVED. This page rendered inside the legacy shell — top nav plus a
 * right rail of Notifications, AI Quick Ask, Wallet Summary and AI Status — none
 * of which belong beside a model-weights admin tool, and all of which have their
 * own surfaces. Everything runs off core now; a second shell for one admin page
 * is how a product ends up with three dashboards that disagree.
 *
 * ⚠ REDIRECT, NOT DELETE. The old path is linked from bookmarks and from at
 * least one internal doc, and a 404 would read as "the tool was removed" — which
 * is exactly the wrong conclusion, since it was removed once already (25db02263)
 * and took four months to notice. A redirect keeps every existing link working.
 *
 * ⚠ NO AUTH CHECK HERE, DELIBERATELY. The gate belongs at the destination and
 * only at the destination: duplicating `getAdminAccessState` here would create a
 * second predicate to drift out of step with the real one. /core redirects
 * unauthenticated users to /login itself, and the admin allowlist is enforced on
 * the segment.
 */
export default async function ModelAdminRedirect(props: {
  params: Promise<{ leagueId: string }> | { leagueId: string }
}) {
  const params = await props.params
  redirect(`/core/model-admin?league=${encodeURIComponent(params.leagueId)}`)
}
