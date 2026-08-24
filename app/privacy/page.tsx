import Link from "next/link"
import LegalPageRenderer, {
  LEGAL_LAST_UPDATED,
  LegalBox,
  LegalCallout,
  LegalGrid,
} from "@/components/legal/LegalPageRenderer"
import { getSignupReturnUrl } from "@/lib/legal/LegalRouteResolver"

interface PrivacyPageProps {
  searchParams?: Promise<{ from?: string; next?: string }> | { from?: string; next?: string }
}

export const metadata = {
  title: "Privacy Policy | AllFantasy",
  description: "Privacy Policy for AllFantasy — the fantasy sports intelligence platform",
}

/**
 * Handoff 17a — privacy policy.
 *
 * ⚠ THE STRUCTURE IS THE HANDOFF'S; THE LEGAL TEXT IS THE ONE THAT WAS ALREADY
 * HERE. 17a's build note says to treat body copy as placeholder pending legal
 * review but to preserve section order exactly — so this change re-lays the page
 * out and does NOT rewrite the policy. Every substantive sentence from the
 * previous version survives, including the ones the mock's condensed copy leaves
 * out (the Vercel-derived IP note, the three specific uses of location data, the
 * 30-day deletion window, the under-13 line). A redesign that quietly shortens a
 * privacy policy is a change to what was disclosed, not to how it looks.
 *
 * ⚠ "INTELLIGENCE & MODELS", NOT "AI AND MACHINE LEARNING". Section 4 is renamed
 * to match both the handoff and the product-wide copy rule against the bare term
 * "AI". The disclosure itself is unchanged.
 */
