import { redirect } from 'next/navigation'

/**
 * `/rankings` is retired into the rankings hub (2026-10-01).
 *
 * It was a standalone "League Power Rankings" page. Its power score, trend and
 * strengths/risks now live on `/core/rankings?scope=league`, read from stored
 * data. Luck, playoff odds and the win window stay on `/power-rankings`, which
 * that tab links to.
 *
 * ⚠ IT ALSO LEAKED. A signed-out visitor got `league.findMany({ where: undefined,
 * take: 10 })` — the ten most recently updated leagues of ANY user, with team and
 * owner names. The hub only ever lists the viewer's own leagues.
 *
 * Kept as a redirect, not deleted, because Chimmy answers, the tools hub and old
 * bookmarks link here.
 */
export default function RetiredRankingsPage(): never {
  redirect('/core/rankings?scope=league')
}
