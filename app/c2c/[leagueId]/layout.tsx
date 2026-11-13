/**
 * Campus to Canton is dark in every mode. Its screens are built on fixed dark grounds (#040915), and the
 * site-wide light-mode clamp in app/globals.css recoloured parts of them — the score summary's total, the
 * Roster Balance button, the side chips and the picks' status read near-invisible in light mode
 * (2026-11-07 C2C audit). `af-draft-dark` is the app's "always dark" opt-out from that clamp.
 */
export default function C2CLeagueLayout({ children }: { children: React.ReactNode }) {
  return <div className="af-draft-dark">{children}</div>
}
