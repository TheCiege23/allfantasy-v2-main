import Link from "next/link"
import LegalPageRenderer, { legalLastUpdated } from "@/components/legal/LegalPageRenderer"
import { getSignupReturnUrl } from "@/lib/legal/LegalRouteResolver"

interface MissionPageProps {
  searchParams?: Promise<{ from?: string; next?: string }> | { from?: string; next?: string }
}

export const metadata = {
  title: "Our Mission | AllFantasy",
  description:
    "AllFantasy's mission: commissioner-first, AI-powered fantasy sports tools for every league, season, and sport — designed without gambling.",
}

export default async function MissionPage({ searchParams }: MissionPageProps) {
  const params = searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  const fromSignup = params.from === "signup"
  const next = typeof params.next === "string" ? params.next : undefined
  const signupHref = getSignupReturnUrl(next)

  return (
    <LegalPageRenderer
      title="Our Mission"
      description={`Last updated: ${legalLastUpdated("mission")}`}
      backHref={fromSignup ? signupHref : "/"}
      backLabel={fromSignup ? "Back to Sign Up" : "Back to Home"}
    >
      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Why AllFantasy Exists</h2>
        <p>
          AllFantasy helps fantasy sports players draft smarter, manage better, and build a lasting legacy across
          every league, season, and sport — powered by AI, built for commissioners, and designed without gambling.
        </p>
        <p className="mt-3">
          Fantasy sports live and die on the work commissioners do behind the scenes: setting up scoring, chasing
          down inactive managers, settling disputes, and keeping a league alive season after season. We built
          AllFantasy to take that workload off commissioners and give every manager in the league better tools to
          compete, without turning the game into something it was never meant to be.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">What We Believe</h2>
        <ul className="list-disc list-inside space-y-2 ml-4">
          <li>
            <strong>Commissioner-first.</strong> The best fantasy tools should serve the people running the league,
            not just the players in it.
          </li>
          <li>
            <strong>AI should help, not replace.</strong> Our AI features are optional guidance — the platform is
            fully useful with AI turned off. See our{" "}
            <Link href="/ai-transparency" className="text-cyan-400 hover:text-cyan-300">
              AI Transparency
            </Link>{" "}
            page.
          </li>
          <li>
            <strong>Fair play matters.</strong> Anti-collusion and anti-cheating protections exist so every manager
            competes on the same footing.
          </li>
          <li>
            <strong>Free for players.</strong> Core league management and gameplay is free. Optional premium tools
            fund the platform — never gambling.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">What We Are Not</h2>
        <p>
          AllFantasy is 100% fantasy sports management, analysis, and entertainment. We are not a sportsbook, not a
          daily fantasy sports (DFS) operator, and we do not facilitate real-money wagering of any kind. Read the
          full details on our{" "}
          <Link href="/no-gambling-policy" className="text-cyan-400 hover:text-cyan-300">
            No Gambling Policy
          </Link>{" "}
          page.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Who We Serve</h2>
        <p>
          Commissioners and managers running season-long leagues across the NFL, NBA, MLB, NHL, and NCAA football —
          in redraft, dynasty, and keeper formats — plus bracket and World Cup pools. AllFantasy imports leagues
          from Sleeper, Yahoo, ESPN, MFL, and Fantrax so you can bring your existing league with you.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Related Policies</h2>
        <p>
          Learn more about how we operate in our{" "}
          <Link href="/no-gambling-policy" className="text-cyan-400 hover:text-cyan-300">
            No Gambling Policy
          </Link>
          ,{" "}
          <Link href="/ai-transparency" className="text-cyan-400 hover:text-cyan-300">
            AI Transparency
          </Link>{" "}
          page,{" "}
          <Link href="/terms" className="text-cyan-400 hover:text-cyan-300">
            Terms of Service
          </Link>
          , and{" "}
          <Link href="/privacy" className="text-cyan-400 hover:text-cyan-300">
            Privacy Policy
          </Link>
          .
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Contact</h2>
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="font-semibold text-white">Questions about our mission?</p>
          <p className="text-white/70">
            Email:{" "}
            <a href="mailto:support@allfantasy.ai" className="text-cyan-400 hover:text-cyan-300">
              support@allfantasy.ai
            </a>
          </p>
        </div>
      </section>
    </LegalPageRenderer>
  )
}
