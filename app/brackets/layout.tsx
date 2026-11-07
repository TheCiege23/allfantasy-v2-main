import type { Metadata } from "next"
import type { ReactNode } from "react"
import { ErrorBoundaryClient } from "@/components/error-handling/ErrorBoundaryClient"
import BracketCommsDock from "@/components/brackets/BracketCommsDock"
import { getTokenSpendRuleMatrixEntry } from "@/lib/tokens/pricing-matrix"

export const metadata: Metadata = {
  title: "Bracket Pools | AllFantasy",
  description:
    "Create or join bracket pools — FIFA World Cup, NBA/NHL playoffs, and more. AI analysis, live leaderboards, invite codes. Free forever.",
}

/**
 * MINIMAL HARDENED LAYOUT — restored by emergency Phase 6 hardening.
 *
 * The full layout (with ProductShellLayout + BracketsPageHeader + dynamic
 * SEO + next-auth header) is preserved in `_layout-full.tsx.bak` and will
 * be restored once root cause of the Railway /brackets HTTP 500 is
 * identified and fixed. Keep the layout minimal: the user-requested communications
 * dock is isolated behind a client-only loader and an error boundary; it adds no
 * server-side session reads, providers, or third-party scripts to this layout.
 */
export default function BracketsLayout({ children }: { children: ReactNode }) {
  const tokenCost = getTokenSpendRuleMatrixEntry("ai_chimmy_chat_message")?.tokenCost ?? null
  return <>{children}<ErrorBoundaryClient fallback={null}><BracketCommsDock tokenCost={tokenCost} /></ErrorBoundaryClient></>
}

