import Link from "next/link"
import LegalPageRenderer, {
  LEGAL_LAST_UPDATED,
  LegalCallout,
  LegalPolicyGrid,
} from "@/components/legal/LegalPageRenderer"
import { TERMS_PAGE_TITLE, TERMS_POLICY_CHECKLIST } from "@/lib/legal/TermsPageService"
import { getSignupReturnUrl } from "@/lib/legal/LegalRouteResolver"

interface TermsPageProps {
  searchParams?: Promise<{ from?: string; next?: string }> | { from?: string; next?: string }
}

export const metadata = {
  title: "Terms of Service | AllFantasy",
  description: "Terms of Service for AllFantasy - AI-powered fantasy sports platform",
}

export default async function TermsPage({ searchParams }: TermsPageProps) {
  const params = searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  const fromSignup = params.from === "signup"
  const next = typeof params.next === "string" ? params.next : undefined
  const signupHref = getSignupReturnUrl(next)

  return (
    <LegalPageRenderer
      title={TERMS_PAGE_TITLE}
      description={`Last updated: ${LEGAL_LAST_UPDATED}`}
      backHref={fromSignup ? signupHref : "/"}
      backLabel={fromSignup ? "Back to sign up" : "Back to home"}
    >
      {/*
        ⚠ COPY CONTRACT — THE GEOGRAPHIC SPECIFICS ARE EXACT AND MUST STAY IN SYNC
        WITH LEGAL AND WITH THE CODE THAT ENFORCES THEM. WA is excluded outright;
        HI, ID, MT and NV are excluded from PAID leagues only. These are the same
        rules useGeoRestriction applies at runtime, so a drift here is a page that
        tells a user something different from what the product will do. Clause 7
        below carries the statutory citations behind each one.
      */}
      <LegalCallout tone="warn" mark="§" title="Geographic restrictions">
        U.S. state laws may fully or partially restrict fantasy sports. AllFantasy is not available
        in Washington. Paid leagues are restricted in Hawaii, Idaho, Montana and Nevada. We check
        your state to apply these rules, not to track you.
      </LegalCallout>

      {/*
        ⚠ COMPLIANCE-CRITICAL AND NOT TO BE PARAPHRASED — 17b's copy contract. The
        read-only claim in particular is a statement about what our integrations
        do, and it is true: the import paths never write back to a connected
        platform.
      */}
      <LegalCallout tone="accent" title="100% season-long fantasy sports">
        There is no sportsbook, no daily fantasy and no wagering on AllFantasy. We are read-only on
        every platform you connect — we never place a claim, accept a trade or set a lineup on your
        behalf.
      </LegalCallout>

      <section id="policies-in-short">
        <h2>The policies, in short</h2>
        {/*
          ⚠ THIS GRID IS A TABLE OF CONTENTS, NOT THE TERMS. 17b's build note says
          each cell "links out to (or expands into) the full clause" — so every one
          of these is an anchor into the numbered clause below that actually binds,
          and the full text stays on the page underneath. A summary presented as
          the agreement would be the one thing a terms page must never do.
        */}
        <LegalPolicyGrid
          items={[
            { name: "Platform rules", summary: "Use the service lawfully and follow the in-product rules.", href: "#clause-3" },
            { name: "Anti-collusion", summary: "Collusion and coordinated manipulation are prohibited.", href: "#clause-4" },
            { name: "Anti-cheating", summary: "Cheating, bot abuse and unfair automation are prohibited.", href: "#clause-4" },
            { name: "Acceptable use", summary: "No abuse, harassment, scraping abuse or unauthorized access.", href: "#clause-5" },
            { name: "Intelligence use", summary: "Generated content is informational and may be imperfect.", href: "#clause-6" },
            { name: "Geographic eligibility", summary: "Where the service and paid leagues are available, and why we check.", href: "#clause-7" },
            { name: "No manipulation or exploits", summary: "Don't exploit bugs or manipulate platform outcomes.", href: "#clause-8" },
            { name: "Paid vs free features", summary: "Paid features follow disclosed pricing; free features stay available as offered.", href: "#clause-9" },
            { name: "Subscriptions and tokens", summary: "Purchases follow in-product pricing and the applicable refund policy.", href: "#clause-9" },
            { name: "Account responsibilities", summary: "Keep your credentials secure; you're responsible for activity on your account.", href: "#clause-10" },
            { name: "Content moderation", summary: "We may remove or restrict harmful or non-compliant content.", href: "#clause-11" },
            { name: "Dispute handling", summary: "User-to-user disputes are between users; disputes with us follow the Terms process.", href: "#clause-12" },
            { name: "Imported & external data", summary: "Imported third-party data depends on external sources and may change.", href: "#clause-13" },
            { name: "Limitation of liability", summary: "The service is provided as-is, with the liability limits defined in the Terms.", href: "#clause-18" },
            { name: "Platform updates", summary: "We may update features and policies over time.", href: "#clause-22" },
          ]}
        />
      </section>

      <section id="clause-1">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">1. Acceptance of Terms</h2>
        <p>
          By accessing or using AllFantasy (&quot;Service&quot;), you agree to be bound by these Terms of Service (&quot;Terms&quot;).
          If you do not agree, do not use the Service. We may modify these Terms; continued use after changes constitutes acceptance.
        </p>
      </section>

      <section id="clause-2">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">2. Description of Service</h2>
        <p>
          AllFantasy provides AI-powered fantasy sports analysis, trade evaluations, waiver recommendations, league rankings,
          career statistics, and related tools. The Service may integrate with third-party fantasy platforms (e.g., Sleeper, Yahoo,
          MFL, Fantrax) to access league data where you have authorized or made it available.
        </p>
      </section>

      <section id="clause-3">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">3. Platform Rules</h2>
        <p>
          You must use the Service in accordance with these Terms and any in-product rules we publish. You may not use the Service
          to violate any law, infringe others&apos; rights, or abuse other users or the platform. We may enforce these rules through
          warnings, suspension, or termination of access.
        </p>
      </section>

      <section id="clause-4">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">4. Anti-Collusion and Anti-Cheating</h2>
        <p>
          Collusion (e.g., secret agreements between managers to distort league outcomes or disadvantage others) and cheating
          (e.g., manipulating data, using bots or automation to gain an unfair advantage, or circumventing platform rules) are
          prohibited. We may remove or restrict accounts involved in such behavior and reserve the right to report activity to
          league commissioners or third-party platforms where appropriate.
        </p>
      </section>

      <section id="clause-5">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">5. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
          <li>Use the Service for any illegal or unauthorized purpose</li>
          <li>Interfere with or disrupt the Service or servers</li>
          <li>Attempt to gain unauthorized access to any system, account, or data</li>
          <li>Harass, abuse, or harm other users</li>
          <li>Scrape, crawl, or automate access in a way that violates our policies or overburdens our systems</li>
          <li>Resell or commercially exploit the Service without our written permission</li>
        </ul>
      </section>

      <section id="clause-6">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">6. AI Use Policy</h2>
        <p>
          Our AI tools are provided for informational and entertainment purposes. AI-generated content (recommendations, rankings,
          analysis) is not guaranteed to be accurate or complete and should not be the sole basis for decisions. You assume the
          risk of relying on such content. You may not use the Service to generate content for resale or to train external AI
          models without our permission.
        </p>
      </section>

      <section id="clause-7">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">7. Geographic Restrictions and Eligibility</h2>
        <p>
          AllFantasy.ai complies with all applicable U.S. state and local laws regarding fantasy sports. Access to certain features
          of AllFantasy.ai is restricted based on your geographic location.
        </p>
        <h3 className="text-lg font-semibold text-cyan-300 mt-4 mb-2">7.1 Fully Restricted States</h3>
        <p>
          The following state prohibits ALL fantasy sports activities, including free contests, under state law. AllFantasy.ai is
          entirely unavailable in this state:
        </p>
        <ul className="list-disc list-inside space-y-2 ml-4 mt-2">
          <li>
            <strong>Washington State</strong> — Prohibited under RCW 9.46.240. Washington law classifies all fantasy sports as sports
            wagering. Operating, offering, or advertising fantasy sports, including free contests, is a Class C felony under
            Washington state law. AllFantasy.ai cannot provide any services to users located in Washington state.
          </li>
        </ul>
        <h3 className="text-lg font-semibold text-cyan-300 mt-4 mb-2">7.2 Paid League Restricted States</h3>
        <p>
          The following states prohibit paid fantasy sports contests under state law. Residents of these states may create free
          accounts and use free features, but are prohibited from joining paid leagues, paying entry fees, or purchasing
          subscriptions:
        </p>
        <ul className="list-disc list-inside space-y-2 ml-4 mt-2">
          <li>
            <strong>Hawaii</strong> — Paid DFS prohibited per AG Opinion 16-1 (2016).
          </li>
          <li>
            <strong>Idaho</strong> — Paid DFS prohibited per Idaho Code §18-3802 and AG Opinion (May 2016).
          </li>
          <li>
            <strong>Montana</strong> — Paid DFS prohibited per Montana Code §23-5-802.
          </li>
          <li>
            <strong>Nevada</strong> — Paid DFS requires a sports betting license per NV Gaming Control Board ruling (2015). No DFS
            operator currently holds such a license in Nevada.
          </li>
        </ul>
        <h3 className="text-lg font-semibold text-cyan-300 mt-4 mb-2">7.3 VPN and Proxy Usage</h3>
        <p>
          Using a VPN, proxy, or any other method to circumvent geographic restrictions while in a restricted state is a violation
          of these Terms of Service and may constitute a violation of applicable state law. AllFantasy.ai employs VPN and proxy
          detection technology. Accounts found to be circumventing geographic restrictions may be immediately suspended and any
          winnings or prizes forfeited.
        </p>
        <h3 className="text-lg font-semibold text-cyan-300 mt-4 mb-2">7.4 User Representation</h3>
        <p>
          By creating an account or accessing AllFantasy.ai, you represent and warrant that you are not located in a state where
          such access or participation is prohibited by law. If applicable law in your jurisdiction prohibits your participation,
          you are not authorized to use AllFantasy.ai.
        </p>
        <h3 className="text-lg font-semibold text-cyan-300 mt-4 mb-2">7.5 Changes in Law</h3>
        <p>
          Fantasy sports laws are subject to change. AllFantasy.ai will update its geographic restrictions when state laws change.
          Updated restrictions take effect immediately. Check this section for the most current list.
        </p>
      </section>

      <section id="clause-8">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">8. No Manipulation or Exploits</h2>
        <p>
          You may not manipulate rankings, scores, or other platform data, or exploit bugs or design flaws to gain an unfair
          advantage. If you discover a vulnerability, you agree to report it to us and not to exploit it.
        </p>
      </section>

      <section id="clause-9">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">9. Paid vs. Free Leagues; Subscriptions and Tokens</h2>
        <p>
          AllFantasy may offer free and paid features (e.g., subscriptions, in-app tokens, or premium tiers). Paid features are
          subject to the pricing and payment terms disclosed at the time of purchase. AllFantasy does not collect league dues,
          host prize pools, or distribute league payouts. If your league is paid, commissioners are responsible for configuring and
          managing FanCred for any dues and payout activity, and those transactions remain external to AllFantasy. Refunds for our
          own subscriptions or tokens are governed by our then-current refund policy.
        </p>
      </section>

      <section id="clause-10">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">10. Account Responsibilities</h2>
        <p>You agree to:</p>
        <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
          <li>Provide accurate information and be at least 18 years old (or the age of majority in your jurisdiction) where required</li>
          <li>Keep your account credentials confidential</li>
          <li>Notify us of any unauthorized use of your account</li>
          <li>Accept responsibility for all activity under your account</li>
        </ul>
      </section>

      <section id="clause-11">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">11. Content Moderation</h2>
        <p>
          We may remove or refuse content (including user-generated content) that violates these Terms or that we deem harmful,
          misleading, or otherwise inappropriate. We are not obligated to host or display any content and may modify or discontinue
          features without liability.
        </p>
      </section>

      <section id="clause-12">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">12. Dispute Handling</h2>
        <p>
          Disputes between users (e.g., league or trade disputes) are between those users; we are not obligated to resolve them.
          For disputes with us, you agree to seek resolution in good faith (e.g., by contacting legal@allfantasy.ai) before
          pursuing formal legal action. These Terms and any dispute are governed by the laws of the United States; you consent to
          the jurisdiction of courts of competent jurisdiction.
        </p>
      </section>

      <section id="clause-13">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">13. Legacy Import and External Data</h2>
        <p>
          Where we offer legacy or historical import (e.g., from Sleeper, Yahoo, ESPN, MFL, Fleaflicker, Fantrax), you are
          responsible for ensuring you have the right to provide that data and that your use complies with those platforms&apos;
          terms. We use such data to provide rankings, levels, and related features. We do not guarantee the accuracy or
          completeness of imported data and are not responsible for how third-party platforms provide or change their data.
        </p>
      </section>

      <section id="clause-14">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">14. Intellectual Property</h2>
        <p>
          AllFantasy content, features, and functionality are our property or our licensors&apos; and are protected by
          intellectual property laws. You may not copy, modify, distribute, or create derivative works without our prior written
          consent.
        </p>
      </section>

      <section id="clause-15">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">15. User Content</h2>
        <p>
          By submitting content to AllFantasy (e.g., feedback, league ideas), you grant us a non-exclusive, worldwide,
          royalty-free license to use, reproduce, modify, and distribute such content in connection with the Service.
        </p>
      </section>

      <section id="clause-16">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">16. Third-Party Platforms</h2>
        <p>
          The Service may integrate with third-party fantasy or other platforms. Your use of those platforms is subject to their
          terms and policies. We are not responsible for their practices or content.
        </p>
      </section>

      <section id="clause-17">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">17. Disclaimer of Warranties</h2>
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200 text-sm">
          <p className="font-bold mb-2">THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND.</p>
          <p>
            AllFantasy disclaims all warranties, express or implied. We do not warrant that the Service will be uninterrupted,
            secure, or error-free.
          </p>
        </div>
      </section>

      <section id="clause-18">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">18. Limitation of Liability</h2>
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-200 text-sm">
          IN NO EVENT SHALL ALLFANTASY, ITS OFFICERS, DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
          SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES (INCLUDING LOSS OF PROFITS, DATA, OR USE) RESULTING FROM YOUR ACCESS TO
          OR USE OF—OR INABILITY TO ACCESS OR USE—THE SERVICE, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
        </div>
      </section>

      <section id="clause-19">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">19. Indemnification</h2>
        <p>
          You agree to defend, indemnify, and hold harmless AllFantasy and its officers, directors, employees, and agents from
          and against any claims, liabilities, damages, losses, or expenses arising out of your violation of these Terms or your
          use of the Service.
        </p>
      </section>

      <section id="clause-20">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">20. No Gambling or Betting</h2>
        <p>
          AllFantasy is not a gambling or betting service. We do not facilitate or endorse real-money gambling or DFS. Our
          analysis is for entertainment and informational purposes in the context of recreational fantasy sports only.
        </p>
      </section>

      <section id="clause-21">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">21. Termination</h2>
        <p>
          We may terminate or suspend your access immediately, without prior notice, for any reason, including breach of these
          Terms.
        </p>
      </section>

      <section id="clause-22">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">22. Platform Updates and Changes</h2>
        <p>
          We may change, suspend, or discontinue features or the Service at any time. We will use reasonable efforts to notify
          users of material changes (e.g., via the Service or email). Your continued use after changes constitutes acceptance.
          We are not liable for any change or discontinuation.
        </p>
      </section>

      <section id="clause-23">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">23. Severability and Entire Agreement</h2>
        <p>
          If any provision is held unenforceable, the remaining provisions remain in effect. These Terms, together with our
          <Link href="/disclaimer" className="text-cyan-400 hover:text-cyan-300 mx-1">Disclaimer</Link> and
          <Link href="/privacy" className="text-cyan-400 hover:text-cyan-300 mx-1">Privacy Policy</Link>, constitute the entire
          agreement between you and AllFantasy regarding the Service.
        </p>
      </section>

      <section id="clause-24">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">24. Contact</h2>
        <p>
          Questions about these Terms? Contact us at:
        </p>
        <div className="mt-3 p-4 bg-white/5 rounded-xl border border-white/10">
          <p className="font-semibold text-white">AllFantasy</p>
          <p className="text-white/60">Email: legal@allfantasy.ai</p>
        </div>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Policy Coverage Checklist</h2>
        <ul className="list-disc list-inside space-y-1 ml-4 text-white/70 text-sm">
          {TERMS_POLICY_CHECKLIST.map((item) => (
            <li key={item.heading}>
              <strong className="text-white/85">{item.heading}:</strong> {item.body}
            </li>
          ))}
        </ul>
      </section>
      {/*
        ⚠ TWO SEPARATE AGREEMENTS, AND THE FORM MUST SAY WHICH ONE IS MISSING.
        17b's copy contract: sign-up is gated on the fantasy-sports disclaimer AND
        these Terms as distinct checkboxes. One combined "I agree to everything"
        box would not be the consent either document asks for.
      */}
      <section id="signup-gate">
        <div className="af-legal-callout">
          <div>
            <p>
              Sign-up is gated on two checkboxes: the fantasy-sports disclaimer (no gambling or DFS)
              and these Terms. Miss either and the form tells you which one.
            </p>
            <p style={{ marginTop: 12, marginBottom: 0 }}>
              <Link href={signupHref} className="af-legal-cta">
                Back to sign up
              </Link>
            </p>
          </div>
        </div>
      </section>
    </LegalPageRenderer>
  )
}
