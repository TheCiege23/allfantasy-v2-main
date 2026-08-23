import Link from "next/link"
import LegalPageRenderer, { LEGAL_LAST_UPDATED } from "@/components/legal/LegalPageRenderer"
import { getSignupReturnUrl } from "@/lib/legal/LegalRouteResolver"
import type { Metadata } from 'next'
import { buildSeoMeta } from '@/lib/seo'

interface DataDeletionPageProps {
  searchParams?: Promise<{ from?: string; next?: string }> | { from?: string; next?: string }
}

// Routed through buildSeoMeta for a canonical and page-specific OpenGraph;
// see app/terms/page.tsx for why a bare metadata object was not enough.
export const metadata: Metadata = buildSeoMeta({
  title: "Data Deletion | AllFantasy",
  description: "How to request deletion of your AllFantasy account data and connected service information.",
  canonicalPath: '/data-deletion',
})

export default async function DataDeletionPage({ searchParams }: DataDeletionPageProps) {
  const params = searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  const fromSignup = params.from === "signup"
  const next = typeof params.next === "string" ? params.next : undefined
  const signupHref = getSignupReturnUrl(next)

  return (
    <LegalPageRenderer
      title="Data Deletion"
      description={`Last updated: ${LEGAL_LAST_UPDATED}`}
      backHref={fromSignup ? signupHref : "/"}
      backLabel={fromSignup ? "Back to Sign Up" : "Back to Home"}
    >
      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">1. How to Request Deletion</h2>
        <p>
          To request deletion of your AllFantasy account data, email{" "}
          <a href="mailto:privacy@allfantasy.ai" className="text-cyan-400 hover:text-cyan-300">
            privacy@allfantasy.ai
          </a>{" "}
          with the subject line <strong>Data Deletion Request</strong>.
        </p>
        <p className="mt-3">
          Include the email address, username, and any connected fantasy platform identifiers tied to your account so we can locate
          your records quickly and reduce delays.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">2. Identity Verification</h2>
        <p>
          Before deleting account data, we may ask you to verify account ownership to protect your information from unauthorized
          requests. If we cannot verify ownership, we may ask for additional details or decline the request.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">3. What We Delete</h2>
        <ul className="list-disc list-inside space-y-2 ml-4">
          <li>Account profile information we use to operate AllFantasy</li>
          <li>Connected account tokens and provider linkage data stored by AllFantasy</li>
          <li>Saved preferences, AI context, and other account-level personalization where applicable</li>
          <li>Associated support or feedback records that are not required for security, legal, or billing retention</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">4. What We May Retain</h2>
        <p>
          We may retain limited information when required for fraud prevention, security logging, legal compliance, dispute
          resolution, financial recordkeeping, or enforcement of our policies. When full deletion is not possible, we will limit
          further use and retain only what is reasonably necessary.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">5. Third-Party Services</h2>
        <p>
          If you connected services such as Sleeper, Yahoo, ESPN, MFL, Fleaflicker, or Fantrax, deleting your AllFantasy data does
          not delete data held by those platforms. You must manage deletion requests with each provider under their own policies.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">6. Timing</h2>
        <p>
          We aim to review verified requests promptly and complete deletion or anonymization within 30 days when reasonably possible,
          subject to technical and legal constraints.
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">7. Related Policies</h2>
        <p>
          For more information about how we collect, use, and retain information, review our{" "}
          <Link href="/privacy" className="text-cyan-400 hover:text-cyan-300">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="text-cyan-400 hover:text-cyan-300">
            Terms of Service
          </Link>
          .
        </p>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">8. Contact</h2>
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="font-semibold text-white">AllFantasy Privacy Requests</p>
          <p className="text-white/70">Email: privacy@allfantasy.ai</p>
        </div>
      </section>
    </LegalPageRenderer>
  )
}
