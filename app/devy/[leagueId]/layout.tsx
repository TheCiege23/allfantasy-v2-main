import '@/components/core-app/af-core.css'
import '@/app/devy/devy-ui.css'

/**
 * Devy follows the app's mode (2026-11-23). It was dark in every mode behind `af-draft-dark` (the 2026-11-07 audit),
 * so a light league page linked to a fully dark roster. The screens now draw with /core's tokens (`.af-core`, which
 * switches with the mode) plus Devy's colours in app/devy/devy-ui.css.
 */
export default function DevyLeagueLayout({ children }: { children: React.ReactNode }) {
  return <div className="af-core devy-ui min-h-screen">{children}</div>
}
