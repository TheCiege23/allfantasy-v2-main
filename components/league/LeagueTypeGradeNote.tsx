'use client'

import {
  LEAGUE_TYPE_DECIDES_GRADES,
  leagueTypeSourceText,
  type LeagueTypeBasis,
} from '@/lib/league/leagueTypeGrading'
import './league-type-grade-note.css'

/**
 * The line beside a trade grade that names the league type it was priced under and says how we
 * know it — and, until a person has confirmed it, why confirming matters.
 *
 * 🛑 AN UNCONFIRMED TYPE IS SAID, NOT HIDDEN (Guap, 2026-09-25). Most imported leagues were never
 * asked what they are: the type is Sleeper's flag, a name match, or the redraft default. The grade
 * beside this line is only as right as that type, so the line says which one it is and links to the
 * one place it can be fixed.
 */
export function LeagueTypeGradeNote({
  basis,
  confirmHref,
  className,
}: {
  basis: LeagueTypeBasis | null | undefined
  /** Where the league-type control is — `#league-type` on a /core league screen. */
  confirmHref: string
  className?: string
}) {
  if (!basis) return null
  const confirmed = basis.source === 'confirmed'
  return (
    <p
      className={['af-ltg', className].filter(Boolean).join(' ')}
      data-confirmed={confirmed ? 'true' : 'false'}
      data-testid="league-type-grade-note"
    >
      <span>
        League type: <strong>{basis.label}</strong>
      </span>
      <span className="af-ltg-source"> · {leagueTypeSourceText(basis)}</span>
      {confirmed ? null : (
        <span className="af-ltg-ask">
          {' '}
          {LEAGUE_TYPE_DECIDES_GRADES}{' '}
          <a href={confirmHref} className="af-ltg-link">
            Confirm your league type
          </a>
        </span>
      )}
    </p>
  )
}

export default LeagueTypeGradeNote
