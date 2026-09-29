import Link from "next/link"
import LegalPageRenderer, {
  legalLastUpdated,
  LegalBox,
  LegalCallout,
} from "@/components/legal/LegalPageRenderer"
import { getSignupReturnUrl } from "@/lib/legal/LegalRouteResolver"

interface DataDeletionPageProps {
  searchParams?: Promise<{ from?: string; next?: string }> | { from?: string; next?: string }
}

export const metadata = {
  title: "Data Deletion | AllFantasy",
  description:
    "How to request deletion of your AllFantasy account data and connected service information.",
}

/**
 * Handoff 17b's data-deletion deliverable, which the mock draws as a sidebar
 * beside the Terms. It renders as its own route here because /data-deletion is
 * already linked from the privacy policy, the legal footer on all eight legal
 * pages, and app-store listings — turning it into a panel inside /terms would
 * break every one of those inbound links.
 *
 * 🛑 THAT SELF-SERVE FLOW NOW EXISTS, AND THIS PAGE SAID OTHERWISE FOR WEEKS. The
 * comment here used to read "there is no self-serve deletion endpoint; a request
 * goes to a person", and 17b asked that it be flagged if one was ever built. It was:
 * Settings → Account → "Start account deletion" (type DELETE to confirm) posts to
 * `/api/user/delete` and erases the PII immediately.
 *
 * ⚠ WHY THE MISMATCH MATTERED MORE THAN THE WORDING. This page is linked from the
 * privacy policy, the legal footer on all eight legal pages, and the App Store and
 * Play listings — so a reviewer reading Apple's 5.1.1(v) account-deletion
 * requirement was told by our own public page that deletion needs an email to a
 * human, while the app itself has a button. Under-claiming a capability a
 * guideline requires is the expensive direction to be wrong in.
 *
 * ⚠ EMAIL IS KEPT AS THE SECOND PATH, NOT DELETED. It is the only route for someone
 * locked out of their account, and the "verify ownership / within 30 days" wording
 * still describes that queue correctly.
 *
 * ⚠ AND THE IN-APP BUTTON ANONYMISES RATHER THAN HARD-DELETING (`/api/user/delete`
 * scrubs the AppUser row and drops OAuth links, keeping an anonymised row so
 * leagues and rosters stay referentially intact). The copy below says "deleted or
 * anonymized" for exactly that reason — do not upgrade it to a flat "deleted".
 */
export default async function DataDeletionPage({ searchParams }: DataDeletionPageProps) {
  const params = searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  const fromSignup = params.from === "signup"
  const next = typeof params.next === "string" ? params.next : undefined
  const signupHref = getSignupReturnUrl(next)

  return (
    <LegalPageRenderer
      title="Delete my data"
      description={`Last updated: ${legalLastUpdated("dataDeletion")}`}
      backHref={fromSignup ? signupHref : "/"}
      backLabel={fromSignup ? "Back to sign up" : "Back to home"}
    >
      <section id="overview">
        <p>
          We delete your profile, connected-account tokens and provider links, saved preferences and
          personalization, and support records we aren&apos;t required to keep.
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

        <h2>Delete it yourself, from your account</h2>
        <p>
          If you can sign in, you do not need to email anyone. Go to{" "}
          <Link href="/settings">Settings</Link> → <strong>Account</strong> →{" "}
          <strong>Start account deletion</strong>, then type <strong>DELETE</strong> to confirm. Your
          profile is erased straight away: your email address, username, display name, avatar,
          password and any connected sign-in links (Google, Apple, Discord and the rest) are removed,
          and you are signed out and cannot sign in again.
        </p>
        <p>
          Leagues, rosters and league history stay in place against an anonymised account, so the
          other managers in your leagues are not affected. That is why we say
          &ldquo;deleted or anonymized&rdquo; rather than promising every row disappears.
        </p>

        <p style={{ marginTop: 22 }}>
          <Link href="/settings" className="af-legal-cta">
            Open Settings → Account
          </Link>
        </p>

        <h2>Can&apos;t sign in? Email us instead</h2>
        <ol className="af-legal-steps">
          <li className="af-legal-step">
            <span>
              Email <a href="mailto:support@allfantasy.ai">support@allfantasy.ai</a> with the subject{" "}
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
          <a href="mailto:support@allfantasy.ai?subject=Data%20Deletion%20Request" className="af-legal-cta">
            Email support@allfantasy.ai
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
            Email: <a href="mailto:support@allfantasy.ai">support@allfantasy.ai</a>
          </p>
        </LegalBox>
      </section>
    </LegalPageRenderer>
  )
}
