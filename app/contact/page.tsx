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
          {/*
            ⚠ TWO OF THE THREE ADDRESSES ON THE CONTACT PAGE WERE PLAIN TEXT.
            Support was a mailto; privacy and legal were not, so the page whose
            only job is to be contacted made two thirds of its contact routes
            un-clickable. Same defect fixed on Terms, Privacy and Data Deletion —
            this is where it mattered most.
          */}
          <p className="text-white/70">
            Email:{" "}
            <a href="mailto:privacy@allfantasy.ai" className="text-cyan-400 hover:text-cyan-300">
              privacy@allfantasy.ai
            </a>
          </p>
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
          <p className="text-white/70">
            Email:{" "}
            <a href="mailto:legal@allfantasy.ai" className="text-cyan-400 hover:text-cyan-300">
              legal@allfantasy.ai
            </a>
          </p>
        </div>
      </section>

      {/*
        ⚠ enterprise@allfantasy.ai EXISTS AND NO USER CAN CURRENTLY REACH IT.
        Its only appearance in the codebase is DEMO_MAILTO in
        components/landing/journey/B2BDemoBand.tsx, which renders inside
        ArrivalSection, which renders inside LandingPageClient — and
        LandingPageClient is ORPHANED. Its only remaining mention is a comment in
        components/landing/nocturne/LandingNocturne.tsx noting that Nocturne
        "replaces the legacy scrollytelling LandingPageClient at /".

        Verified in a browser rather than assumed: the live landing page renders
        46 links and NOT ONE mailto, and none of the band's copy ("Run a fantasy
        platform, league site, or media brand?", "Schedule a demo") appears.

        So the Nocturne rollout took the B2B call to action off the landing page
        and nothing replaced it. Listing the address here gives partnership
        enquiries a live route again. Whether the landing band should come back
        is a product decision and is left alone.
      */}
      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">Partnerships &amp; Business</h2>
        <p>
          If you run a fantasy platform, league site, or media brand and want to talk about working together,
          reach the business team directly.
        </p>
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="font-semibold text-white">AllFantasy Partnerships</p>
          <p className="text-white/70">
            Email:{" "}
            <a
              href="mailto:enterprise@allfantasy.ai?subject=Partnership%20enquiry"
              className="text-cyan-400 hover:text-cyan-300"
            >
              enterprise@allfantasy.ai
            </a>
          </p>
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
