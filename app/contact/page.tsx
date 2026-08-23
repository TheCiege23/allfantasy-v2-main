import Link from "next/link"
import LegalPageRenderer, { LEGAL_LAST_UPDATED } from "@/components/legal/LegalPageRenderer"
import { getSignupReturnUrl } from "@/lib/legal/LegalRouteResolver"
import type { Metadata } from 'next'
import { buildSeoMeta } from '@/lib/seo'

interface ContactPageProps {
  searchParams?: Promise<{ from?: string; next?: string }> | { from?: string; next?: string }
}

// Routed through buildSeoMeta for a canonical and page-specific OpenGraph;
// see app/terms/page.tsx for why a bare metadata object was not enough.
export const metadata: Metadata = buildSeoMeta({
  title: "Contact | AllFantasy",
  description: "Contact AllFantasy support, privacy, or legal teams.",
  canonicalPath: '/contact',
})

export default async function ContactPage({ searchParams }: ContactPageProps) {
  const params = searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  const fromSignup = params.from === "signup"
  const next = typeof params.next === "string" ? params.next : undefined
  const signupHref = getSignupReturnUrl(next)

  return (
    <LegalPageRenderer
      title="Contact"
      description={`Last updated: ${LEGAL_LAST_UPDATED}`}
      backHref={fromSignup ? signupHref : "/"}
      backLabel={fromSignup ? "Back to Sign Up" : "Back to Home"}
    >
      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">General Support</h2>
        <p>
          For account issues, bugs, league import problems, or general questions, reach out and we will get back to
          you as soon as we can.
        </p>
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="font-semibold text-white">AllFantasy Support</p>
          <p className="text-white/70">
            Email:{" "}
            <a href="mailto:support@allfantasy.ai" className="text-cyan-400 hover:text-cyan-300">
              support@allfantasy.ai
            </a>
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Privacy &amp; Data Requests</h2>
        <p>
          For privacy questions or to request deletion of your account data, email us or visit our{" "}
          <Link href="/data-deletion" className="text-cyan-400 hover:text-cyan-300">
            Data Deletion
          </Link>{" "}
          page.
        </p>
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="font-semibold text-white">AllFantasy Privacy Requests</p>
          <p className="text-white/70">Email: privacy@allfantasy.ai</p>
        </div>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Legal</h2>
        <p>
          For legal notices or disputes, see our{" "}
          <Link href="/terms" className="text-cyan-400 hover:text-cyan-300">
            Terms of Service
          </Link>{" "}
          first.
        </p>
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="font-semibold text-white">AllFantasy Legal</p>
          <p className="text-white/70">Email: legal@allfantasy.ai</p>
        </div>
      </section>

      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Before You Reach Out</h2>
        <p>
          Questions about state availability are answered on our{" "}
          <Link href="/disclaimer" className="text-cyan-400 hover:text-cyan-300">
            Disclaimer
          </Link>{" "}
          page, and questions about our stance on real-money wagering are answered on our{" "}
          <Link href="/no-gambling-policy" className="text-cyan-400 hover:text-cyan-300">
            No Gambling Policy
          </Link>{" "}
          page.
        </p>
      </section>
    </LegalPageRenderer>
  )
}
