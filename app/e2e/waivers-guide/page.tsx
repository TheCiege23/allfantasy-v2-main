import WaiversGuideHarnessClient from './WaiversGuideHarnessClient'

/**
 * DB-free render of a league's Waivers page with the 2026-11-13 guide: the "Best pickup" headline,
 * the plain "Worth adding" rows, the claim button, and the folded notes. Every figure is SAMPLE data.
 * Production is refused by app/e2e/layout.tsx.
 */
export default function WaiversGuideHarnessPage() {
  return <WaiversGuideHarnessClient />
}
