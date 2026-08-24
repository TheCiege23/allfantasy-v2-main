import Link from "next/link"
import LegalPageRenderer, { LEGAL_LAST_UPDATED } from "@/components/legal/LegalPageRenderer"
import { getSignupReturnUrl } from "@/lib/legal/LegalRouteResolver"
import type { Metadata } from 'next'
import { buildSeoMeta } from '@/lib/seo'

interface AiTransparencyPageProps {
  searchParams?: Promise<{ from?: string; next?: string }> | { from?: string; next?: string }
}

// Routed through buildSeoMeta for a canonical and page-specific OpenGraph;
// see app/terms/page.tsx for why a bare metadata object was not enough.
export const metadata: Metadata = buildSeoMeta({
  title: "AI Transparency | AllFantasy",
  description:
    "How AllFantasy uses AI: trade analysis, rankings, and recommendations are guidance, not guarantees. AI is always optional.",
  canonicalPath: '/ai-transparency',
})

export default async function AiTransparencyPage({ searchParams }: AiTransparencyPageProps) {
  const params = searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  const fromSignup = params.from === "signup"
  const next = typeof params.next === "string" ? params.next : undefined
  const signupHref = getSignupReturnUrl(next)

  return (
    <LegalPageRenderer
      title="AI Transparency"
      description={`Last updated: ${LEGAL_LAST_UPDATED}`}
      backHref={fromSignup ? signupHref : "/"}
      backLabel={fromSignup ? "Back to Sign Up" : "Back to Home"}
    >
      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">How We Use AI</h2>
        <p>
          AllFantasy uses AI across several tools to help you make faster, better-informed fantasy decisions,
          including trade analysis and grading, waiver wire recommendations, power rankings and tiers, mock draft
          assistance, and the{" "}
          <Link href="/ai/tools" className="text-cyan-400 hover:text-cyan-300">
            AF Intelligence Hub
          </Link>
          .
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">AI Is Always Optional</h2>
        <p>
          You can use AllFantasy fully without ever touching an AI feature. AI tools are opt-in enhancements —
          commissioners and managers who prefer to make every call themselves can ignore them entirely and lose no
          core league management functionality.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Guidance, Not Guarantees</h2>
        <p>
          Our AI tools provide guidance and informational content only. They do not guarantee outcomes, wins, or
          specific results. Past performance and AI analysis are not predictors of future results. You are solely
          responsible for your fantasy decisions; use of our AI tools is at your own risk.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">What Data Our AI Uses</h2>
        <p>
          Our AI features analyze the fantasy data available to your account — league settings, rosters, scoring,
          transaction history, and publicly available player statistics — to generate rankings, trade grades, and
          recommendations. We do not use your private messages or payment information to run AI features. See our{" "}
          <Link href="/privacy" className="text-cyan-400 hover:text-cyan-300">
            Privacy Policy
          </Link>{" "}
          for full detail on data collection and use.
        </p>
      </section>

      {/*
        ⚠ THE PAGE TITLED "AI TRANSPARENCY" DID NOT SAY THAT DATA LEAVES ALLFANTASY.
        It described "models we configure and monitor", which reads as first-party.
        It is not: lib/ai/providerRouter.ts routes to OpenAI, Anthropic, xAI and
        DeepSeek clients, and lib/ai/*, lib/simulation-engine/* and others make
        real outbound calls to api.openai.com, api.anthropic.com, api.x.ai and
        api.deepseek.com.

        The Privacy Policy does not close the gap either — its section 4 says
        "your data may be used to improve OUR models", which points the same wrong
        way, and its sharing section only mentions "service providers" generically.
        So a reader who went looking for this specific fact, on the two pages meant
        to carry it, would not have found it.

        Deliberately not naming the vendors here: the three internal lists disagree
        (aiConfig and providerRouter say openai/anthropic/xai/deepseek, while
        provider-status-service says openai/deepseek/grok/clearsports), and which
        names to publish is a disclosure decision for the owner, not a fix an audit
        should make unilaterally. Flagged rather than guessed.
      */}
      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Where AI Processing Happens</h2>
        <p>
          AllFantasy does not train or host its own large language models. Our AI features are powered in part by{" "}
          <strong>third-party AI providers</strong>, which means that when you use an AI tool, the information
          needed to answer it — such as the relevant league settings, rosters, and player statistics described
          below — is sent to one of those providers to generate the result.
        </p>
        <p className="mt-3">
          We choose which provider handles a given request, and providers are bound by their own terms and
          security commitments. The set of providers we use can change as models improve. If you would rather no
          part of your league data be processed this way, you can simply not use the AI features — see{" "}
          <strong>AI Is Always Optional</strong> above.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Human Oversight</h2>
        <p>
          AI outputs are generated by models we select, configure and monitor; they are not individually reviewed
          by a person before being shown to you in real time. If an AI tool produces something inaccurate,
          offensive, or wrong, tell us — we use that feedback to tune our tools.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">AI Never Recommends Gambling</h2>
        <p>
          Our AI tools operate within the same boundaries as the rest of the platform: no wagering suggestions, no
          odds, and no gambling products of any kind. See our{" "}
          <Link href="/no-gambling-policy" className="text-cyan-400 hover:text-cyan-300">
            No Gambling Policy
          </Link>
          .
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Related Policies</h2>
        <p>
          Learn more in our{" "}
          <Link href="/privacy" className="text-cyan-400 hover:text-cyan-300">
            Privacy Policy
          </Link>
          ,{" "}
          <Link href="/disclaimer" className="text-cyan-400 hover:text-cyan-300">
            Disclaimer
          </Link>
          , and{" "}
          <Link href="/terms" className="text-cyan-400 hover:text-cyan-300">
            Terms of Service
          </Link>
          .
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Contact</h2>
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="font-semibold text-white">Questions or feedback about an AI feature?</p>
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
