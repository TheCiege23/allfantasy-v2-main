import Link from 'next/link'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-dash-triage.css'

/**
 * Pre-kickoff injury triage on the post-login home.
 *
 * ⚠ THE DATA WAS ALREADY THERE; ONLY THE RENDER WAS MISSING. getDash34Data has
 * always built this book on the /dashboard request — every flagged player
 * across every league, with headshot, per-league exposure, starting counts and
 * the club's next kickoff — and Dashboard3A consumed only the league list from
 * the same payload. A user opening the product before kickoff saw rivalry
 * records and XP, not who is OUT. This panel renders the book above the home.
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

type TriageLeague = { id: string; name: string; platform: string; imageUrl: string | null }

export type TriageBookRow = {
  initials: string
  name: string
  imageUrl: string | null
  leagues: TriageLeague[]
  note: string
  position: string | null
  team: string | null
  status: string
  exposure: string
  exposureCount: number
  exposureTotal: number
  startingIn: number
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

export function Dash3ATriage({ book, now }: { book: TriageBookRow[] | null; now: Date }) {
  if (!book || book.length === 0) return null

  return (
    <section className="af-core af-triage" aria-label="Injury triage">
      <div className="af-triage-head">
        <h2 className="af-triage-title">Moving your book</h2>
        <span className="af-triage-sub">
          flagged players across your leagues, most urgent first
        </span>
      </div>
      <ul className="af-triage-list">
        {book.map((p) => {
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
                  </span>
                  <span className="af-triage-status" data-tone={p.tone}>
                    {p.status}
                  </span>
                </div>
                <div className="af-triage-line2">
                  <span className="af-triage-exposure">
                    {p.exposure} leagues
                    {p.startingIn > 0 ? ` · starting in ${p.startingIn}` : ''}
                  </span>
                  {p.reportedAgo ? (
                    <span className="af-triage-ago">reported {p.reportedAgo}</span>
                  ) : null}
                  {kickoff ? <span className="af-triage-kickoff">{kickoff}</span> : null}
                </div>
                {p.leagues.length > 0 ? (
                  <div className="af-triage-leagues">
                    {p.leagues.slice(0, 6).map((l) => (
                      <Link key={l.id} href={`/league/${l.id}`} className="af-triage-league">
                        <span className="af-triage-league-platform">
                          {l.platform.toUpperCase()}
                        </span>
                        {l.name}
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
                See the move
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
