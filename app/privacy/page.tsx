import Link from "next/link"
import LegalPageRenderer, { LEGAL_LAST_UPDATED } from "@/components/legal/LegalPageRenderer"
import { getSignupReturnUrl } from "@/lib/legal/LegalRouteResolver"
import type { Metadata } from 'next'
import { buildSeoMeta } from '@/lib/seo'

interface PrivacyPageProps {
  searchParams?: Promise<{ from?: string; next?: string }> | { from?: string; next?: string }
}

// Routed through buildSeoMeta for a canonical and page-specific OpenGraph;
// see app/terms/page.tsx for why a bare metadata object was not enough.
export const metadata: Metadata = buildSeoMeta({
  title: "Privacy Policy | AllFantasy",
  description: "Privacy Policy for AllFantasy - AI-powered fantasy sports platform",
  canonicalPath: '/privacy',
})

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
      backLabel={fromSignup ? "Back to Sign Up" : "Back to Home"}
    >
      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">1. Introduction</h2>
        <p>
          AllFantasy (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) operates the AllFantasy.ai website and related services (collectively, the &quot;Service&quot;).
          This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our Service.
        </p>
        <p className="mt-3">
          By accessing or using AllFantasy, you agree to this Privacy Policy. If you do not agree, please do not access the Service.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">2. Information We Collect</h2>
        <h3 className="text-lg font-semibold text-cyan-300 mt-4 mb-2">2.1 Information You Provide</h3>
        <ul className="list-disc list-inside space-y-2 ml-4">
          <li>Fantasy platform usernames (Sleeper, Yahoo, MFL, Fantrax)</li>
          <li>Email address and account information</li>
          <li>Feedback and correspondence</li>
          <li>Community league submissions and ideas</li>
        </ul>
        <h3 className="text-lg font-semibold text-cyan-300 mt-4 mb-2">2.2 Information Collected Automatically</h3>
        <ul className="list-disc list-inside space-y-2 ml-4">
          <li>Device information (browser type, operating system)</li>
          <li>Usage data (pages visited, features used)</li>
          <li>IP address and approximate location</li>
          <li>Cookies and similar technologies</li>
        </ul>
        <h3 className="text-lg font-semibold text-cyan-300 mt-4 mb-2">2.3 Third-Party Platform Data</h3>
        <p>
          When you connect fantasy accounts, we access <strong>publicly available</strong> league data through official APIs (Sleeper, Yahoo, MFL, Fantrax).
        </p>
        <ul className="list-disc list-inside space-y-2 ml-4 mt-2">
          <li>League names, settings, rosters, standings, trades, drafts</li>
        </ul>
        <p className="mt-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-300 text-sm">
          <strong>Important:</strong> We never request or store your passwords for third-party platforms. We only access data available through their APIs.
        </p>
        <h3 className="text-lg font-semibold text-cyan-300 mt-4 mb-2">Geographic Location Data</h3>
        <p>
          We collect your approximate geographic location (country, U.S. state/region) for legal compliance purposes. This data is
          derived from your IP address using Vercel&apos;s network infrastructure and may be supplemented by VPN/proxy detection
          services.
        </p>
        <p className="mt-3">We use this data solely to:</p>
        <ul className="list-disc list-inside space-y-2 ml-4 mt-2">
          <li>Comply with state laws restricting fantasy sports participation in certain U.S. states</li>
          <li>Prevent circumvention of legally required restrictions</li>
          <li>Provide you with accurate information about available features</li>
        </ul>
        <p className="mt-3">
          We do not sell your geographic data. We do not store precise location data. State-level location data may be stored on
          your account record for compliance purposes.
        </p>
        <p className="mt-3">
          If you believe your state has been incorrectly identified, contact{" "}
          <a href="mailto:support@allfantasy.ai" className="text-cyan-400 hover:text-cyan-300">
            support@allfantasy.ai
          </a>
          . We may request verification of your actual location.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">3. How We Use Your Information</h2>
        <ul className="list-disc list-inside space-y-2 ml-4">
          <li>To provide, maintain, and improve the Service</li>
          <li>To generate AI-powered analysis and recommendations</li>
          <li>To calculate rankings and tier progression</li>
          <li>To send notifications (if opted in)</li>
          <li>To respond to inquiries and prevent abuse</li>
          <li>To comply with legal obligations</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">4. AI and Machine Learning</h2>
        <p>
          We use AI to analyze fantasy data and provide insights. Your data may be used to improve our models and generate personalized content.
          AI-generated content is for informational and entertainment purposes only; we do not guarantee its accuracy.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">5. Information Sharing</h2>
        <p>We may share information with service providers, when required by law, to protect rights, or in connection with a business transfer.</p>
        <p className="mt-3 p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-cyan-300 text-sm">
          We do not sell your personal information to third parties for marketing.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">6. Data Retention and Security</h2>
        <p>
          We retain information as needed to provide the Service. Upon account deletion we remove personal information within 30 days where not required by law.
          We implement measures to protect your data, but no transmission or storage is 100% secure.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">7. Your Rights</h2>
        <p>
          Depending on location, you may have rights to access, correct, delete, or port your data, and to opt out of marketing.
          Contact us to exercise these rights.
        </p>
        <p className="mt-3">
          For account deletion requests, visit our{" "}
          <Link href="/data-deletion" className="text-cyan-400 hover:text-cyan-300">
            Data Deletion
          </Link>{" "}
          page.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">8. Cookies, Children, International, Third-Party Links</h2>
        <p>
          We use cookies and similar technologies; you can control them via browser settings. The Service is not intended for users under 13. Data may be transferred to and processed in the United States. We are not responsible for third-party sites we link to.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">9. Changes and Contact</h2>
        <p>
          We may update this policy; the &quot;Last updated&quot; date will change. Continued use constitutes acceptance. Contact:{" "}
          <a href="mailto:privacy@allfantasy.ai" className="text-cyan-400 hover:text-cyan-300">
            privacy@allfantasy.ai
          </a>
          .
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">10. California Privacy Rights</h2>
        <p>
          California residents have additional rights under the CCPA (e.g., right to know, delete, opt-out of sale). We do not sell personal information.
        </p>
      </section>
    </LegalPageRenderer>
  )
}
