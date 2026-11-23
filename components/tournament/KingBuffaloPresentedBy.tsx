'use client'

type Props = {
  /** The tournament's name. The strip shows only for the King Buffalo Invitational (see isKingBuffaloTournament). */
  tournamentName: string | null | undefined
  variant?: 'strip' | 'compact' | 'footer'
  className?: string
}

/** The King Buffalo shield from the tournament art pack (design-refs/native-league-handoff/kbi-art-pack). */
const KING_BUFFALO_MARK = '/artwork/tournaments/black-gold/marks/kbi.svg'

/**
 * Whether a tournament is King Buffalo's own, so "Presented by King Buffalo" belongs on it.
 *
 * King Buffalo presents its own invitational, not every tournament on AllFantasy (owner's ruling, 2026-11-23). No
 * column marks that tournament, so it is recognised by name: "King Buffalo" (any spacing or case) or the word "KBI",
 * which is what the invitational and its conferences are called.
 */
export function isKingBuffaloTournament(name: string | null | undefined): boolean {
  if (!name) return false
  return /king\s*buffalo/i.test(name) || /\bKBI\b/i.test(name)
}

/**
 * "Presented by King Buffalo": the shield mark and the name in words. Renders nothing on any other tournament.
 *
 * Until 2026-11-22 this loaded /branding/kingbuffalo-presented-by.png, which is the ALLFANTASY wordmark on a black
 * canvas, not a King Buffalo logo: every tournament read "Presented by ALLFANTASY" while its alt text said
 * "KingBuffalo" (tournament audit item 7). The name is text, so the mark is decorative (alt=""). It inherits the text
 * colour of whatever it sits on, so it reads on light pages, dark pages and hero art alike.
 */
export function KingBuffaloPresentedBy({ tournamentName, variant = 'strip', className = '' }: Props) {
  if (!isKingBuffaloTournament(tournamentName)) return null
  const isFooter = variant === 'footer'
  const isCompact = variant === 'compact'

  return (
    <div
      className={`flex items-center justify-center gap-2.5 ${isFooter ? 'rounded-b-xl py-2' : isCompact ? 'rounded-lg py-1.5' : 'rounded-xl py-2.5'} px-3 ${className}`}
      // It sits on surfaces that follow light/dark and on ones that stay dark (hero art, the commissioner header), so it
      // paints no fill of its own: text inherits, and the border and wash come from that same colour.
      style={{
        background: 'color-mix(in srgb, currentColor 6%, transparent)',
        border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
      }}
      data-testid="kingbuffalo-presented-by"
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ opacity: 0.7 }}>Presented by</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={KING_BUFFALO_MARK} alt="" aria-hidden="true" className={isCompact ? 'h-6 w-auto' : 'h-7 w-auto sm:h-8'} />
      <span className={`${isCompact ? 'text-[13px]' : 'text-sm'} font-black tracking-tight`}>King Buffalo</span>
    </div>
  )
}
