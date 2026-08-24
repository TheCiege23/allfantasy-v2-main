import Link from "next/link"
import LegalPageRenderer, { legalLastUpdated } from "@/components/legal/LegalPageRenderer"
import { getSignupReturnUrl } from "@/lib/legal/LegalRouteResolver"
import { RESTRICTED_STATES } from "@/lib/geo/restrictedStates"
import { getFanCredBoundaryDisclosureLong, getFanCredBoundaryChecklist } from "@/lib/legal/FanCredBoundaryDisclosure"

interface NoGamblingPolicyPageProps {
  searchParams?: Promise<{ from?: string; next?: string }> | { from?: string; next?: string }
}

export const metadata = {
  title: "No Gambling Policy | AllFantasy",
  description:
    "AllFantasy's No Gambling Policy: no wagering, no DFS, no paid pick'em. Season-long fantasy sports management and entertainment only.",
}

export default async function NoGamblingPolicyPage({ searchParams }: NoGamblingPolicyPageProps) {
  const params = searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  const fromSignup = params.from === "signup"
  const next = typeof params.next === "string" ? params.next : undefined
  const signupHref = getSignupReturnUrl(next)

  const fullBlockStates = RESTRICTED_STATES.filter((s) => s.level === "full_block")
  const paidBlockStates = RESTRICTED_STATES.filter((s) => s.level === "paid_block")

  return (
    <LegalPageRenderer
      title="No Gambling Policy"
      description={`Last updated: ${legalLastUpdated("noGamblingPolicy")}`}
      backHref={fromSignup ? signupHref : "/"}
      backLabel={fromSignup ? "Back to Sign Up" : "Back to Home"}
    >
      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Our Position</h2>
        <p>
          No gambling is offered by AllFantasy. We do not facilitate, operate, host, or profit from any form of
          real-money wagering. AllFantasy is a management, analysis, and entertainment platform for traditional,
          season-long fantasy sports leagues.
        </p>
        <p className="mt-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-300 text-sm">
          ✦ Fantasy Sports Only · No Gambling · Free for Players
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">No DFS or Paid Pick’em</h2>
        <p>
          We do not offer daily fantasy sports (DFS) contests, paid pick’em pools, or any product where you pay an
          entry fee for a chance to win money based on the outcome of a single day or single event. Our tools are
          built for season-long leagues that you run with people you know.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">League Dues and Payouts Are Handled Externally</h2>
        <p>{getFanCredBoundaryDisclosureLong()}</p>
        <ul className="list-disc list-inside space-y-1 ml-4 mt-3">
          {getFanCredBoundaryChecklist().map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">State Law Compliance</h2>
        <p>
          Fantasy sports laws vary by state and are subject to change. AllFantasy enforces the following
          restrictions automatically based on your location:
        </p>
        <h3 className="text-lg font-semibold text-cyan-300 mt-4 mb-2">Fully Restricted</h3>
        <ul className="list-disc list-inside space-y-2 ml-4">
          {fullBlockStates.map((state) => (
            <li key={state.code}>
              <strong>{state.name}:</strong> {state.details} ({state.legalBasis})
            </li>
          ))}
        </ul>
        <h3 className="text-lg font-semibold text-cyan-300 mt-4 mb-2">Paid Contests Restricted</h3>
        <ul className="list-disc list-inside space-y-2 ml-4">
          {paidBlockStates.map((state) => (
            <li key={state.code}>
              <strong>{state.name}:</strong> {state.details} ({state.legalBasis})
            </li>
          ))}
        </ul>
        <p className="mt-3">
          Using a VPN or proxy to bypass a state restriction may itself violate that state’s law. This platform does
          not provide legal advice — if you are unsure whether fantasy sports participation is legal in your
          jurisdiction, consult a licensed attorney. For full detail, see our{" "}
          <Link href="/disclaimer" className="text-cyan-400 hover:text-cyan-300">
            Disclaimer
          </Link>
          .
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Why This Matters to Us</h2>
        <p>
          &quot;No gambling&quot; is not a legal footnote for AllFantasy — it is a product decision. We would rather
          build the best commissioner and manager tools in fantasy sports than chase gambling revenue, and every
          feature we ship is built with that line in mind.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Reporting a Concern</h2>
        <p>
          If you believe a league, feature, or third-party integration is being used in a way that violates this
          policy, contact{" "}
          <a href="mailto:support@allfantasy.ai" className="text-cyan-400 hover:text-cyan-300">
            support@allfantasy.ai
          </a>{" "}
          right away.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Related Policies</h2>
        <p>
          See our full{" "}
          <Link href="/disclaimer" className="text-cyan-400 hover:text-cyan-300">
            Disclaimer
          </Link>
          ,{" "}
          <Link href="/terms" className="text-cyan-400 hover:text-cyan-300">
            Terms of Service
          </Link>
          , and{" "}
          <Link href="/mission" className="text-cyan-400 hover:text-cyan-300">
            Mission
          </Link>
          .
        </p>
      </section>
    </LegalPageRenderer>
  )
}
