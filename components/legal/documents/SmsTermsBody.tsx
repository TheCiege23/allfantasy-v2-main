/**
 * SMS Terms — body copy.
 *
 * ⚠ LEGAL-OWNED TEXT. Generated from the owner's draft "03-SMS-Terms ip 10-05-2026.docx" (Brown Pig LLC,
 * received 2026-10-06), with each of the draft's CONFIRM placeholders resolved as
 * recorded in the PR that added this file. Edit the wording only to match a revised
 * document from the owner — and bump this document's stamp in lib/legal/legalVersions
 * in the same change, because acceptances are recorded against that stamp.
 *
 * Section anchors (#section-N, #section-N-M) are linked to from elsewhere in the
 * product and from the sibling documents; keep them stable.
 */

import Link from "next/link"
import { SmsOptInExample } from "@/components/legal/SmsOptInExample"

export default function SmsTermsBody() {
  return (
    <>
      <section id="sms-overview">
        <p>These SMS Terms govern text messages sent by Brown Pig LLC, a Wyoming limited liability company (&quot;AllFantasy,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), in connection with the AllFantasy Services. They are part of the AllFantasy <Link href="/terms">Terms of Service</Link>, and the Terms of Service control if there is a conflict. Capitalized terms not defined here have the meanings given in the Terms of Service.</p>
      </section>
      <section id="sms-section-1">
        <h2>1. What we send</h2>
        <p>If you add a mobile number and agree to receive text messages, we send:</p>
        <ul>
          <li>verification codes and password-reset codes, only when you request one;</li>
          <li>account security alerts; and</li>
          <li>League and event notifications, only if you turn them on in your notification settings.</li>
        </ul>
        <p>We do not send marketing or promotional text messages.</p>
      </section>
      <section id="sms-opt-in">
        <h2>2. How you opt in</h2>
        <p>Adding a mobile number is optional, and you can use AllFantasy without one. You verify a number in Settings → Security → Phone or on the Phone tab of the verification page. There, the SMS consent box is unchecked by default, and no code is sent until you check the box and ask for one. If you create an Account with a mobile number instead of an email address, we text that number only the verification code you request, and send no other texts until you check the consent box. A number entered during onboarding gets no alerts until you verify it. Verification and password-reset codes are sent only when you request them; every other text goes only to a verified number.</p>
        <p>By checking the box and requesting a code, you agree to receive text messages from AllFantasy at the number you provide, including messages sent using automated technology, and you confirm that you are the subscriber or customary user of that number and are authorized to agree. Consent to receive text messages is not a condition of any purchase or of using the Services.</p>
        <p>The consent wording shown in the app is: &quot;I agree to receive SMS from AllFantasy (operated by Brown Pig LLC), including verification codes, account alerts, and optional league notifications. Msg frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of purchase. See our Terms and <Link href="/privacy">Privacy Policy</Link>.&quot;</p>
        <SmsOptInExample />
      </section>
      <section id="sms-section-3">
        <h2>3. Frequency and cost</h2>
        <p>Message frequency varies with your account activity and the notifications you turn on. Message and data rates may apply; your carrier bills them, and we are not responsible for them.</p>
      </section>
      <section id="sms-section-4">
        <h2>4. How to stop</h2>
        <p>Reply STOP to any message to cancel. You will receive one confirmation message and no further messages. Reply START to resubscribe. You can also turn SMS notifications off in your account settings or email <a href="mailto:support@allfantasy.ai">support@allfantasy.ai</a>. Stopping texts does not close your Account; you can still sign in and use the Services. If you stop texts, we may need another way to send you verification codes.</p>
      </section>
      <section id="sms-section-5">
        <h2>5. Help</h2>
        <p>Reply HELP to any message for help, or email <a href="mailto:support@allfantasy.ai">support@allfantasy.ai</a>.</p>
      </section>
      <section id="sms-section-6">
        <h2>6. Carriers</h2>
        <p>Supported carriers include the major U.S. wireless carriers and may change. Carriers are not liable for delayed or undelivered messages. Delivery depends on your carrier and is not guaranteed.</p>
      </section>
      <section id="sms-section-7">
        <h2>7. Eligibility</h2>
        <p>You must be at least 18, located in the United States, and the subscriber or an authorized user of the number you add.</p>
      </section>
      <section id="sms-section-8">
        <h2>8. Your number</h2>
        <p>Keep your number current. If you change or give up your number, update or remove it in Settings so that we do not text someone else. If you fail to do so, you are responsible for messages sent to the old number until we are told.</p>
      </section>
      <section id="sms-section-9">
        <h2>9. Privacy</h2>
        <p>We keep a record of your SMS consent (date, number, and the wording you agreed to). <strong>Mobile numbers and SMS opt-in data and consent are never shared with, sold to, or rented to third parties or affiliates for marketing or promotional purposes.</strong> We share your number only with the messaging provider that delivers our texts on our behalf (Twilio). See the AllFantasy <Link href="/privacy">Privacy Policy</Link>.</p>
      </section>
      <section id="sms-section-10">
        <h2>10. Changes</h2>
        <p>We may change these SMS Terms. We will update the Effective Date and, for material changes, tell you by text, email, or in the Services. Continued participation after a change takes effect means you accept it.</p>
      </section>
      <section id="sms-section-11">
        <h2>11. Contact</h2>
        <p>Brown Pig LLC (AllFantasy), 1621 Central Ave, Cheyenne, WY 82001, <a href="mailto:support@allfantasy.ai">support@allfantasy.ai</a>.</p>
      </section>
    </>
  )
}