export default async function PrivacyPage({ searchParams }: PrivacyPageProps) {
  const params = searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  const fromSignup = params.from === "signup"
  const next = typeof params.next === "string" ? params.next : undefined
  const signupHref = getSignupReturnUrl(next)

  return (
    <LegalPageRenderer
      title="Privacy Policy"
      description={`Last updated: ${LEGAL_LAST_UPDATED}`}
      backHref={fromSignup ? signupHref : "/"}
      backLabel={fromSignup ? "Back to sign up" : "Back to home"}
    >
      <section id="introduction">
        <h2>1. Introduction</h2>
        <p>
          AllFantasy (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) operates the AllFantasy.ai
          website and related services (collectively, the &quot;Service&quot;). This Privacy Policy
          explains how we collect, use, disclose, and safeguard your information when you use our
          Service.
        </p>
        <p>
          By accessing or using AllFantasy, you agree to this Privacy Policy. If you do not agree,
          please do not access the Service.
        </p>
      </section>

      <section id="information-we-collect">
        <h2>2. Information we collect</h2>

        <LegalGrid>
          <LegalBox eyebrow="2.1 You provide">
            <ul>
              <li>Fantasy platform usernames (Sleeper, Yahoo, MFL, Fantrax)</li>
              <li>Email address and account information</li>
              <li>Feedback and correspondence</li>
              <li>Community league submissions and ideas</li>
            </ul>
          </LegalBox>
          <LegalBox eyebrow="2.2 Collected automatically">
            <ul>
              <li>Device information (browser type, operating system)</li>
              <li>Usage data (pages visited, features used)</li>
              <li>IP address and approximate location</li>
              <li>Cookies and similar technologies</li>
            </ul>
          </LegalBox>
        </LegalGrid>

        <h3>
          <span className="af-legal-eyebrow">2.3 Third-party platform data</span>
        </h3>
        <p>
          When you connect fantasy accounts, we access <strong>publicly available</strong> league
          data through official APIs (Sleeper, Yahoo, MFL, Fantrax) — league names, settings,
          rosters, standings, trades and drafts.
        </p>

        {/*
          ⚠ COPY CONTRACT — THIS CALLOUT IS A TRUST ANCHOR AND IS REPEATED VERBATIM
          ACROSS THE LEGAL AND AUTH SURFACES. 17a names it explicitly. Do not
          paraphrase it here and do not let it degrade into body text.
        */}
        <LegalCallout tone="good" mark="✓">
          <strong>Important:</strong> We never request or store your passwords for third-party
          platforms. We only access data available through their APIs.
        </LegalCallout>
      </section>

      <section id="location-data">
        <h2>Geographic location data</h2>
        <p>
          We collect your approximate geographic location (country, U.S. state or region) for legal
          compliance purposes. This data is derived from your IP address using our hosting
          provider&apos;s network infrastructure and may be supplemented by VPN/proxy detection
          services.
        </p>
        <p>We use this data solely to:</p>
        <ul>
          <li>Comply with state laws restricting fantasy sports participation in certain U.S. states</li>
          <li>Prevent circumvention of legally required restrictions</li>
          <li>Provide you with accurate information about available features</li>
        </ul>
        <p>
          We do not sell your geographic data. We do not store precise location data. State-level
          location data may be stored on your account record for compliance purposes.
        </p>
        {/*
          ⚠ TWO ADDRESSES, NOT ONE — 17a's copy contract. A location correction is
          an operations task and privacy@ is a rights inbox; collapsing them means
          one of the two queues starts missing what it is for.
        */}
        <p>
          If you believe your state has been incorrectly identified, contact{" "}
          <a href="mailto:support@allfantasy.ai">support@allfantasy.ai</a>. We may request
          verification of your actual location.
        </p>
      </section>

      <LegalGrid>
        <section id="how-we-use-it">
          <h2>3. How we use it</h2>
          <ul>
            <li>Provide, maintain and improve the Service</li>
            <li>Generate analysis and recommendations</li>
            <li>Calculate rankings and tier progression</li>
            <li>Send notifications, if you opted in</li>
            <li>Respond to inquiries and prevent abuse</li>
            <li>Comply with legal obligations</li>
          </ul>
        </section>

        <section id="intelligence-and-models">
          <h2>4. Intelligence &amp; models</h2>
          <p>
            We analyze fantasy data to produce insights. Your data may be used to improve our models
            and generate personalized content. Generated content is informational and for
            entertainment — we do not guarantee its accuracy.
          </p>
        </section>
      </LegalGrid>

      <section id="information-sharing">
        <h2>5. Information sharing</h2>
        <p>
          We may share information with service providers, when required by law, to protect rights,
          or in connection with a business transfer.
        </p>
        {/* 17a requires this line to stay visually distinct rather than buried. */}
        <LegalCallout tone="accent">
          <strong>We do not sell your personal information to third parties for marketing.</strong>
        </LegalCallout>
      </section>

      <LegalGrid>
        <section id="retention-and-security">
          <h2>6. Retention &amp; security</h2>
          <p>
            We keep information as long as needed to run the Service. After account deletion we
            remove personal information within 30 days where not required by law. We protect your
            data, but no transmission or storage is 100% secure.
          </p>
        </section>

        <section id="your-rights">
          <h2>7. Your rights</h2>
          <p>
            Depending on where you live you may have rights to access, correct, delete or port your
            data, and to opt out of marketing. Contact us to exercise them, or use the{" "}
            <Link href="/data-deletion">Data Deletion</Link> page.
          </p>
        </section>
      </LegalGrid>

      <LegalGrid>
        <section id="cookies-children-international">
          <h2>8. Cookies, children, international</h2>
          <p>
            We use cookies and similar technologies; control them in your browser settings. The
            Service is not intended for anyone under 13. Data may be transferred to and processed in
            the United States. We aren&apos;t responsible for third-party sites we link to.
          </p>
        </section>

        <section id="changes-and-contact">
          <h2>9. Changes &amp; contact</h2>
          <p>
            We may update this policy; the &quot;last updated&quot; date changes with it, and
            continued use is acceptance. Contact{" "}
            <a href="mailto:privacy@allfantasy.ai">privacy@allfantasy.ai</a>.
          </p>
        </section>
      </LegalGrid>

      <section id="california-rights">
        <h2>10. California rights</h2>
        <p>
          California residents have additional CCPA rights — to know, to delete, and to opt out of
          sale. We do not sell personal information.
        </p>
      </section>
    </LegalPageRenderer>
  )
}
