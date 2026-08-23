import Link from "next/link"
import LegalPageRenderer, { LEGAL_LAST_UPDATED } from "@/components/legal/LegalPageRenderer"
import { DISCLAIMER_PAGE_TITLE, DISCLAIMER_PAGE_SECTIONS } from "@/lib/legal/DisclaimerPageService"
import { getSignupReturnUrl } from "@/lib/legal/LegalRouteResolver"
import { RESTRICTED_STATES } from "@/lib/geo/restrictedStates"
import { getFanCredBoundaryDisclosureLong } from "@/lib/legal/FanCredBoundaryDisclosure"
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

  const fullBlockStates = RESTRICTED_STATES.filter((s) => s.level === "full_block")
  const paidBlockStates = RESTRICTED_STATES.filter((s) => s.level === "paid_block")

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
        {/*
          ⚠ THIS LIST IS RENDERED FROM lib/geo/restrictedStates.ts, THE SAME ARRAY
          THE GEO-BLOCK ENFORCES. It used to be typed out here as prose naming
          Washington, Hawaii, Idaho, Montana and Nevada with RCW 9.46.240 quoted
          by hand.

          It happened to be accurate. That is the point: /no-gambling-policy and
          /paid-restricted already derive from the array, so this page was the
          only one of the three that could silently drift out of agreement with
          what the product actually enforces — and it is the page a regulator or
          an app reviewer is most likely to read. Deriving it means the page
          cannot claim a restriction the code does not apply, or miss one it does.
        */}
        <p className="mt-3 font-semibold text-white">Important: Residents of the following states should be aware of specific restrictions:</p>
        {fullBlockStates.map((state) => (
          <p className="mt-3" key={state.code}>
            <strong>{state.name}:</strong> {state.details} ({state.legalBasis}) AllFantasy.ai does not provide
            services to users located in {state.name}. Using a VPN or proxy to bypass this restriction may be a
            violation of {state.name} state law.
          </p>
        ))}
        <p className="mt-3">
          <strong>{paidBlockStates.map((s) => s.name).join(", ")}:</strong> Paid fantasy sports contests are
          prohibited by state law. Only free fantasy sports play is permitted for residents of these states.
        </p>
        <ul className="mt-3 list-disc list-inside space-y-2 ml-4">
          {paidBlockStates.map((state) => (
            <li key={state.code}>
              <strong>{state.name}:</strong> {state.details} ({state.legalBasis})
            </li>
          ))}
        </ul>
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
        {/*
          The same duplication as the state list, one file over.
          lib/legal/FanCredBoundaryDisclosure.ts carries a VERSIONED canonical
          text (FANCRED_BOUNDARY_DISCLOSURE_VERSION), served to clients through
          two monetization API routes and rendered by /no-gambling-policy. This
          page restated it from memory, so a revision to the versioned text —
          which is versioned precisely because it gets revised — would have
          reached the API and the sibling page and not this one.
        */}
        <p>{getFanCredBoundaryDisclosureLong()}</p>
        <p className="mt-3">
          AllFantasy does not collect, hold, or distribute league dues or entry fees, and does not host prize
          pools or payout systems. If we provide links or references to third-party payment or
          league-management services, their terms and policies apply.
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
