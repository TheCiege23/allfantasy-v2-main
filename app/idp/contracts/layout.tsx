import '@/components/core-app/af-core.css'

/**
 * The IDP salary-cap screens (Cap Room, Contract Center) follow the app's mode (2026-11-23). They were always dark
 * (`af-draft-dark`, 2026-11-09) because they sat on fixed dark grounds that the light clamp recoloured near-invisible;
 * they now read the af-core tokens, which carry both modes, so the opt-out is gone.
 */
export default function IdpCapLayout({ children }: { children: React.ReactNode }) {
  return <div className="af-core">{children}</div>
}
