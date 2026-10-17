import LegalPageRenderer, { legalLastUpdated } from "@/components/legal/LegalPageRenderer"
import SmsTermsBody from "@/components/legal/documents/SmsTermsBody"
import { resolveLegalBackLink, type LegalPageSearchParams } from "@/lib/legal/LegalRouteResolver"

interface SmsTermsPageProps {
  searchParams?: Promise<LegalPageSearchParams>
}

export const metadata = {
  title: "SMS Terms | AllFantasy",
  description:
    "Terms for text messages from AllFantasy (operated by Brown Pig LLC): what we send, how to opt in, STOP and HELP.",
}

/**
 * The SMS Terms (2026-10). The same component is reproduced whole at /terms#sms-terms,
 * so the two addresses can never disagree.
 */
export default async function SmsTermsPage({ searchParams }: SmsTermsPageProps) {
  const back = await resolveLegalBackLink(searchParams)

  return (
    <LegalPageRenderer
      title="SMS Terms"
      description={`Effective: ${legalLastUpdated("smsTerms")}`}
      backHref={back.href}
      backLabel={back.label}
    >
      <SmsTermsBody />
    </LegalPageRenderer>
  )
}
