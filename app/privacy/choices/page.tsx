import Link from "next/link"
import LegalPageRenderer, { legalLastUpdated } from "@/components/legal/LegalPageRenderer"
import { PrivacyChoicesControl } from "@/components/privacy/PrivacyChoicesControl"
import { resolveLegalBackLink, type LegalPageSearchParams } from "@/lib/legal/LegalRouteResolver"

interface PrivacyChoicesPageProps {
  searchParams?: Promise<LegalPageSearchParams>
}

export const metadata = {
  title: "Your Privacy Choices | AllFantasy",
  description: "Opt out of the sale or sharing of your personal information for advertising measurement.",
}

/**
 * "Do Not Sell or Share My Personal Information" — the control Privacy Policy §5.3 and §8.5
 * point to. Under /privacy, so the geo and VPN gates already let every visitor reach it.
 */
export default async function PrivacyChoicesPage({ searchParams }: PrivacyChoicesPageProps) {
  const back = await resolveLegalBackLink(searchParams)

  return (
    <LegalPageRenderer
      title="Your Privacy Choices"
      description={`Privacy Policy effective: ${legalLastUpdated("privacy")}`}
      backHref={back.href}
      backLabel={back.label}
    >
      <section id="opt-out">
        <h2>Do Not Sell or Share My Personal Information</h2>
        <p>
          We do not sell your personal information for money. On the website we use advertising-measurement
          tools from Meta, Google, TikTok, and Reddit, which some state laws treat as &quot;sharing&quot; or
          &quot;targeted advertising.&quot; Opting out turns those tools off and stops us sending your
          conversion events to them. See <Link href="/privacy#section-5">Privacy Policy Section 5</Link>.
        </p>
        <PrivacyChoicesControl />
      </section>
      <section id="how-it-works">
        <h2>How your choice is applied</h2>
        <ul>
          <li>
            <strong>On this browser:</strong> we remember your choice with a small cookie, so it works even when
            you are signed out. Clearing your cookies clears it.
          </li>
          <li>
            <strong>On your account:</strong> if you are signed in, we also record the choice on your account, so
            it applies on every device you sign in on and to events we send from our servers.
          </li>
          <li>
            <strong>Global Privacy Control:</strong> if your browser sends this signal, we treat it as a request
            to opt out automatically.
          </li>
          <li>
            Opting out does not change the analytics we use to run and improve the Services (Privacy Policy
            Section 5.1), and you may still see ads, which may simply be less relevant.
          </li>
        </ul>
        <p>
          You can also email <a href="mailto:support@allfantasy.ai">support@allfantasy.ai</a> with &quot;Do Not
          Sell or Share&quot; in the subject line.
        </p>
      </section>
    </LegalPageRenderer>
  )
}
