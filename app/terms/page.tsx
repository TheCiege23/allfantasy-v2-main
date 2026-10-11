import Link from "next/link"
import LegalPageRenderer, { legalLastUpdated } from "@/components/legal/LegalPageRenderer"
import TermsOfServiceBody from "@/components/legal/documents/TermsOfServiceBody"
import SmsTermsBody from "@/components/legal/documents/SmsTermsBody"
import { resolveLegalBackLink, type LegalPageSearchParams } from "@/lib/legal/LegalRouteResolver"

interface TermsPageProps {
  searchParams?: Promise<LegalPageSearchParams>
}

export const metadata = {
  title: "Terms of Service | AllFantasy",
  description: "AllFantasy Terms of Service — the agreement between you and Brown Pig LLC for the AllFantasy Services.",
}

/**
 * The Terms of Service, as drafted by the owner (2026-10). The copy lives in
 * components/legal/documents/TermsOfServiceBody — this page only frames it.
 *
 * ⚠ /terms#sms-terms MUST KEEP RESOLVING TO THE FULL SMS TERMS. The SMS consent box
 * links there (components/legal/SmsConsentCheckbox) and the A2P 10DLC campaign
 * registration points carrier reviewers at it. The SMS Terms are part of this
 * agreement (Section 1.1), so they are reproduced whole below from the same component
 * /sms-terms renders — one copy of the words, two addresses — rather than as a
 * summary that could drift from the standalone page.
 */
export default async function TermsPage({ searchParams }: TermsPageProps) {
  const back = await resolveLegalBackLink(searchParams)

  return (
    <LegalPageRenderer
      title="Terms of Service"
      description={`Effective: ${legalLastUpdated("terms")}`}
      backHref={back.href}
      backLabel={back.label}
    >
      <TermsOfServiceBody />
      <section id="youtube-highlights"><h2>YouTube highlights</h2>
        <p>
          AllFantasy uses YouTube API Services for public sports highlights. By using the YouTube
          highlights feature, you agree to be bound by the{' '}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a>.
          Video availability and playback restrictions are controlled by YouTube and the publisher.
        </p>
      </section>

      <section id="sms-terms" className="af-legal-appendix">
        <h2>SMS Terms</h2>
        <p>
          The SMS Terms are part of these Terms (see <a href="#section-1-1">Section 1.1</a>) and are
          reproduced in full below. They are also published at{" "}
          <Link href="/sms-terms">allfantasy.ai/sms-terms</Link>.
        </p>
        <SmsTermsBody />
      </section>

      {back.fromSignup ? (
        <section id="signup-gate">
          <p>
            <Link href={back.href} className="af-legal-cta">
              Back to sign up
            </Link>
          </p>
        </section>
      ) : null}
    </LegalPageRenderer>
  )
}
