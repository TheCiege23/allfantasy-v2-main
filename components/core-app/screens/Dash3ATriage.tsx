import type { ReactNode } from 'react'
import { Dash3ATriageView } from '@/components/core-app/screens/Dash3ATriageView'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-dash-triage.css'

/**
 * Pre-kickoff injury triage on the post-login home.
 *
 * ⚠ THE DATA WAS ALREADY THERE; ONLY THE RENDER WAS MISSING. getDash34Data has
 * always built this book on the home request — every flagged player across
 * every league, with headshot, per-league exposure, starting counts and the
 * club's next kickoff — and Dashboard3A consumed only the league list from
 * the same payload. This panel renders the DECISION slice of that book:
 * starters who may not play, capped at six, nothing else (see the filter
 * comment in the component).
 *
 * Deliberately a SEPARATE component file: Dashboard3A.tsx carries another
 * session's in-flight work, and this panel must not touch it. It mounts from
 * app/dashboard/page.tsx beside Dashboard3A instead.
 *
 * Rendering rules inherited from the loader's own honesty notes:
 * - `reportedAgo` renders only when real — never an invented "just now".
 * - A missing headshot falls back to initials, never a broken image.
 * - `tone` is the loader's urgency call (unavailable vs flagged); this file
 *   adds no medical judgement of its own.
 */

export type TriageSlot = 'starter' | 'bench' | 'ir' | 'taxi'

type TriageLeague = {
  id: string
  name: string
  platform: string
  imageUrl: string | null
  /** Null when the roster could not be read — the chip then shows no slot. */
  slot?: TriageSlot | null
  /**
   * Same-position players on YOUR bench in this league, best asset first.
   * Only ever populated where he is starting. Empty means the bench holds no
   * same-position cover — which is itself the answer, and the reason the free
   * agent link matters there.
   */
  bench?: Array<{ name: string; position: string | null }>
}

export type TriageBookRow = {
  initials: string
  name: string
  imageUrl: string | null
  leagues: TriageLeague[]
  note: string
  position: string | null
  team: string | null
  /** NFL gate for the club mark — club codes collide across sports. */
  sport?: string | null
  status: string
  exposure: string
  exposureCount: number
  exposureTotal: number
  startingIn: number
  benchIn?: number
  irIn?: number
  taxiIn?: number
  /** What the feed said, e.g. "Ruled out — ankle." Null when none was given. */
  description?: string | null
  /** Market price, or null. Absent means no price on file — never "worthless". */
  value?: { value: number; overallRank: number | null; positionRank: number | null } | null
  reportedAt: string | null
  reportedAgo: string | null
  nextKickoffAt: string | null
  tone: 'bad' | 'warn'
}

/** Minutes from `now` to the kickoff — the server's call, so both sides of hydration agree. */
function kickoffMins(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.round((t - now.getTime()) / 60000)
}

export function Dash3ATriage({
  book,
  now,
  valueBasis,
  freshness = null,
}: {
  book: TriageBookRow[] | null
  now: Date
  /** The strip's freshness line — rendered only when the strip itself renders. */
  freshness?: ReactNode
  /**
   * What the prices on these rows are. Stated once for the panel rather than
   * per row, and omitted entirely when no row carries a price.
   */
  valueBasis?: { format: string; qbFormat: string } | null
}) {
  /*
   * ⚠ DECISIONS ONLY. The loader's full book (BOOK_LIMIT rows, every
   * designation, benched IR stashes included) read as a meaningless wall of
   * headshots on the home — founder-reported 2026-08-24. The home strip keeps
   * only rows that demand a lineup decision: a player the user is STARTING
   * somewhere whose status says they may not play (tone 'bad' — out,
   * doubtful, suspended, IR). Everything else already has a home in
   * /my-players, the full cross-league exposure audit. Most days this
   * renders nothing at all, and that is the intended resting state.
   */
  const rows = (book ?? []).filter((p) => p.tone === 'bad' && p.startingIn > 0)
  if (rows.length === 0) return null
  const visible = rows.slice(0, 6)
  const overflow = rows.length - visible.length

  /*
   * ⚠ THE WORDS ARE SAID IN THE CLIENT (2026-10-04). This strip keeps the decisions — which rows,
   * every link, and each kickoff's distance from the server's `now` — and Dash3ATriageView says them
   * in the reader's language. Only the fields a row shows cross the boundary.
   */
  return (
    <Dash3ATriageView
      rows={visible.map((p) => ({
        key: `${p.name}|${p.team ?? ''}`,
        name: p.name,
        initials: p.initials,
        imageUrl: p.imageUrl,
        playerHref: `/core/players?q=${encodeURIComponent(p.name)}`,
        position: p.position,
        team: p.team,
        sport: p.sport ?? null,
        status: p.status,
        tone: p.tone,
        exposure: p.exposure,
        exposureCount: p.exposureCount,
        exposureTotal: p.exposureTotal,
        startingIn: p.startingIn,
        benchIn: p.benchIn ?? 0,
        irIn: p.irIn ?? 0,
        taxiIn: p.taxiIn ?? 0,
        value: p.value ? { overallRank: p.value.overallRank, positionRank: p.value.positionRank } : null,
        reportedAgo: p.reportedAgo,
        kickoffMins: kickoffMins(p.nextKickoffAt, now),
        description: p.description ?? null,
        leagues: p.leagues.slice(0, 6).map((l) => ({
          id: l.id,
          name: l.name,
          platform: l.platform,
          href: `/core?league=${l.id}`,
          slot: l.slot ?? null,
          bench: l.slot === 'starter' ? (l.bench ?? []).map((b) => b.name) : [],
        })),
        leagueCount: p.leagues.length,
        freeAgentLinks: p.leagues
          .filter((l) => l.slot === 'starter')
          .map((l) => ({ id: l.id, name: l.name, href: `/core/waivers?league=${encodeURIComponent(l.id)}` })),
      }))}
      overflow={overflow}
      valueBasis={valueBasis && rows.some((r) => r.value) ? valueBasis : null}
      freshness={freshness}
    />
  )
}
