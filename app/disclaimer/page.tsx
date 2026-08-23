import Link from "next/link"
import LegalPageRenderer, { LEGAL_LAST_UPDATED } from "@/components/legal/LegalPageRenderer"
import { DISCLAIMER_PAGE_TITLE, DISCLAIMER_PAGE_SECTIONS } from "@/lib/legal/DisclaimerPageService"
import { getSignupReturnUrl } from "@/lib/legal/LegalRouteResolver"
import type { Metadata } from 'next'
import { buildSeoMeta } from '@/lib/seo'

interface DisclaimerPageProps {
  searchParams?: Promise<{ from?: string; next?: string }> | { from?: string; next?: string }
}

// Routed through buildSeoMeta for a canonical and page-specific OpenGraph;
// see app/terms/page.tsx for why a bare metadata object was not enough.
export const metadata: Metadata = buildSeoMeta({
  title: "Disclaimer | AllFantasy",
  description: "AllFantasy fantasy sports disclaimer - no gambling, no DFS, entertainment and management tools only",
  canonicalPath: '/disclaimer',
})

export default async function DisclaimerPage({ searchParams }: DisclaimerPageProps) {
  const params = searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  const fromSignup = params.from === "signup"
  const next = typeof params.next === "string" ? params.next : undefined
  const signupHref = getSignupReturnUrl(next)

  return (
    <LegalPageRenderer
      title={DISCLAIMER_PAGE_TITLE}
      description={`Last updated: ${LEGAL_LAST_UPDATED}`}
      backHref={fromSignup ? signupHref : "/"}
      backLabel={fromSignup ? "Back to Sign Up" : "Back to Home"}
    >
      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">State Law Compliance — Fantasy Sports Restrictions</h2>
        <p>
          AllFantasy.ai is committed to complying with all applicable U.S. state laws regarding fantasy sports. Fantasy sports laws
          vary significantly by state and are subject to change.
        </p>
        <p className="mt-3 font-semibold text-white">Important: Residents of the following states should be aware of specific restrictions:</p>
        <p className="mt-3">
          <strong>Washington State:</strong> ALL fantasy sports activities are prohibited under RCW 9.46.240. AllFantasy.ai does not
          provide services to users located in Washington. Using a VPN or proxy to bypass this restriction may be a violation of
          Washington state law.
        </p>
        <p className="mt-3">
          <strong>Hawaii, Idaho, Montana, Nevada:</strong> Paid fantasy sports contests are prohibited by state law. Only free
          fantasy sports play is permitted for residents of these states.
        </p>
        <p className="mt-3">
          This platform does not provide legal advice. Users are responsible for ensuring their participation complies with all
          applicable local, state, and federal laws. If you are unsure whether participation in fantasy sports is legal in your
          jurisdiction, consult a licensed attorney.
        </p>
        <p className="mt-3">
          For questions about geographic restrictions, contact:{" "}
          <a href="mailto:support@allfantasy.ai" className="text-cyan-400 hover:text-cyan-300">
            support@allfantasy.ai
          </a>
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Purpose of the Platform</h2>
        <p>
          AllFantasy is a platform for <strong>fantasy sports entertainment and management tools</strong>.
          We provide analysis, rankings, trade evaluations, and related features to help you manage and enjoy
          fantasy leagues. The platform is not a gambling product and does not offer real-money betting or
          wagering of any kind.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">No Gambling or DFS</h2>
        <p>
          <strong>No gambling is being offered by AllFantasy.</strong> We do not facilitate, operate, or
          endorse any form of gambling. We do not offer daily fantasy sports (DFS), paid pick’em, or any
          product where you pay to enter for a chance to win money based on the outcome of real-world events.
          Our tools are intended for use in traditional, season-long fantasy leagues and related entertainment only.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">League Dues and Payments</h2>
        <p>
          AllFantasy does not collect, hold, or distribute league dues or entry fees. Any payments between
          league members (e.g., dues, payouts) are solely between users and/or handled by third-party
          services such as FanCred. Commissioners are responsible for setting up and managing those
          external payment flows. AllFantasy does not host prize pools or payout systems. If we provide
          links or references to third-party payment or league-management services, their terms and
          policies apply.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">AI Tools and Guidance</h2>
        <p>
          Our AI tools (including trade analyzers, rankings, and recommendations) provide <strong>guidance
          and informational content only</strong>. They do not guarantee outcomes, wins, or specific results.
          Past performance and AI analysis are not predictors of future results. You are solely responsible
          for your fantasy decisions; use of our tools is at your own risk.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Your Responsibility and Local Laws</h2>
        <p>
          You are responsible for complying with all applicable local, state, and national laws. Fantasy
          sports and related activities may be restricted or prohibited in some jurisdictions. It is your
          obligation to determine that your use of AllFantasy is legal where you are. We do not provide
          legal advice.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Quick Policy Checklist</h2>
        <ul className="list-disc list-inside space-y-1 ml-4">
          {DISCLAIMER_PAGE_SECTIONS.map((section) => (
            <li key={section.heading}>
              <strong>{section.heading}:</strong> {section.body}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <p className="text-white/60 text-sm">
          By using AllFantasy, you acknowledge that you have read and understood this Disclaimer. For our
          full rules and policies, see our <Link href="/terms" className="text-cyan-400 hover:text-cyan-300">Terms of Service</Link> and{" "}
          <Link href="/privacy" className="text-cyan-400 hover:text-cyan-300">Privacy Policy</Link>.
        </p>
      </section>
    </LegalPageRenderer>
  )
}
