# Founding-member offer — email draft

**Drafted 2026-09-30 against `origin/main` `c1948ba99`, for the §5 item in
[`PAYWALL_LAUNCH_CHECKLIST_2026-10-15.md`](./PAYWALL_LAUNCH_CHECKLIST_2026-10-15.md): "Tell existing
users. Decided 2026-09-24: an offer by Oct 8. Nothing in code sends it."**

Nothing here sends anything. This is copy for the owner to send, and every claim in it was read out
of the code named beside it.

---

## 🛑 Read this before sending: the email is blocked on the Stripe coupon

**Do not send this until `STRIPE_FOUNDING_COUPON_ID` is set.** This is not caution, it is the same
invariant the product already enforces on itself:

> ⚠ FOUNDING COPY ONLY APPEARS WHEN THE COUPON IS CONFIGURED — callers pass `founding: null`
> otherwise, and every string below has a founding-free variant. **The page must never promise a
> price the checkout will not apply.**
> — `components/launch/launchCopy.ts:10-12`

An email is the one surface that cannot check the flag at render time. Send it while the coupon is
unset and every founding line in it is false the moment someone clicks through: `/pricing` and
`/upgrade` will show no founding pricing at all (`foundingMember.ts:27-30, 75`), and checkout will
apply nothing.

**Order of operations:**

1. Create the coupon in **live** Stripe.
2. Set `STRIPE_FOUNDING_COUPON_ID` on `allfantasy-v2-main`, and `FOUNDING_OFFER_LABEL` if you want
   the offer named in words. ⚠ Writing a Railway variable redeploys the service (~9 min).
3. Read both back, and load `/pricing` signed in to confirm the founding line renders.
4. Then send.

**There is no discount figure in this draft, and there is none anywhere in the repo** — the size
lives in the coupon you create. Where the email needs to name it, it quotes `FOUNDING_OFFER_LABEL`
verbatim, marked `{{OFFER_LABEL}}` below. If you decide not to set a label, use the **no-label
variant** of each line, which says the discount is applied without describing it.

---

## Subject lines

Pick one. All three avoid a figure, so none of them can outrun the coupon.

1. **You're a founding member — here's what that means on October 15**
2. **October 15: what changes, what doesn't, and what you keep**
3. **Your founding-member pricing is locked in**

Preheader: *You signed up before launch, so your pricing is locked in. Nothing to do.*

---

## Email body — with an offer label

> **You were here first. That's the whole offer.**
>
> On **October 15** AllFantasy starts charging for the deep end of the product. You already have an
> account, which means you signed up before launch — so you're a founding member, and
> **{{OFFER_LABEL}}**, applied automatically at checkout. No code to enter, nothing to claim.
>
> **Here's exactly what changes.** Three things that are open to everyone right now become AF Pro:
> player deep dives, the full trade breakdown, and Competitive Edge. That's it — that's the list.
>
> **And here's what doesn't change**, because I'd rather tell you than let you find out:
>
> - Trade Center still gives you the verdict on any deal, free. Pro is the written *why* behind it.
> - Time zones stay free. That was never going to be a paid feature.
> - Chimmy still answers two questions a day on the house, same as today.
> - If you're already paying for something, nothing about it moves.
>
> **You don't have to do anything.** Your founding pricing doesn't expire and it doesn't need
> claiming — it's attached to the account you already have. When you want the deep end, it's there
> at your price.
>
> One thing worth knowing: **don't paste a promo code at checkout.** A code *replaces* your founding
> discount instead of stacking with it, and yours is already the better deal.
>
> — Guap
> AllFantasy · Brown Pig LLC
>
> *[See what's in Pro →]  [Your account →]*

---

## Email body — no offer label

Identical except the second paragraph, for when `FOUNDING_OFFER_LABEL` is unset:

> You already have an account, which means you signed up before launch — so you're a founding
> member, and **your founding discount is applied automatically at checkout**. No code to enter,
> nothing to claim.

---

## Every claim, and where it came from

| Claim in the email | Read from |
|---|---|
| Launch is **October 15** | `DEFAULT_PAYWALL_STARTS_AT = 2026-10-15T04:00:00Z`, midnight US Eastern (`paywallLaunch.ts:14`) |
| Every existing account is a founding member | `isFoundingMemberAccount` — created strictly before launch (`foundingMember.ts:43-53`) |
| Applied **automatically, no code** | `'Founding member: your discount is applied automatically at checkout.'` (`launchCopy.ts:131-132`) |
| A promo code **replaces** it | `' No code needed — a promo code would replace it.'` (`launchCopy.ts:135`) |
| The three things that become Pro | `PRO_DEPTH_EN = 'player deep dives, the full trade breakdown and Competitive Edge'` (`launchCopy.ts:20`) |
| Trade Center keeps the free verdict | Owner decision 2026-09-24; `trade_center_ai` is a **soft** gate that falls back, never refuses (checklist §3b) |
| Time zones stay free | Owner decision 2026-09-24 (checklist §2) |
| Chimmy: two free questions a day | `lib/tokens/freeChimmyQuestions.ts:9` (checklist §4) |
| Existing paid things don't move | Owner decision 2026-09-29: routes plan-gated today stay paid (checklist §2) |
| Founding pricing doesn't expire | The coupon's duration is whatever you create — see the caution below |

### ⚠ Two lines to check against your own coupon before sending

- **"doesn't expire."** The email says the founding pricing doesn't expire. That is true only if the
  coupon you create is `forever` rather than `once` or `repeating`. `foundingMember.ts:10-13` is
  explicit that duration lives in Stripe and the repo states no figure — so this is the one sentence
  the code cannot verify for you. If the coupon is time-limited, cut "doesn't expire and" and let
  `{{OFFER_LABEL}}` carry the terms.
- **"that's the list."** True for the launch-keyed gates, and deliberately narrow. Custom scoring
  tables (`advanced_scoring`, AF Commissioner) and Chimmy past the free daily two are paid **today**,
  on routes that never read the launch date — which is why the on-site headline is "Pro analysis is
  free until Oct 15" and not "everything's free". `launchCopy.ts:24-27` records that the broader
  headline was tried and was false. The email inherits the narrow version on purpose.

---

## Spanish

The app is bilingual and the launch surfaces ship `es` copy, so this email probably needs a Spanish
version. One thing carries over from the code rather than being a translation choice:

> `FOUNDING_OFFER_LABEL` is English (the owner writes one string), so the Spanish page states the
> offer without quoting it rather than dropping an English phrase into a Spanish sentence.
> — `launchCopy.ts:55-56`, and `const label = lang === 'en' ? founding?.label ?? null : null` at `:66`

So the Spanish email should use the **no-label variant** — state that the discount applies
automatically, without quoting `{{OFFER_LABEL}}`. The launch-day date string has its own formatter
(`formatLaunchDay`, `components/launch/launchTime.ts`) if you want the date to read the same as it
does on the site.

---

## Sending it

Out of scope for this draft, and worth flagging because the obvious path does not work: there is **no
in-app path** that sends this, and the local `RESEND_API_KEY` is invalid. A hand-send renders the
email locally and goes out through the Resend MCP, and `NEXTAUTH_URL` has to be pinned or every link
in it points at localhost. Who receives it is a question for the owner — every account created before
launch qualifies, which is the whole list.
