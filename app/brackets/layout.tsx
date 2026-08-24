import type { Metadata } from "next"
import type { ReactNode } from "react"
import { buildSeoMeta } from "@/lib/seo"
import { BRACKETS_DESCRIPTION, BRACKETS_TITLE } from "./seo"

/*
 * ⚠ THIS WAS A BARE { title, description } OBJECT, ON A SUBTREE WHOSE ROOT IS IN
 * sitemap.xml AT 0.8. That sets exactly those two fields and nothing else, so
 * every page under /brackets inherited the ROOT layout's OpenGraph. Measured
 * before this change, on /brackets itself:
 *
 *   title       Bracket Pools | AllFantasy                            <- its own
 *   canonical   none
 *   og:title    AllFantasy – Fantasy Sports Tools Powered by Chimmy   <- the homepage's
 *   og:url      none
 *   twitter     AllFantasy – Fantasy Sports Tools Powered by Chimmy   <- the homepage's
 *
 * So posting a bracket pool anywhere with a link preview advertised the
 * homepage's marketing copy instead of the pool. Same cause and same fix as
 * 5430ed57 on the legal pages.
 *
 * ⚠ NO canonicalPath HERE, ON PURPOSE — see ./seo.ts. A canonical on this
 * layout is inherited by all five routes beneath it and makes each one declare
 * itself a duplicate of /brackets. It lives on page.tsx instead.
 *
 * ⚠ AND THIS DOES NOT VIOLATE THE HARDENING NOTE BELOW. That note forbids
 * chrome, providers and third-party scripts while the Railway /brackets 500 is
 * unexplained. `buildSeoMeta` is a pure function returning a plain metadata
 * object — it mounts no component, opens no context and loads no script, so it
 * cannot participate in a render-time failure. The layout still returns its
 * children untouched.
 */
export const metadata: Metadata = buildSeoMeta({
  title: BRACKETS_TITLE,
  description: BRACKETS_DESCRIPTION,
})

/**
 * MINIMAL HARDENED LAYOUT — restored by emergency Phase 6 hardening.
 *
 * The full layout (with ProductShellLayout + BracketsPageHeader + dynamic
 * SEO + next-auth header) is preserved in `_layout-full.tsx.bak` and will
 * be restored once root cause of the Railway /brackets HTTP 500 is
 * identified and fixed. Do NOT add chrome, providers, or third-party
 * scripts to this file until production is stable.
 */
export default function BracketsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
