# LeagueSafe Phase 0: capture real emails

Confirmed bot inbox: **allfantasysportsapp@gmail.com**.
Test commissioner: **your own LeagueSafe account**.

This phase captures original RFC822/MIME emails and delivery authentication.
It does not interpret LeagueSafe templates, match members, change dues, or create ledger entries.
The bot never signs into LeagueSafe, scrapes pages, pays, or votes. Accept invitations by hand if needed.

## What is included

- POST /api/integrations/leaguesafe/inbound: signed capture endpoint.
- LeagueSafeRawEmail: immutable raw captures, deduplicated by Gmail message ID.
- /admin/leaguesafe/raw: admin-only list, status filters, pagination, original source and authentication details.
- A link to the viewer on the existing admin dashboard.
- [Complete Apps Script code](../../scripts/leaguesafe/Code.gs).
- [Complete Apps Script manifest](../../scripts/leaguesafe/appsscript.json).
- [Implementation and file inventory](phase-0-review.md).

The code and migration are prepared for review. Deployment, database migration,
Gmail authorization, and live capture are separate manual steps below.

## 1. Confirm the real LeagueSafe sender and signing domains

Do not guess the sender address or payment-email format.

1. In your LeagueSafe commissioner account, add **allfantasysportsapp@gmail.com**
   as an owner with **$0 dues** in one test league.
2. Sign into that bot Gmail account. Find the real LeagueSafe invitation or notification.
   Check Spam too. Do not forward it through your personal account for this step.
3. Open the message. At the upper right of the message itself, click the three-dot
   **More** menu, then **Show original**.
4. Note the complete **From** mailbox. In the raw source find the first
   **Authentication-Results** header. It should begin with **mx.google.com;**.
5. In that header, find **dkim=pass** and its **header.d** domain, or Gmail's
   **header.i** identity. For header.i, take only the domain after the @ sign.
   The Gmail summary's **signed-by** line is a useful cross-check.
6. Verify these are LeagueSafe-controlled sending/signing domains. Record the exact
   From domain and passing DKIM domain. If they differ, include both in the comma-separated
   allowlist. Later payment/payout emails may use additional domains; confirm each from
   an original message before adding it.
7. A passing SPF or DMARC result alone is insufficient. If the email has no passing
   LeagueSafe DKIM signature, it will be retained as **rejected**. Investigate with
   the original header; do not add a shared mail-provider domain to bypass the check.

**LS_SENDER_DOMAINS** has deliberately no default. Use domain names only, without
@ signs, display names, URLs, or wildcards. Subdomains must be listed explicitly.

## 2. Publish Phase 0 to Railway

Verified deployment target:

- Railway project: **AllFantasy**.
- Environment: **production**.
- Web service: **allfantasy-v2-main**.
- GitHub source: **TheCiege23/allfantasy-v2-main**, branch **main**.
- App domains: **allfantasy.ai** and **www.allfantasy.ai**.
- Existing pre-deploy command: **node scripts/railway-prod-migrate.cjs**.

During the guided setup, an original message to the bot showed From
**noreply@leaguesafe.com**, DKIM **PASS** with domain **leaguesafe.com**, and
passing SPF/DMARC. For this captured sender, use **LS_SENDER_DOMAINS=leaguesafe.com**.
Verify any additional sending/signing domains from their own original messages.

1. Review the Phase 0 code and the additive migration:
   prisma/migrations/20261114000000_leaguesafe_raw_email_capture/migration.sql.
   It creates one enum and one table, plus indexes, without altering existing tables.
2. Publish only the reviewed Phase 0 changes. The original development checkout contains
   other unfinished work; do not upload it wholesale or stage every changed file.
   The release is prepared separately on **codex/leaguesafe-phase0**, based on current main.
   Merging its reviewed PR into main triggers Railway's existing deployment.
3. In the Railway production web service's **Variables** tab, configure:
   | Variable | Value |
   | --- | --- |
   | LS_INBOUND_SECRET | A random shared secret of at least 32 bytes |
   | LS_SENDER_DOMAINS | leaguesafe.com, verified above |
   Keep the same secret privately in a password manager for the Apps Script setup.
   Do not post it in a chat, source file, screenshot, PR, or log.
