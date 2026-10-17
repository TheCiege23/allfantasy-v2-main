/**
 * Privacy Policy — body copy.
 *
 * ⚠ LEGAL-OWNED TEXT. Generated from the owner's draft "02-Privacy-Policy ip 10-05-2026.docx" (Brown Pig LLC,
 * received 2026-10-06), with each of the draft's CONFIRM placeholders resolved as
 * recorded in the PR that added this file. Edit the wording only to match a revised
 * document from the owner — and bump this document's stamp in lib/legal/legalVersions
 * in the same change, because acceptances are recorded against that stamp.
 *
 * Section anchors (#section-N, #section-N-M) are linked to from elsewhere in the
 * product and from the sibling documents; keep them stable.
 */

import Link from "next/link"
import { LegalCallout } from "@/components/legal/LegalPageShell"

export default function PrivacyPolicyBody() {
  return (
    <>
      <section id="overview">
        <p>This Privacy Policy explains how Brown Pig LLC, a Wyoming limited liability company (&quot;AllFantasy,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), collects, uses, shares, and protects information about you when you use the AllFantasy website at allfantasy.ai, the AllFantasy mobile apps, the Chimmy assistant, and related features (together, the &quot;Services&quot;). It is part of the AllFantasy <Link href="/terms">Terms of Service</Link>. Capitalized terms not defined here have the meanings given in the Terms of Service.</p>
        <LegalCallout tone="accent" title="The short version">
          <ul>
            <li>We collect what you give us (account details, the leagues you connect, what you type to Chimmy, your messages), what your device tells us, and league data from platforms you connect.</li>
            <li>We never ask for your password on another fantasy platform.</li>
            <li>We do not sell your personal information. On the website we use advertising-measurement tools from Meta, Google, TikTok, and Reddit, which some state laws treat as &quot;sharing&quot; or &quot;targeted advertising.&quot; You can opt out. The iOS app does not use these tools.</li>
            <li>You can delete your Account yourself in Settings. We remove your personal information within 30 days, and your League history stays in your Leagues under an anonymized account.</li>
            <li>Questions and requests: <a href="mailto:support@allfantasy.ai">support@allfantasy.ai</a>.</li>
          </ul>
        </LegalCallout>
      </section>
      <nav className="af-legal-toc" aria-label="Contents">
        <span className="af-legal-eyebrow">Contents</span>
        <ol>
          <li><a href="#section-1">Who we are and what this Policy covers</a></li>
          <li><a href="#section-2">Information we collect</a></li>
          <li><a href="#section-3">How we use information</a></li>
          <li><a href="#section-4">Chimmy, AI Features, and models</a></li>
          <li><a href="#section-5">Cookies, pixels, analytics, and advertising measurement</a></li>
          <li><a href="#section-6">How we share information</a></li>
          <li><a href="#sms-communications">Text messages</a></li>
          <li><a href="#section-8">Your choices and rights</a></li>
          <li><a href="#section-9">Children</a></li>
          <li><a href="#section-10">How long we keep information</a></li>
          <li><a href="#section-11">Security</a></li>
          <li><a href="#section-12">International users</a></li>
          <li><a href="#section-13">Third-party links and platforms</a></li>
          <li><a href="#section-14">Changes to this Policy</a></li>
          <li><a href="#section-15">Contact us</a></li>
        </ol>
      </nav>
      <section id="section-1">
        <h2>1. Who we are and what this Policy covers</h2>
        <p id="section-1-1"><strong>1.1 Who we are.</strong> Brown Pig LLC operates AllFantasy. Our mailing address is 1621 Central Ave, Cheyenne, WY 82001.</p>
        <p id="section-1-2"><strong>1.2 What this Policy covers.</strong> This Policy covers the Services. It does not cover the practices of Connected Platforms, sign-in providers, Discord, FanCred, app stores, payment processors, or other third parties, which have their own privacy policies.</p>
        <p id="section-1-3"><strong>1.3 Other Brown Pig products.</strong> Brown Pig LLC also offers other apps and services. AllFantasy data is kept separate from them: we do not share your AllFantasy information with other Brown Pig products or use it to market them to you.</p>
      </section>
      <section id="section-2">
        <h2>2. Information we collect</h2>
        <h3 id="section-2-1">2.1 Information you give us.</h3>
        <ul>
          <li>Account details: email address, username, display name, avatar, and password (stored in hashed form), and your confirmation that you are 18 or older. We do not collect your date of birth.</li>
          <li>Mobile number, if you choose to add one, and your SMS consent record (the date, the number, and the wording you agreed to).</li>
          <li>Fantasy platform usernames or identifiers for the Connected Platforms you connect.</li>
          <li>Leagues you create and everything you add to them: league and team names, settings, rosters, transactions, and standings.</li>
          <li>Messages and posts: League, draft, mock-draft, bracket, and pool chat; direct messages; and reports you submit about other users.</li>
          <li>Bracket and pool entries.</li>
          <li>What you type to Chimmy and other AI Features, and the responses you receive.</li>
          <li>Feedback, league ideas, survey answers, and anything you send to support.</li>
          <li>Purchase information: the plan or Tokens you buy and the transaction record. Your payment card details are collected by our payment processor (Stripe) or by Apple, not by us. We keep the plan or Tokens bought, the amount, the dates, and the transaction and subscription identifiers they send us.</li>
        </ul>
        <p id="section-2-2"><strong>2.2 Information from sign-in providers.</strong> If you sign in with a third-party provider such as Google, Discord, or Spotify, the provider sends us your name or username, email address, avatar, and a provider account identifier, according to the provider&apos;s settings and your choices.</p>
        <p id="section-2-3"><strong>2.3 Information from Connected Platforms.</strong> When you connect a League, we access league data available through that platform&apos;s API or the access you authorize: league names, settings, rosters, standings, matchups, scoring, transactions, trades, and drafts, along with the usernames of the league&apos;s members as the platform exposes them. We store the credentials needed to keep the connection working, which, depending on the platform, are the access or refresh tokens the platform issues, an API key or private-league key you provide, or the session cookies from your sign-in to that platform. We never request or store your password for a Connected Platform.</p>
        <p id="section-2-4"><strong>2.4 Information from Discord.</strong> Linking Discord is optional. If you never link a Discord account or add our bot to a server, this Section does not apply to you.</p>
        <ul>
          <li>Your Discord account: your Discord user ID, username, avatar, the email on your Discord account, the access and refresh tokens for the connection, and when the connection was made.</li>
          <li>Linked servers and channels: the server (guild) ID and name, the channel ID and name for each synced channel, the webhook credentials we create to post, and which League member linked the server.</li>
          <li>Message sync: a Commissioner can connect a League to a Discord channel. Outbound sync posts League activity into that channel through a webhook. Inbound sync is off by default and must be turned on deliberately. When inbound sync is on, we read messages from the linked channel and copy the message text, together with the author&apos;s Discord display name and avatar, into the League chat on the Services, where it is stored. This applies to everyone who posts in that channel, including people who do not have an AllFantasy account. We also keep a record that links each Discord message to its copy on the Services so the same message is not copied twice. We read only the channels a League has been linked to; we do not read direct messages or other channels in a server.</li>
        </ul>
        <h3 id="section-2-5">2.5 Information collected automatically.</h3>
        <ul>
          <li>Device and connection information: browser type, operating system, device model, app version, language, IP address, and identifiers assigned to your device or browser.</li>
          <li>Approximate location: the country and U.S. state or region derived from your IP address through our hosting provider&apos;s network, which may be supplemented by VPN and proxy detection services. We do not collect precise location (GPS) data. We may store the state we identify on your Account record for compliance purposes.</li>
          <li>Usage information: pages and screens viewed, features used, Leagues and players viewed, searches, clicks, and timestamps.</li>
          <li>Session recordings on the website: our analytics provider, PostHog, records how you move through our pages (clicks, scrolling, and what is on screen), with everything you type masked, so we can find bugs and improve the Services. Our mobile apps display the website, so this also applies in them.</li>
          <li>Cookies and similar technologies, described in Section <a href="#section-5">5</a>.</li>
        </ul>
        <p id="section-2-6"><strong>2.6 Information from other sources.</strong> We may receive confirmation of payment status from our payment processor, delivery status from our messaging provider, and information from Connected Platforms as described in Section <a href="#section-2-3">2.3</a>. We do not buy information about you from data brokers.</p>
        <p id="section-2-7"><strong>2.7 What we do not collect.</strong> We do not collect government identification numbers, financial account numbers (our payment processor collects payment details), precise geolocation, or biometric information. If you include that kind of information in a message or a Chimmy prompt, please do not; we may delete it.</p>
      </section>
      <section id="section-3">
        <h2>3. How we use information</h2>
        <p>We use the information we collect to:</p>
        <ul>
          <li>create and maintain your Account and provide the Services, including Leagues, scoring, standings, chat, brackets, and pools;</li>
          <li>show your Leagues and teams from Connected Platforms in one place and keep them in sync;</li>
          <li>generate analysis, rankings, recommendations, summaries, and other AI Output (see Section <a href="#section-4">4</a>);</li>
          <li>calculate rankings, levels, and tier progression;</li>
          <li>process purchases, manage Subscriptions and Tokens, and send receipts and billing notices;</li>
          <li>send verification codes, security alerts, and the notifications you turn on;</li>
          <li>respond to your questions and support requests;</li>
          <li>determine the state you are in so we can apply the location rules in the <Link href="/terms">Terms of Service</Link> and the <Link href="/disclaimer">Fantasy Sports &amp; State Notice</Link>;</li>
          <li>moderate content, investigate reports, detect and prevent abuse, cheating, fraud, and security incidents, and enforce the Terms of Service;</li>
          <li>understand how the Services are used, fix problems, and improve and develop features;</li>
          <li>measure the performance of our advertising (see Section <a href="#section-5">5</a>); and</li>
          <li>comply with legal obligations and protect our rights and the rights of others.</li>
        </ul>
      </section>
      <section id="section-4">
        <h2>4. Chimmy, AI Features, and models</h2>
        <p id="section-4-1"><strong>4.1 How AI Features use your data.</strong> Chimmy reads the rosters and League data you connect or create so that its answers are about your teams. We send your prompts and the relevant League data to the systems that generate AI Output. AI Features are built on models from third-party providers (currently OpenAI, Anthropic, xAI, and DeepSeek, with ElevenLabs for Chimmy&apos;s voice), which process your prompts and the relevant League data to generate AI Output under their terms for business customers.</p>
        <p id="section-4-2"><strong>4.2 Improving our models.</strong> We do not use your prompts, messages, or League data to train or fine-tune machine-learning models. We may use de-identified and aggregated usage information to evaluate and improve the AI Features. We do use your activity on the Services, such as your trades, lineups, and the outcomes of Chimmy&apos;s advice, to personalize AI Output and to calibrate our rankings and recommendations.</p>
        <p id="section-4-3"><strong>4.3 What AI Output is.</strong> AI Output is informational and for entertainment. It can be inaccurate. See the <Link href="/terms#section-7">Terms of Service, Section 7</Link>.</p>
      </section>
      <section id="section-5">
        <h2>5. Cookies, pixels, analytics, and advertising measurement</h2>
        <p id="section-5-1"><strong>5.1 What we use.</strong> We and the providers below use cookies, pixels, software development kits, and similar technologies on the website and apps.</p>
        <div className="af-legal-table-wrap">
          <table className="af-legal-table">
            <thead>
              <tr><th scope="col">Category</th><th scope="col">Provider</th><th scope="col">What it does</th><th scope="col">What it receives</th></tr>
            </thead>
            <tbody>
              <tr><td>Strictly necessary</td><td>AllFantasy</td><td>Signs you in, keeps your session, protects against fraud and abuse, remembers your settings, and identifies your state for location rules. Cannot be turned off.</td><td>Session identifiers, security tokens, IP address.</td></tr>
              <tr><td>Analytics</td><td>PostHog</td><td>Measures how the Services are used and records website sessions (with typed content masked) so we can find bugs and improve features.</td><td>Device and browser information, pages viewed, clicks, scrolling, on-screen content, account identifier, email address, and name.</td></tr>
              <tr><td>Advertising measurement</td><td>Meta (Meta Pixel and Conversions API)</td><td>Tells Meta when you take certain actions after seeing our ads so we can measure ad performance.</td><td>IP address, browser and device information, pages viewed, cookie identifiers, and, on sign-up, League creation, bracket entry, checkout, Subscription, and purchase events, a hashed (scrambled) copy of your email address and your account identifier. We never send your phone number.</td></tr>
              <tr><td>Advertising measurement</td><td>Google (Google Tag Manager, Google Analytics, Google Ads conversion tracking and remarketing, and the Google tags it loads)</td><td>Measures conversions from Google ads, measures how the website is used, builds remarketing audiences so our ads can be shown to people who visited the website, and loads our tags.</td><td>IP address, browser and device information, pages viewed, cookie identifiers, conversion events.</td></tr>
              <tr><td>Advertising measurement</td><td>TikTok (TikTok Pixel)</td><td>Measures conversions from TikTok ads.</td><td>IP address, browser and device information, pages viewed, cookie identifiers, conversion events.</td></tr>
              <tr><td>Advertising measurement</td><td>Reddit (Reddit Pixel)</td><td>Measures conversions from Reddit ads.</td><td>IP address, browser and device information, pages viewed, cookie identifiers, conversion events.</td></tr>
            </tbody>
          </table>
        </div>
        <p>We also use Sentry for error monitoring. When something breaks, it receives technical details of the error, such as device and browser information and the page involved, so we can fix it.</p>
        <p id="section-5-2"><strong>5.2 The iOS app.</strong> The iOS app does not use any advertising-measurement tool. Nothing you do in the iOS app is shared with Meta, Google, TikTok, or Reddit for advertising or measurement. Our Android app displays the website, so the tools described in this Section can operate in it as they do on the website.</p>
        <h3 id="section-5-3">5.3 Your controls.</h3>
        <ul>
          <li>Browser settings: most browsers let you block or delete cookies. Blocking strictly necessary cookies will prevent parts of the Services from working.</li>
          <li>Ad platform settings: you can limit ad personalization in your Meta, Google, TikTok, and Reddit account settings.</li>
          <li>Global Privacy Control: if your browser sends a Global Privacy Control signal, we treat it as a request to opt out of &quot;sharing&quot; and targeted advertising for that browser, and, if you are signed in, for your Account, as required by applicable law.</li>
          <li>Opt-out link: the <Link href="/privacy/choices">&quot;Your Privacy Choices&quot; page</Link> (linked as &quot;Do Not Sell or Share My Personal Information&quot; in our website footer and in Settings → Legal) lets you opt out on your browser and, if you are signed in, on your Account. You can also email <a href="mailto:support@allfantasy.ai">support@allfantasy.ai</a> with &quot;Do Not Sell or Share&quot; in the subject line.</li>
          <li>Do Not Track: because there is no common standard for &quot;Do Not Track&quot; signals, we do not respond to them other than as described above.</li>
          <li>Industry opt-outs: you can opt out of interest-based advertising from participating companies at <a href="https://optout.aboutads.info" target="_blank" rel="noopener noreferrer">optout.aboutads.info</a> and <a href="https://optout.networkadvertising.org" target="_blank" rel="noopener noreferrer">optout.networkadvertising.org</a>.</li>
        </ul>
      </section>
      <section id="section-6">
        <h2>6. How we share information</h2>
        <p>We do not sell your personal information for money. We share information in these situations:</p>
        <p id="section-6-1"><strong>6.1 Service providers.</strong> With companies that work for us and are bound to use information only to provide their services: hosting and infrastructure, analytics (PostHog), payment processing, messaging and SMS delivery, email delivery, customer support tools, VPN and proxy detection, and the model providers that power AI Features. Our current providers include Railway and Vercel (hosting), Neon (database), PostHog (analytics), Sentry (error monitoring), Stripe and Apple (payments), Twilio (SMS), Resend (email), proxycheck.io and ipapi.co (location and VPN detection), and OpenAI, Anthropic, xAI, DeepSeek, and ElevenLabs (AI Features).</p>
        <p id="section-6-2"><strong>6.2 Other users.</strong> Your display name, avatar, team names, rosters, transactions, standings, and League chat messages are visible to the other members of your Leagues. Direct messages are visible to the recipient. Leagues are private unless a Commissioner makes them public, and public Leagues may be visible more widely. Your profile page, which shows your username, display name, avatar, bio, and favorite sports, is public.</p>
        <p id="section-6-3"><strong>6.3 Connected Platforms.</strong> When you connect a League, the Connected Platform receives the connection request and the identifiers needed to make it, under that platform&apos;s terms. We do not send your messages or AI Output to a Connected Platform.</p>
        <p id="section-6-4"><strong>6.4 Discord.</strong> If a Commissioner connects a League to Discord with outbound sync, League activity and the chat messages you post in that League on the Services are sent to the linked Discord channel. Once delivered, that content lives in Discord and is governed by Discord&apos;s privacy policy, not this one.</p>
        <p id="section-6-5"><strong>6.5 Advertising measurement.</strong> With Meta, Google, TikTok, and Reddit, as described in Section <a href="#section-5">5</a>. Under the California Consumer Privacy Act this may be considered &quot;sharing&quot; for cross-context behavioral advertising, and under other state laws it may be considered &quot;targeted advertising.&quot; You can opt out as described in Sections <a href="#section-5-3">5.3</a> and <a href="#section-8">8</a>.</p>
        <p id="section-6-6"><strong>6.6 Legal reasons and safety.</strong> When we believe disclosure is required by law, subpoena, or legal process; to enforce the <Link href="/terms">Terms of Service</Link>; to investigate fraud, abuse, cheating, or security issues; or to protect the rights, property, or safety of AllFantasy, our users, or others. This may include sharing information about conduct with a League&apos;s Commissioner, with a Connected Platform, or with law enforcement.</p>
        <p id="section-6-7"><strong>6.7 Business transfers.</strong> If we are involved in a merger, acquisition, financing, reorganization, bankruptcy, or sale of assets, information may be transferred as part of that transaction, subject to this Policy or a successor policy.</p>
        <p id="section-6-8"><strong>6.8 Affiliates.</strong> We do not share your personal information with other Brown Pig LLC products (see Section <a href="#section-1-3">1.3</a>).</p>
        <p id="section-6-9"><strong>6.9 With your direction.</strong> When you ask us to share information or otherwise consent.</p>
        <p id="section-6-10"><strong>6.10 Aggregated or de-identified information.</strong> We may share information that no longer reasonably identifies you.</p>
      </section>
      <section id="sms-communications">
        <h2>7. Text messages</h2>
        <p>Adding a mobile number is optional. If you add one and check the SMS consent box, Brown Pig LLC (AllFantasy) will send text messages to that number: verification codes, password-reset codes, account security alerts, and, only if you turn them on in your notification settings, League and event notifications. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help, turn SMS notifications off in your settings, or contact <a href="mailto:support@allfantasy.ai">support@allfantasy.ai</a>. We keep a record of your SMS consent. <strong>Mobile numbers and SMS opt-in data and consent are never shared with, sold to, or rented to third parties or affiliates for marketing or promotional purposes.</strong> We share your number only with the messaging provider that delivers our texts on our behalf. The <Link href="/sms-terms">SMS Terms</Link> have the details.</p>
      </section>
      <section id="section-8">
        <h2>8. Your choices and rights</h2>
        <p id="section-8-1"><strong>8.1 Account settings.</strong> You can update your profile, change notification preferences, disconnect Connected Platforms and Discord, manage SMS, and delete your Account in Settings.</p>
        <p id="section-8-2"><strong>8.2 Marketing email.</strong> You can unsubscribe from marketing email using the link in any message. We will still send transactional and security messages.</p>
        <p id="section-8-3"><strong>8.3 Location correction.</strong> If you believe we have identified your state incorrectly, contact <a href="mailto:support@allfantasy.ai">support@allfantasy.ai</a>. We may ask you to verify your location.</p>
        <p id="section-8-4"><strong>8.4 Deleting your Account.</strong> Go to Settings → Account → Start account deletion and confirm. Your profile (email address, username, display name, avatar, password, and connected sign-in links) is erased straight away. Connected Platform tokens, Discord tokens, saved preferences, and support records that we are not required to keep are deleted within 30 days. If you cannot sign in, email <a href="mailto:support@allfantasy.ai">support@allfantasy.ai</a> from the address on your Account with your username; we may ask you to verify that you own the Account. See Section <a href="#section-10">10</a> for what is retained. The <Link href="/data-deletion">Data Deletion page</Link> on our website has step-by-step instructions.</p>
        <p id="section-8-5"><strong>8.5 State privacy rights.</strong> Depending on where you live, you may have the right to:</p>
        <ul>
          <li>know whether we process your personal information and to access a copy of it;</li>
          <li>correct inaccurate personal information;</li>
          <li>delete personal information;</li>
          <li>receive a portable copy of personal information you gave us;</li>
          <li>opt out of the sale of personal information, of &quot;sharing&quot; or targeted advertising, and of profiling that produces legal or similarly significant effects (we do not sell personal information or engage in that kind of profiling; you can opt out of sharing and targeted advertising as described in Section <a href="#section-5-3">5.3</a>);</li>
          <li>limit the use of sensitive personal information (we do not use sensitive personal information for purposes that would trigger this right);</li>
          <li>not be discriminated against for exercising your rights; and</li>
          <li>appeal a decision we make about your request.</li>
        </ul>
        <p>To exercise these rights, email <a href="mailto:support@allfantasy.ai">support@allfantasy.ai</a> with &quot;Privacy Request&quot; in the subject line. We will verify your request by matching it to the email on your Account or asking for information that only the Account holder would know. You may use an authorized agent, who must provide proof of your written authorization; we may still verify your identity directly. We will respond within the time required by applicable law (generally 45 days, which we may extend once where permitted). If we deny your request, we will explain why, and you may appeal by replying to our response with &quot;Appeal&quot; in the subject line; if we deny your appeal, you may contact your state attorney general.</p>
        <p id="section-8-6"><strong>8.6 California.</strong> This Section applies to California residents. In the past 12 months we have collected the following categories of personal information, from the sources and for the purposes described in Sections <a href="#section-2">2</a> and <a href="#section-3">3</a>: identifiers (email, username, device and account identifiers, IP address); customer records (name and purchase history); internet and network activity (usage and session data); approximate geolocation (state level); commercial information (Subscriptions and Tokens); audio, electronic, or visual information (avatars and session recordings); inferences (rankings, recommendations, and personalization); and the content of messages and prompts. We disclose these categories to the recipients in Section <a href="#section-6">6</a>. We have &quot;shared&quot; identifiers, internet activity, and commercial information with advertising-measurement partners as described in Section <a href="#section-5">5</a>. We do not sell personal information and do not knowingly sell or share the personal information of anyone under 16. We do not offer financial incentives in exchange for personal information. California residents may also request, under Civil Code §1798.83, a list of third parties to whom we disclosed personal information for their direct marketing purposes; we do not make such disclosures.</p>
      </section>
      <section id="section-9">
        <h2>9. Children</h2>
        <p>The Services are not intended for anyone under 18, and we do not knowingly collect personal information from anyone under that age. We do not knowingly collect personal information from children under 13 within the meaning of the Children&apos;s Online Privacy Protection Act. If we learn that we have collected personal information from someone below the minimum age, we will delete it and close the Account. If you believe a child has an Account, contact <a href="mailto:support@allfantasy.ai">support@allfantasy.ai</a>.</p>
      </section>
      <section id="section-10">
        <h2>10. How long we keep information</h2>
        <ul>
          <li>Account information: for as long as your Account exists, and then as described in Section <a href="#section-8-4">8.4</a>.</li>
          <li>League history: after you delete your Account, your rosters, transactions, and results stay in your Leagues under an anonymized account so other members&apos; League records remain intact. They are no longer linked to you.</li>
          <li>Messages: League chat and direct messages remain visible to the other participants after you delete your Account, under the anonymized account.</li>
          <li>Session recordings: for a limited period, after which our analytics provider deletes them automatically.</li>
          <li>SMS consent records: for four years after you opt out or remove your number.</li>
          <li>Purchase and billing records: as long as required for tax, accounting, and dispute purposes.</li>
          <li>Security, fraud, and legal records: as long as needed to protect the Services, resolve disputes, and comply with law.</li>
          <li>Backups: deleted information may persist in encrypted backups for a limited period before being overwritten.</li>
        </ul>
      </section>
      <section id="section-11">
        <h2>11. Security</h2>
        <p>We use administrative, technical, and physical safeguards designed to protect your information, including encryption in transit, hashed passwords, access controls, and vendor review. No system is completely secure, and we cannot guarantee the security of your information. Keep your password confidential and tell us at once if you suspect unauthorized access to your Account.</p>
      </section>
      <section id="section-12">
        <h2>12. International users</h2>
        <p>We are based in the United States, and we store and process information in the United States. The Services are directed to residents of the United States. If you use the Services from outside the United States, you understand that your information will be transferred to and processed in the United States, where privacy laws may differ from those where you live.</p>
      </section>
      <section id="section-13">
        <h2>13. Third-party links and platforms</h2>
        <p>The Services link to and work with third-party sites and services, including Connected Platforms, Discord, FanCred, app stores, and payment processors. We are not responsible for their privacy practices. Review their policies before using them.</p>
      </section>
      <section id="section-14">
        <h2>14. Changes to this Policy</h2>
        <p>We may update this Policy. If a change is material, we will tell you by email, by a notice in the Services, or both, before it takes effect. The Effective Date at the top shows when the current version took effect. Your continued use after a change takes effect means you accept it, except where the law requires us to get your consent.</p>
      </section>
      <section id="section-15">
        <h2>15. Contact us</h2>
        <p>Brown Pig LLC (AllFantasy)</p>
        <p>1621 Central Ave, Cheyenne, WY 82001</p>
        <p>Privacy requests: <a href="mailto:support@allfantasy.ai">support@allfantasy.ai</a> (subject &quot;Privacy Request&quot;)</p>
        <p>Everything else: <a href="mailto:support@allfantasy.ai">support@allfantasy.ai</a></p>
      </section>
    </>
  )
}
