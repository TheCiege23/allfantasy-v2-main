import { permanentRedirect } from 'next/navigation'

/**
 * Retired 2026-11-12 (owner's call): the trade tools are one Trade Analyzer, and the trade finder is
 * the one on the Trades screen (/core/trades → "Trade finder", the league's own values and grade).
 * This page duplicated it, with its own API, and handed its picks to /trade-evaluator in a shape the
 * evaluator never read. A 308 keeps bookmarks and old links working, and carries the league over.
 */
export default async function TradeFinderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const raw = sp.leagueId ?? sp.league
  const leagueId = (Array.isArray(raw) ? raw[0] : raw)?.trim()
  permanentRedirect(leagueId ? `/core/trades?league=${encodeURIComponent(leagueId)}#trade-finder` : '/core/trades#trade-finder')
}
