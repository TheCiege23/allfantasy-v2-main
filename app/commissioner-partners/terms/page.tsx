import LegalPageRenderer, { legalLastUpdated } from "@/components/legal/LegalPageRenderer"
import PartnerProgramTermsBody from "@/components/legal/documents/PartnerProgramTermsBody"
import { resolveLegalBackLink, type LegalPageSearchParams } from "@/lib/legal/LegalRouteResolver"

interface PartnerTermsPageProps {
  searchParams?: Promise<LegalPageSearchParams>
}

export const metadata = {
  title: "Commissioner Partner Program Terms | AllFantasy",
  description:
    "Terms for the AllFantasy Commissioner Partner Program: Partner Codes, the friend discount, free-plan rewards, cash commission and payouts.",
}

/**
 * The Commissioner Partner Program Terms. Public on purpose (no feature flag): a commissioner
 * should be able to read what they are agreeing to before the program is on, and the claim screen
 * links here. The copy lives in components/legal/documents/PartnerProgramTermsBody.
 */
export default async function PartnerTermsPage({ searchParams }: PartnerTermsPageProps) {
  const back = await resolveLegalBackLink(searchParams)
  return (
    <LegalPageRenderer
      title="Commissioner Partner Program Terms"
      description={`Effective: ${legalLastUpdated("partnerTerms")}`}
      backHref={back.href}
      backLabel={back.label}
    >
      <PartnerProgramTermsBody />
    </LegalPageRenderer>
  )
}
