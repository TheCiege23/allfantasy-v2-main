import Link from "next/link"
import LegalPageRenderer, {
  LEGAL_LAST_UPDATED,
  LegalBox,
  LegalCallout,
} from "@/components/legal/LegalPageRenderer"
import { getSignupReturnUrl } from "@/lib/legal/LegalRouteResolver"
import type { Metadata } from "next"
import { buildSeoMeta } from "@/lib/seo"

interface DataDeletionPageProps {
  searchParams?: Promise<{ from?: string; next?: string }> | { from?: string; next?: string }
}

/*
 * ⚠ SAME AS /privacy — #613 replaced buildSeoMeta with a bare object, which
 * drops the canonical and the page-specific OpenGraph that 5430ed57 added.
 * #613's relayout is kept in full; only the metadata call is restored.
 */
export const metadata: Metadata = buildSeoMeta({
  title: "Data Deletion | AllFantasy",
  description:
    "How to request deletion of your AllFantasy account data and connected service information.",
  canonicalPath: "/data-deletion",
})

/**
 * Handoff 17b's data-deletion deliverable, which the mock draws as a sidebar
 * beside the Terms. It renders as its own route here because /data-deletion is
 * already linked from the privacy policy, the legal footer on all eight legal
 * pages, and app-store listings — turning it into a panel inside /terms would
 * break every one of those inbound links.
 *
 * ⚠ THE PROCESS IS EMAIL-BASED AND HUMAN-OPERATED, WHICH THIS COPY ASSUMES. There
 * is no self-serve deletion endpoint; a request goes to a person. 17b's build note
 * asks that this be flagged to product if a self-serve flow is ever planned,
 * because the wording here ("we may ask you to verify", "within 30 days") is
 * written for a queue with a human in it and would be wrong for a button.
 */
export default async function DataDeletionPage({ searchParams }: DataDeletionPageProps) {
  const params = searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  const fromSignup = params.from === "signup"
  const next = typeof params.next === "string" ? params.next : undefined
  const signupHref = getSignupReturnUrl(next)

  return (
    <LegalPageRenderer
      title="Delete my data"
      description={`Last updated: ${LEGAL_LAST_UPDATED}`}
      backHref={fromSignup ? signupHref : "/"}
      backLabel={fromSignup ? "Back to sign up" : "Back to home"}
    >
      <section id="overview">
        {/*
          ⚠ "DELETE YOUR PROFILE" IS NOT WHAT THE CODE DOES, and 07fe80d0 corrected
          this once already before #613's relayout reintroduced it.
          app/api/user/delete/route.ts revokes authentication and then overwrites
          the identifying fields with unrecoverable anonymized values — its own
          header says so: "rosters, and analytics keep an anonymized user row".
          The row survives on purpose, for referential integrity. Saying "we
          delete your profile" on the page a user reads to understand their
          erasure right is the one sentence here that must match the code.
        */}
        <p>
          We remove your connected-account tokens and provider links, saved preferences and
          personalization, and support records we aren&apos;t required to keep. Your account record
          itself is anonymized rather than dropped — the identifying fields are overwritten with
          values that cannot be reversed, so leagues, rosters and historical results stay intact
          without remaining attributable to you.
        </p>
        {/*
          ⚠ 17b's COPY CONTRACT — DELETION DOES NOT CASCADE, AND THE USER HAS TO BE
          TOLD SO BEFORE THEY ASSUME IT DOES. Someone who deletes here and believes
          their Sleeper or ESPN data went with it has been misled by omission.
        */}
        <p>
          Deleting here does not delete anything held by Sleeper, ESPN, Yahoo, MFL, Fleaflicker or
          Fantrax — manage those with each provider directly.
        </p>

        <ol className="af-legal-steps">
          <li className="af-legal-step">
            <span>
              Email <a href="mailto:privacy@allfantasy.ai">privacy@allfantasy.ai</a> with the subject{" "}
              <strong>Data Deletion Request</strong>. Include your email, username and any connected
              platform IDs so we can find your records.
            </span>
          </li>
          <li className="af-legal-step">
            <span>
              We may ask you to verify you own the account. If ownership can&apos;t be verified
              we&apos;ll ask for more detail or decline the request.
            </span>
          </li>
          <li className="af-legal-step">
            <span>
              Verified requests are completed — deleted or anonymized — within 30 days where
              reasonably possible.
            </span>
          </li>
        </ol>

        <p style={{ marginTop: 22 }}>
          <a href="mailto:privacy@allfantasy.ai?subject=Data%20Deletion%20Request" className="af-legal-cta">
            Email privacy@allfantasy.ai
          </a>
        </p>
      </section>

      <LegalBox eyebrow="What we may keep">
        <p style={{ margin: 0 }}>
          Limited records for fraud prevention, security logging, legal compliance, dispute
          resolution or financial recordkeeping. Where full deletion isn&apos;t possible we limit
          further use and keep only what&apos;s necessary.
        </p>
      </LegalBox>

      {/*
        ⚠ SURFACE THIS BEFORE PROCESSING ANY DELETION TIED TO A LEAGUE — 17b names
        it as a commissioner caveat. A commissioner who deletes their account
        without handing over their leagues first strands every other manager in
        them, and nobody else has the standing to remove the league afterwards.
      */}
      <LegalCallout tone="warn" mark="!">
        If you commission leagues, archive them or hand them over first. Only the account that
        created a league can remove it from AllFantasy.
      </LegalCallout>

      <section id="what-we-delete">
        <h2>What we delete</h2>
        <ul>
          <li>Account profile information we use to operate AllFantasy</li>
          <li>Connected account tokens and provider linkage data stored by AllFantasy</li>
          <li>Saved preferences, assistant context and other account-level personalization</li>
          <li>
            Support or feedback records that are not required for security, legal or billing
            retention
          </li>
        </ul>
      </section>

      <section id="related-policies">
        <h2>Related policies</h2>
        <p>
          For more about how we collect, use and retain information, read our{" "}
          <Link href="/privacy">Privacy Policy</Link> and{" "}
          <Link href="/terms">Terms of Service</Link>.
        </p>
      </section>

      <section id="contact">
        <h2>Contact</h2>
        <LegalBox>
          <p style={{ margin: 0 }}>
            <strong>AllFantasy Privacy Requests</strong>
          </p>
          <p style={{ margin: 0 }}>
            Email: <a href="mailto:privacy@allfantasy.ai">privacy@allfantasy.ai</a>
          </p>
        </LegalBox>
      </section>
    </LegalPageRenderer>
  )
}
