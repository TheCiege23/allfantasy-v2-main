import LegalPageRenderer, { legalLastUpdated } from "@/components/legal/LegalPageRenderer"
import FantasySportsNoticeBody from "@/components/legal/documents/FantasySportsNoticeBody"
import { resolveLegalBackLink, type LegalPageSearchParams } from "@/lib/legal/LegalRouteResolver"

interface DisclaimerPageProps {
  searchParams?: Promise<LegalPageSearchParams>
}

export const metadata = {
  title: "Fantasy Sports & State Notice | AllFantasy",
  description:
    "AllFantasy is season-long fantasy sports only — no gambling, no daily fantasy, no prizes — and where it is available.",
}

/**
 * The Fantasy Sports & State Notice (2026-10), served at /disclaimer.
 *
 * ⚠ THIS IS THE DOCUMENT THE SIGN-UP "DISCLAIMER" BOX ACCEPTS. The Notice says "you
 * accept it when you create an Account", and lib/legal/recordLegalAcceptance stores
 * that acceptance as document "disclaimer" against legalVersions' `disclaimer` stamp.
 * It keeps the /disclaimer address because every surface and every recorded
 * acceptance already uses it.
 */
export default async function DisclaimerPage({ searchParams }: DisclaimerPageProps) {
  const back = await resolveLegalBackLink(searchParams)

  return (
    <LegalPageRenderer
      title="Fantasy Sports & State Notice"
      description={`Effective: ${legalLastUpdated("disclaimer")}`}
      backHref={back.href}
      backLabel={back.label}
    >
      <FantasySportsNoticeBody />
    </LegalPageRenderer>
  )
}
