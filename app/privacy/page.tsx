import LegalPageRenderer, { legalLastUpdated } from "@/components/legal/LegalPageRenderer"
import PrivacyPolicyBody from "@/components/legal/documents/PrivacyPolicyBody"
import { resolveLegalBackLink, type LegalPageSearchParams } from "@/lib/legal/LegalRouteResolver"

interface PrivacyPageProps {
  searchParams?: Promise<LegalPageSearchParams>
}

export const metadata = {
  title: "Privacy Policy | AllFantasy",
  description: "How Brown Pig LLC collects, uses, shares and protects information about you when you use AllFantasy.",
}

/**
 * The Privacy Policy, as drafted by the owner (2026-10). The copy lives in
 * components/legal/documents/PrivacyPolicyBody — this page only frames it.
 *
 * ⚠ /privacy#sms-communications MUST KEEP RESOLVING. It is Section 7 ("Text
 * messages"), whose anchor is aliased to that id; the SMS consent box and the A2P
 * 10DLC registration both link to it, and lib/meta-capi.ts cites its promise that
 * mobile numbers are never shared for marketing.
 */
export default async function PrivacyPage({ searchParams }: PrivacyPageProps) {
  const back = await resolveLegalBackLink(searchParams)

  return (
    <LegalPageRenderer
      title="Privacy Policy"
      description={`Effective: ${legalLastUpdated("privacy")}`}
      backHref={back.href}
      backLabel={back.label}
    >
      <PrivacyPolicyBody />
      <section id="youtube-highlights">
        <h2>YouTube highlights</h2>
        <p>
          AllFantasy uses YouTube API Services to find public highlights from official channels.
          We send requests for public channel and video information from our server; this feature
          does not connect to your YouTube account or access your YouTube watch history.
          Choosing Find highlights loads thumbnails from YouTube. Video links open YouTube in a
          new tab. These connections disclose your IP address and browser information to Google,
          and YouTube may use cookies or similar technologies.
          See the <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>
          {' '}and <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a>.
          You can use the rest of the player card without loading highlights.
        </p>
      </section>
    </LegalPageRenderer>
  )
}
