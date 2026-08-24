import type { Metadata } from "next"
import type { ReactNode } from "react"
import { buildSeoMeta } from "@/lib/seo"

/**
 * ⚠ /settings HAD NO METADATA OF ITS OWN. It inherited the root layout's, so the
 * browser tab read "AllFantasy – Fantasy Sports Tools Powered by Chimmy" — the
 * homepage's title — on a private account page, and the document declared
 * `robots: index, follow`.
 *
 * The robots line was never an indexing leak in practice: page.tsx redirects an
 * unauthenticated request to /login, so a crawler never receives this HTML. It is
 * corrected because declaring a private surface indexable is wrong on its face and
 * because the auth pages already set noIndex explicitly — /settings was simply
 * inconsistent with them.
 */
export const metadata: Metadata = buildSeoMeta({
  title: "Settings | AllFantasy.ai",
  description: "Manage your AllFantasy profile, preferences, security and billing.",
  canonicalPath: "/settings",
  noIndex: true,
})

export default function SettingsLayout({ children }: { children: ReactNode }) {
  /*
   * ⚠ THE HARDCODED GROUND IS DELIBERATE AND SO IS ITS DARKNESS. The Settings
   * surface is "dark by design, independent of the app theme toggle" — see the
   * header of nocturne-settings.css, which remaps the theme variables for this
   * subtree on purpose. This wrapper only paints the ground behind that subtree;
   * it is NOT a light-mode bug to be rescued.
   */
  return <div className="min-h-screen bg-[#07071a]">{children}</div>
}