4. If you still need a secret, generate it locally with:
   ~~~powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ~~~
5. Keep variable changes staged while reviewing the code. Review other pending Railway
   changes as well. Before merging, check current deployment activity so this release does
   not replace another in-flight production build.
6. When the reviewed code is released, the existing Railway pre-deploy command runs the
   guarded production migration script before the new app starts. It applies **all pending
   migrations**, so review that list and the intended Neon production target first.
   Keep every migration file **LF-only**: the repository guard rejects CRLF bytes because
   Windows and Linux must record the same migration checksum.
7. Use the configured Railway pre-deploy hook for this release. Do not run a bare Prisma
   migrate command, db push, migrate reset, or a production migration from the old local
   checkout. If the hook fails, inspect its sanitized logs and resolve the specific failure
   using the repository's guarded migration workflow before retrying.
8. Wait for this release's deployment to report **SUCCESS**. Check its pre-deploy logs for
   the new migration and its healthcheck. A queued/building status does not mean it is live.
9. Sign in through the existing AllFantasy admin login and open:
   ~~~text
   https://www.allfantasy.ai/admin/leaguesafe/raw
   ~~~
   The page should display an empty capture view. If it reports capture unavailable,
   check database connectivity, generated Prisma client, and migration installation.
10. Use this final HTTPS endpoint for Apps Script:
    ~~~text
    https://www.allfantasy.ai/api/integrations/leaguesafe/inbound
    ~~~
    The script rejects redirects; use the canonical hostname and no trailing slash.
    An unsigned POST should receive 401 after the integration is configured. A signed
    request is required to store email.

Existing DATABASE_URL/DIRECT_URL and admin authentication settings are reused.
No Gmail password, external OAuth client ID, or Gmail refresh token is stored on Railway.

## 3. Create the Apps Script on the bot account

1. In a separate browser profile or private window, sign in as
   **allfantasysportsapp@gmail.com**.
