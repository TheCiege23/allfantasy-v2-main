/**
 * The IDP salary-cap screens (Cap Room, Contract Center) are dark in every mode. They are built on fixed dark
 * grounds (#040915), and the site-wide light-mode clamp in app/globals.css recoloured parts of them — the
 * active-salary chip, the cap ring's label, the timeline names, the extension simulator — near-invisible in
 * light mode (2026-11-09 IDP audit). `af-draft-dark` is the app's "always dark" opt-out from that clamp.
 * Not on /idp/defense-hub: that screen is token-styled (af-core) and has its own light mode.
 */
export default function IdpCapLayout({ children }: { children: React.ReactNode }) {
  return <div className="af-draft-dark">{children}</div>
}
