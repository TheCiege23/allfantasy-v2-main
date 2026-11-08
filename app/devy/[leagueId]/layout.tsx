/**
 * Devy is dark in every mode. Its screens are built on fixed dark grounds (#040915), and the site-wide
 * light-mode clamp in app/globals.css recoloured parts of them — the week label, the bench and taxi
 * notices, the devy section and the picks headings read near-invisible in light mode (2026-11-07 Devy
 * audit). `af-draft-dark` is the app's "always dark" opt-out from that clamp, as C2C's layout does.
 */
export default function DevyLeagueLayout({ children }: { children: React.ReactNode }) {
  return <div className="af-draft-dark">{children}</div>
}