2. Open [Google Apps Script](https://script.google.com/) and click **New project**.
   Name it **AllFantasy LeagueSafe Capture**.
3. Open the project's **Code.gs** file. Replace its contents with the entire
   [provided Code.gs](../../scripts/leaguesafe/Code.gs), then save.
4. In the editor's left sidebar, beside **Services**, click **+**. Select **Gmail API**
   version **v1**, identifier **Gmail**, and click **Add**. This is the Advanced Gmail
   service inside Apps Script, authorized by the bot account.
5. Open **Project Settings** (gear icon). Turn on **Show appsscript.json manifest file
   in editor**. Return to the editor, open **appsscript.json**, replace it with the entire
   [provided manifest](../../scripts/leaguesafe/appsscript.json), and save.
   The manifest includes Gmail read/label access, outbound HTTPS, and trigger management.
6. In **Project Settings > Script Properties**, click **Add script property** and add:
   | Property | Value |
   | --- | --- |
   | LS_INBOUND_URL | The exact canonical HTTPS endpoint from step 2 |
   | LS_INBOUND_SECRET | Exactly the same secret as Railway |
   | LS_SENDER_DOMAINS | Exactly the same verified domain list as Railway |
   Click **Save script properties**. Keep the script project private.
7. If you use Apps Script's default Google Cloud project, adding the Advanced Gmail
   service enables its API automatically. If you selected your own standard Cloud project,
   enable the **Gmail API** there as well.
8. In the editor's function dropdown, choose **captureLeagueSafeEmails** and click **Run**.
   Google will ask for authorization. Select the **bot account** and review the requested
   permissions. If Google shows its unverified-app screen for this script you created,
   proceed only after checking that it is your own private project and the exact code above.
   The script itself refuses to run if Gmail reports any other mailbox.
9. Open **Executions** in the left sidebar. The run should complete. Open the test message
   in Gmail: the conversation should now display **af-processed**.
10. In AllFantasy, refresh **/admin/leaguesafe/raw**. Select the subject to see the complete
    original source and SPF/DKIM/DMARC metadata. Confirm status is **captured**, or inspect
    the reason if it is **rejected**.

You do not deploy the Apps Script as a web app. It only needs the bot-account authorization
and the time trigger.

## 4. Enable the five-minute trigger

1. After the manual run succeeds, choose **installLeagueSafeTrigger** and click **Run**.
2. In the left sidebar, open **Triggers** (clock icon). Confirm there is one time-driven
   trigger for **captureLeagueSafeEmails**, every **5 minutes**.
3. Check the trigger's **Failure notification settings** and choose a notification frequency
   you will notice. Failures also appear under **Executions**.
4. There is no need to leave a browser window open. Google runs the trigger.
5. To pause capture, delete that trigger in Apps Script. Do not remove af-processed labels
   unless intentionally retrying messages.

The installer is idempotent: running it twice does not create a second trigger.

## Delivery, retry, and security behavior

- Each run reads at most 25 unprocessed matching messages, including archived/spam/trash
  messages. There is no date cutoff, so downtime does not silently discard older messages.
  The first run also captures historical matching mail. For a backlog, run again or let
  later triggers drain it.
- Apps Script fetches Gmail's original raw RFC822/MIME message and sends it as rawBody in
  a JSON envelope, together with Gmail's immutable message ID and internalDate receipt time.
  It never reads LeagueSafe websites or interprets notification bodies.
- messageId is the immutable **Gmail message ID** in the confirmed bot inbox. The untrusted
  RFC Message-ID is preserved separately as rfcMessageId and in the original source.
  Deduplication uses the Gmail ID so forged RFC Message-IDs cannot block genuine emails.
- The exact UTF-8 JSON body is signed with HMAC-SHA256 over **timestamp + "." + body**.
  Headers are **X-LS-Timestamp** (Unix seconds) and **X-LS-Signature** (v1= plus hex digest).
  All envelope fields are covered by the signature. Requests more than 300 seconds old
  or ahead are refused. Retrying within the window cannot create another row.
- The HMAC authenticates the trusted Gmail bridge. The endpoint checks the **first**
  Authentication-Results header from Gmail's **mx.google.com**, requiring an explicitly
  allowed From domain and a passing DKIM identity/signing domain in the allowlist.
  It does not independently re-run DNS/cryptographic DKIM validation. Only the private
  Gmail bridge should have the secret; do not send arbitrary raw emails from other sources.
- Missing/invalid/expired HMAC requests get HTTP 401 and a sanitized rejection log. Their
  unauthenticated bodies are not persisted. A missing/invalid server configuration gets 503.
- Authenticated emails failing the delivery-authentication policy are stored as **rejected**
  with their source and rejection reason, and logged using only database ID and reason.
- New stored emails return 202; a duplicate returns 200 and its existing processing status.
  Both include an explicit stored acknowledgement. A rejected stored email is also terminal
  for capture and may be labeled processed: that label means **saved for review**, not trusted
  as a payment. In this phase there are no payment writes.
- The af-processed label is applied **to the acknowledged message**, which displays it on
  the conversation. It is intentionally not applied to every message in the thread at once:
  a new arrival during the HTTP request must remain eligible for the next run.
- A network error, nonreceipt response, or database failure leaves the message unprocessed
  for a later retry. If storage succeeded but Gmail labeling failed, the retry is deduplicated.
  Individual message failures do not stop the rest of the batch; the run ends with a sanitized
  failure notice so trigger failure notifications can alert you.
- Requests are capped at **2 MiB after JSON encoding**, enforced before capture storage.
  Oversized messages remain unprocessed and produce a generic execution error; inspect
  them in Gmail manually. They are not truncated or marked successfully captured.
- Email content is displayed as escaped text. HTML is never executed and remote email
  images are never loaded. Normal list queries do not load every raw body.
- Bodies, subjects, addresses, response bodies, and exception objects are not logged by
  this feature. The database and admin viewer intentionally contain private original emails.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No messages found | Correct bot account; actual From domain; Spam; domain list; existing af-processed label |
| Wrong Gmail account | Recreate/authorize the script under allfantasysportsapp@gmail.com |
| Gmail is not defined / access denied | Add Advanced Gmail service, manifest scopes, and authorize again |
| HTTP 301/302/307/308 | Use the canonical HTTPS hostname; do not enable redirect following |
| HTTP 401 | Same exact secret on both sides; deployed environment; valid timestamp |
| HTTP 403 | Check the app middleware/server policy before rotating secrets; the exact inbound POST must reach its HMAC handler from Google data centers |
| HTTP 400/415 | Use the provided complete script/envelope without modifying encoding |
| HTTP 413 / size error | Original message exceeds the 2 MiB encoded request limit; inspect manually |
| HTTP 500 / viewer unavailable | Database connectivity, generated Prisma client, migration installation |
| HTTP 503 | LS_INBOUND_SECRET is too short/unset or LS_SENDER_DOMAINS is empty/invalid; redeploy |
| Stored rejected | Inspect original Authentication-Results and rejection reason; verify exact From/DKIM domains |
| Label visible but new email missing | Do not add thread-wide Gmail filters that apply af-processed automatically |
| Failed at raw_decode | Replace Code.gs with the current version; the Advanced Gmail service can return already-decoded bytes |
| Failed at gmail_read / http_send / receipt_decode / gmail_label | The stage identifies the failed step; share only the sanitized stage/error, never email source or secrets |
| Repeated failures fill the batch | Inspect the unprocessed messages/Executions, fix the cause, then run again |

If you revise the verified sender domain configuration, previously stored rejected rows remain
immutable. Removing a Gmail label simply returns the same stored result. Capture a new original
message after correcting configuration; re-evaluating historical captures can be added after review.

## Phase 0 manual acceptance checklist

- [ ] Migration installed on the intended database, app deployed, and two env vars configured.
- [ ] Open /admin/leaguesafe/raw as an admin; an ordinary manager cannot read it.
- [ ] With your own commissioner account, add the bot as a $0-dues owner.
- [ ] Accept any LeagueSafe invitation manually if required.
- [ ] Confirm actual sender and DKIM domains from Gmail Show original.
- [ ] Run capture once; the original invite/notification appears with authentication metadata.
- [ ] Confirm an authentic allowed-domain notification is captured.
- [ ] Remove af-processed from a captured test message and run again: same database row, no duplicate.
- [ ] Confirm a later notification in the same conversation is captured separately.
- [ ] Enable the five-minute trigger and verify a later real notification is captured.
- [ ] Use normal, intended activity in the real league to obtain representative emails;
      do not make an unnecessary payment solely to test Phase 0.
- [ ] Share redacted samples for the next parser phase, preserving structure and auth-domain evidence.
      Keep credentials, addresses, personal amounts, and other private information out of committed fixtures.

**Stop here.** No Phase 1 connection/member/ledger implementation or LS notification parser is included.

## Why Apps Script instead of an external Gmail OAuth worker?

Apps Script runs under the bot account and Google manages its authorization and time triggers.
This implementation uses the Advanced Gmail service to obtain raw messages, actual receipt times,
and message-level labels. It does not require an external OAuth application or a refresh token stored
on Railway.

An external worker using the Gmail API with OAuth is possible and could later use Gmail history
notifications for higher volume, but adds consent/client/token lifecycle and scheduling work.
Google documents that an external OAuth app with publishing status **Testing** gets refresh tokens
that expire after **7 days**, except for basic identity-only scopes. Gmail access does not qualify for
that exception. That makes a testing-mode external OAuth app a poor unattended capture bridge.

Official references:

- [Apps Script Advanced Google services](https://developers.google.com/apps-script/guides/services/advanced)
- [Gmail message resource: raw and internalDate](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages)
- [Gmail message searches versus UI thread-wide searches](https://developers.google.com/workspace/gmail/api/guides/filtering)
- [Gmail labels and later messages in a thread](https://developers.google.com/workspace/gmail/api/guides/labels)
- [Apps Script HMAC utilities](https://developers.google.com/apps-script/reference/utilities/utilities)
- [Google OAuth refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)
