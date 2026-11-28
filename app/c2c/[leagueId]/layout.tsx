import '@/components/core-app/af-core.css'
import '@/app/c2c/c2c-ui.css'

/**
 * Campus to Canton follows the app's mode (2026-11-23). It was dark in every mode behind `af-draft-dark` (the
 * 2026-11-07 audit), so a light league page linked to a fully dark roster. The screens now draw with /core's tokens
 * (`.af-core`, which switches with the mode) plus the two sides' colours in app/c2c/c2c-ui.css.
 */
export default function C2CLeagueLayout({ children }: { children: React.ReactNode }) {
  return <div className="af-core c2c-ui min-h-screen">{children}</div>
}
