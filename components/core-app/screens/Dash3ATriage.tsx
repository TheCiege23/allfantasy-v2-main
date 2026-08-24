import Link from 'next/link'
import { ClubLogo } from '@/components/core-app/ClubLogo'
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

function kickoffLabel(iso: string | null, now: Date): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const mins = Math.round((t - now.getTime()) / 60000)
  if (mins <= 0) return 'kickoff underway'
  if (mins < 60) return `kickoff in ${mins}m`
  if (mins < 48 * 60) return `kickoff in ${Math.round(mins / 60)}h`
  return `kickoff in ${Math.round(mins / (60 * 24))}d`
}

const SLOT_LABEL: Record<TriageSlot, string> = {
  starter: 'STARTER',
  bench: 'bench',
  ir: 'IR',
  taxi: 'taxi',
}

/** "starter in 3 · bench in 5 · IR in 1" — only the counts that are non-zero. */
function slotSummary(p: TriageBookRow): string {
  return [
    p.startingIn > 0 ? `starter in ${p.startingIn}` : null,
    (p.benchIn ?? 0) > 0 ? `bench in ${p.benchIn}` : null,
    (p.irIn ?? 0) > 0 ? `IR in ${p.irIn}` : null,
    (p.taxiIn ?? 0) > 0 ? `taxi in ${p.taxiIn}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function Dash3ATriage({
  book,
  now,
  valueBasis,
}: {
  book: TriageBookRow[] | null
  now: Date
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

  return (
    <section className="af-core af-triage" aria-label="Starters in doubt">
      <div className="af-triage-head">
        <h2 className="af-triage-title">Starters in doubt</h2>
        <span className="af-triage-sub">
          in your lineups but may not play — most urgent first
        </span>
      </div>
      <ul className="af-triage-list">
        {visible.map((p) => {
          const kickoff = kickoffLabel(p.nextKickoffAt, now)
          return (
            <li key={`${p.name}|${p.team ?? ''}`} className="af-triage-row" data-tone={p.tone}>
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="af-triage-avatar" src={p.imageUrl} alt="" loading="lazy" />
              ) : (
                <span className="af-triage-avatar af-triage-avatar--initials" aria-hidden>
                  {p.initials}
                </span>
              )}
              <div className="af-triage-main">
                <div className="af-triage-line1">
                  <Link
                    className="af-triage-name"
                    href={`/core/players?q=${encodeURIComponent(p.name)}`}
                  >
                    {p.name}
                  </Link>
                  <span className="af-triage-meta">
                    {[p.position, p.team].filter(Boolean).join(' · ')}
                    {String(p.sport ?? '').toUpperCase() === 'NFL' ? (
                      <ClubLogo club={p.team} size={14} style={{ marginLeft: 6 }} />
                    ) : null}
                  </span>
                  <span className="af-triage-status" data-tone={p.tone}>
                    {p.status}
                  </span>
                </div>
                <div className="af-triage-line2">
                  <span className="af-triage-exposure">
                    {p.exposure} leagues
                    {slotSummary(p) ? ` · ${slotSummary(p)}` : ''}
                  </span>
                  {p.value ? (
                    /*
                     * Rank leads because it is cross-positional and needs no
                     * scale to read; the raw price follows it. Absent renders
                     * nothing at all — a player we hold no price for must not
                     * look like a player priced at nothing.
                     */
                    <span className="af-triage-value af-num">
                      {p.value.overallRank != null ? `#${p.value.overallRank} overall` : null}
                      {p.value.overallRank != null && p.value.positionRank != null ? ' · ' : ''}
                      {p.value.positionRank != null && p.position
                        ? `${p.position}${p.value.positionRank}`
                        : null}
                    </span>
                  ) : null}
                  {p.reportedAgo ? (
                    <span className="af-triage-ago">reported {p.reportedAgo}</span>
                  ) : null}
                  {kickoff ? <span className="af-triage-kickoff">{kickoff}</span> : null}
                </div>
                {p.description ? (
                  /* The feed's own sentence. Never paraphrased into a timeline —
                     no injury table here holds an expected return. */
                  <p className="af-triage-note">{p.description}</p>
                ) : null}
                {p.leagues.length > 0 ? (
                  <div className="af-triage-leagues">
                    {p.leagues.slice(0, 6).map((l) => (
                      <Link
                        key={l.id}
                        href={`/league/${l.id}`}
                        className="af-triage-league"
                        data-slot={l.slot ?? undefined}
                      >
                        <span className="af-triage-league-platform">
                          {l.platform.toUpperCase()}
                        </span>
                        {l.name}
                        {/* Where he sits in THIS league — the difference between
                            "act here" and "no action needed". Absent when the
                            roster could not be read; never defaulted to bench. */}
                        {l.slot ? (
                          <span className="af-triage-slot" data-slot={l.slot}>
                            {SLOT_LABEL[l.slot]}
                          </span>
                        ) : null}
                      </Link>
                    ))}
                    {p.leagues.length > 6 ? (
                      <span className="af-triage-league af-triage-league--more">
                        +{p.leagues.length - 6} more
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <Link
                className="af-triage-cta"
                href={`/core/players?q=${encodeURIComponent(p.name)}`}
              >
                Find a replacement
              </Link>
            </li>
          )
        })}
      </ul>
      {overflow > 0 ? (
        <Link className="af-triage-overflow" href="/my-players">
          +{overflow} more starters flagged — full exposure audit
        </Link>
      ) : null}
      {valueBasis && rows.some((r) => r.value) ? (
        /*
         * Said once for the panel. The price is captured at 12 teams and full
         * PPR and varies only dynasty/redraft and 1QB/superflex — it is NOT
         * tuned to this account's TE-premium or superflex settings, and
         * pretending otherwise would be the quiet kind of lie this screen
         * exists to avoid.
         */
        <p className="af-triage-basis">
          Ranks are FantasyCalc {valueBasis.format.toLowerCase()} {valueBasis.qbFormat === 'ONE_QB' ? '1QB' : 'superflex'} prices at
          12 teams, full PPR — not adjusted for your scoring. NFL only.
        </p>
      ) : null}
    </section>
  )
}
