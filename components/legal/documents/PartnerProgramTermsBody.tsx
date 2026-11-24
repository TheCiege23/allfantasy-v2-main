/**
 * Commissioner Partner Program Terms — body copy.
 *
 * ⚠ DRAFTED FROM THE PROGRAM AS BUILT, NOT BY COUNSEL. Written 2026-11-24 from the rules in
 * lib/partner-codes (settings.ts defaults, fraud.ts, ledger.ts, paidPlanOverlap.ts) at the owner's
 * request, so commissioners have terms before launch. Have it reviewed, and when the wording
 * changes, bump `partnerTerms` in lib/legal/legalVersions in the same change.
 *
 * ⚠ THE NUMBERS HERE ARE THE PROGRAM DEFAULTS. If an admin changes them in /admin/partner-codes,
 * update this page too, or it promises something the program no longer does. Section 9 gives the
 * 30 days' notice that makes such a change binding.
 *
 * Section anchors (#partner-section-N) may be linked from the product; keep them stable.
 */

import Link from "next/link"

export default function PartnerProgramTermsBody() {
  return (
    <>
      <section id="partner-overview">
        <p>
          These Commissioner Partner Program Terms (the &quot;Partner Terms&quot;) govern the AllFantasy
          Commissioner Partner Program (the &quot;Program&quot;), run by Brown Pig LLC, a Wyoming limited
          liability company (&quot;AllFantasy,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;). They are part
          of the AllFantasy <Link href="/terms">Terms of Service</Link>, and the Terms of Service control if
          there is a conflict, except where these Partner Terms say otherwise about the Program. By claiming a
          Partner Code you agree to these Partner Terms.
        </p>
        <p>
          In short: you share your code, friends who subscribe on the web save 10% for their first 3
          months, and as people join with your code you unlock free AllFantasy plans and then a 10% cash
          commission on what your paid subscribers pay us.
        </p>
      </section>

      <section id="partner-section-1">
        <h2>1. Who can join</h2>
        <ul>
          <li>You must be at least 18 and have an AllFantasy account in good standing.</li>
          <li>The Program is for commissioners of fantasy leagues. We may decide who is eligible.</li>
          <li>
            Cash commissions are paid only to people who can receive payouts through our payment provider,
            Stripe, which is currently limited to the United States. Free-plan rewards are not limited by
            country.
          </li>
          <li>You are an independent participant. The Program does not make you our employee, agent, partner, or representative, and you may not speak for AllFantasy.</li>
        </ul>
      </section>

      <section id="partner-section-2">
        <h2>2. Your Partner Code</h2>
        <ul>
          <li>You may have one Partner Code. It must be 4 to 20 letters and numbers.</li>
          <li>
            We may refuse or remove a code that is offensive, misleading, impersonates someone, uses another
            person&apos;s or company&apos;s name or trademark (including leagues, teams and players), or refers
            to betting or gambling.
          </li>
          <li>You may change your code up to 2 times in any 12 months. Your earlier codes keep working for you.</li>
          <li>
            If you upload a logo for your share images, you confirm you own it or have permission to use it.
            We review every logo and may refuse or remove one, including any NFL, league, team or other
            brand&apos;s logo. You give us permission to display your code, name and approved logo to promote
            the Program and your code.
          </li>
        </ul>
      </section>

      <section id="partner-section-3">
        <h2>3. The friend discount</h2>
        <ul>
          <li>
            A new subscriber who signs up through your link or enters your code gets 10% off the first 3 months
            of an eligible AllFantasy subscription bought on our website. On a yearly plan, the discount equals
            3 months&apos; worth of that 10%.
          </li>
          <li>
            The discount is not available on subscriptions bought in the iPhone or Android apps, because Apple and
            Google control pricing there. Those subscribers still count toward your rewards and commission.
          </li>
          <li>Each person can use a Partner Code once. You cannot use your own code.</li>
          <li>The discount does not combine with other offers unless we say so at checkout.</li>
        </ul>
      </section>

      <section id="partner-section-4">
        <h2>4. Free-plan rewards</h2>
        <p>Two counts are shown on your Partner Code page:</p>
        <ul>
          <li><strong>Active users</strong>: people who joined with your code, free or paid, who opened AllFantasy on at least 4 different days in the last 28 days.</li>
          <li><strong>Paid subscribers</strong>: people who joined with your code and have an active paid subscription whose first payment is at least 30 days old and has not been refunded or disputed.</li>
        </ul>
        <p>The rewards:</p>
        <ul>
          <li><strong>15 active users</strong>: AF Commissioner, free.</li>
          <li><strong>50 active users, or 10 paid subscribers</strong>: AF Supreme, free.</li>
        </ul>
        <p>
          A free plan earned with active users turns on once you have held the number for 30 days in a row. One
          earned with paid subscribers turns on as soon as you reach 10, because those payments have already
          counted for 30 days. Either stays on while you keep the number. If you drop below, it stays on for 30
          more days, then turns off unless you are back above the number. Free plans have no cash value and
          cannot be transferred.
        </p>
        <p>
          If you already pay for a plan that your free plan includes, we set your paid plan to cancel at the end
          of its current billing period, so you are not charged for both. If you subscribed through the App
          Store or Google Play, we cannot cancel it for you; we will let you know so you can cancel it there.
          We do not refund the period you already paid for.
        </p>
      </section>

      <section id="partner-section-5">
        <h2>5. Cash commission</h2>
        <ul>
          <li><strong>When it starts.</strong> Once you have 10 paid subscribers, you earn commission on payments those subscribers make from then on.</li>
          <li>
            <strong>How much.</strong> 10% of what each of your subscribers pays us, after any discount and
            refund, and minus the fee to process the payment: the card processor&apos;s fee for web payments, or
            for App Store and Google Play purchases the store&apos;s fee, which we count as 15%. The rate does not
            change with volume.
          </li>
          <li><strong>When a payment counts.</strong> A payment earns commission once it is 30 days old and has not been refunded or disputed.</li>
          <li><strong>Yearly plans.</strong> Commission on a yearly payment is earned in 12 equal monthly parts.</li>
          <li>
            <strong>Refunds and chargebacks.</strong> If a payment is refunded or disputed, the commission on it is
            reversed. If it was already paid to you, we subtract it from your next statements.
          </li>
          <li>Commission is earned only on subscriptions. It is not earned on your own purchases, on purchases by accounts we believe you control, or on anything we flag under Section 7 until we clear it.</li>
        </ul>
      </section>

      <section id="partner-section-6">
        <h2>6. Statements and payouts</h2>
        <ul>
          <li>We prepare a statement each month for the month before. Balances under $25 roll over to the next month.</li>
          <li>
            To be paid, you set up a payout account through Stripe from your Partner Code page and give Stripe the
            bank and tax information it asks for. Until you do, your earnings are held, not lost.
          </li>
          <li>We review each statement before paying it and may hold any part of it that is under review.</li>
          <li>
            You are responsible for your own taxes. We or Stripe may ask for tax information and may issue tax
            forms (such as a Form 1099) where the law requires.
          </li>
          <li>Payouts are in US dollars. We are not responsible for delays or fees charged by your bank.</li>
        </ul>
      </section>

      <section id="partner-section-7">
        <h2>7. What is not allowed</h2>
        <ul>
          <li>Signing up yourself, or accounts you control, with your own code.</li>
          <li>Fake, duplicate or throwaway accounts, or paying for other people&apos;s subscriptions to raise your counts.</li>
          <li>Spam, or sharing your code anywhere that does not allow it.</li>
          <li>Paid search ads that bid on &quot;AllFantasy&quot; or similar terms.</li>
          <li>Misleading claims about AllFantasy, its prices, or what people will win or earn.</li>
          <li>
            Promoting AllFantasy with betting, gambling, wagering or daily fantasy for money. AllFantasy is a
            fantasy sports management platform and does not offer any of these.
          </li>
          <li>Using other people&apos;s or companies&apos; logos or trademarks.</li>
        </ul>
        <p>
          We check sign-ups for warning signs, such as the same card or network used across many sign-ups, or
          sign-ups from the code owner&apos;s own card or network. We may hold commission on flagged sign-ups
          while we review them, refuse commission and rewards that came from a breach of these Partner Terms,
          and recover commission we already paid for them.
        </p>
      </section>

      <section id="partner-section-8">
        <h2>8. Suspension and ending</h2>
        <ul>
          <li>You can leave the Program at any time by contacting us.</li>
          <li>We may suspend or end your participation, or your code, if you breach these Partner Terms or the Terms of Service, or for any reason with 30 days&apos; notice.</li>
          <li>
            If you leave, or we end your participation for a reason other than a breach, we pay cleared commission
            you earned before the end date with the next statement, even if it is under $25. If we end it for a
            breach, we may withhold commission connected to the breach. Free plans end when your participation
            ends.
          </li>
          <li>We may end the Program for everyone with 30 days&apos; notice, on the same payment terms.</li>
        </ul>
      </section>

      <section id="partner-section-9">
        <h2>9. Changes to the Program</h2>
        <p>
          We may change the discount, rewards, commission rate, thresholds or these Partner Terms. We will tell
          you at least 30 days before a change that reduces what you earn, by email or on your Partner Code page.
          A change never reduces commission already earned on payments made before it takes effect. If you keep
          participating after the change, you accept it.
        </p>
      </section>

      <section id="partner-section-10">
        <h2>10. Other terms</h2>
        <ul>
          <li>The counts, statements and amounts in our records decide what is owed. If you think something is wrong, tell us within 90 days of the statement and we will review it.</li>
          <li>The limits on liability, disputes and other provisions in the <Link href="/terms">Terms of Service</Link> apply to the Program.</li>
          <li>Questions: <a href="mailto:support@allfantasy.ai">support@allfantasy.ai</a>.</li>
        </ul>
      </section>
    </>
  )
}
