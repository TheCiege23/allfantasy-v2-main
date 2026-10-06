import LegalPageRenderer, { legalLastUpdated } from "@/components/legal/LegalPageRenderer"
import CopyrightPolicyBody from "@/components/legal/documents/CopyrightPolicyBody"
import { resolveLegalBackLink, type LegalPageSearchParams } from "@/lib/legal/LegalRouteResolver"

interface CopyrightPageProps {
  searchParams?: Promise<LegalPageSearchParams>
}

export const metadata = {
  title: "Copyright Policy | AllFantasy",
  description: "How AllFantasy responds to notices of claimed copyright infringement under the DMCA.",
}

/** The Copyright (DMCA) Policy (2026-10). */
export default async function CopyrightPage({ searchParams }: CopyrightPageProps) {
  const back = await resolveLegalBackLink(searchParams)

  return (
    <LegalPageRenderer
      title="Copyright Policy"
      description={`Effective: ${legalLastUpdated("copyright")}`}
      backHref={back.href}
      backLabel={back.label}
    >
      <CopyrightPolicyBody />
    </LegalPageRenderer>
  )
}
