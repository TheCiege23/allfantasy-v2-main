import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * Devy history is the league's history. This page used to be a static placeholder — "2025 season · Imported
 * from Sleeper (preview)", a titles gallery reading "Team name · Manager", "wiring to league history
 * service" — shown to every devy league as if it were theirs (2026-11-07 Devy audit). The league header now
 * links to `/league/[id]?view=history`, as C2C's does; this keeps old links and bookmarks working.
 */
export default async function DevyHistoryPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  redirect(`/league/${encodeURIComponent(leagueId)}?view=history`)
}
