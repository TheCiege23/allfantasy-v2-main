# The Replacements — Commissioner OS Call Script & Talking Points

**Purpose:** a concise, practical guide for the live demo/discovery conversation with The
Replacements. Not a contract, not a transcript to read verbatim — talking points and exact language
to reach for, plus explicit lines not to cross.

**Companion documents:**
[`THE_REPLACEMENTS_COMMISSIONER_OS_DEMO_PACKAGE.md`](THE_REPLACEMENTS_COMMISSIONER_OS_DEMO_PACKAGE.md)
(full demo package + walkthrough), [`THE_REPLACEMENTS_PROVIDER_ADAPTER_PLAN.md`](THE_REPLACEMENTS_PROVIDER_ADAPTER_PLAN.md)
(internal engineering plan), [`THE_REPLACEMENTS_TECHNICAL_DISCOVERY_HANDOFF.md`](THE_REPLACEMENTS_TECHNICAL_DISCOVERY_HANDOFF.md)
(client-facing technical discovery doc, sample payloads). This script pulls the highest-value points
from all three into something usable live on a call.

**Before the call:** run through
[`THE_REPLACEMENTS_DEMO_READINESS_CHECKLIST.md`](THE_REPLACEMENTS_DEMO_READINESS_CHECKLIST.md) —
the pre-demo technical + talking-points checklists and the Go/No-Go criteria — before using this
script live.

---

## 1. Opening Positioning

Set the frame before anything else: this is additive, not disruptive.

> "Commissioner OS is not asking you to replace your app. It is a retention and
> commissioner-success layer that can sit on top of your existing league data."

Follow with:

> "We're not here to migrate your leagues or your users anywhere. We built an intelligence layer
> that reads league activity and gives commissioners a clearer picture of their league's health —
> and we think it could work well on top of what you've already built."

---

## 2. 60-Second Pitch

> "Every fantasy platform has the same problem: leagues quietly go inactive, commissioners don't
> notice until it's too late, and there's no easy way to see which managers are checked out before
> they actually leave. We built Commissioner OS to solve that — it turns real league activity
> (trades, waivers, roster moves, drafts) into a single view for the commissioner: league health,
> whether activity is trending up or down, which managers look like they're drifting away and why,
> and specific suggested actions. It's already live and working on our own leagues today. What we'd
> want to explore with you is running it on a small set of your leagues to prove it works the same
> way on your data."

---

## 3. Problem Statement

Use if they ask "why does this matter" or seem unconvinced of the need:

- Commissioners find out a league is dying only after several managers have already checked out —
  by then it's often too late to save the season.
- There's rarely a clear, at-a-glance signal for "this league needs attention" — commissioners have
  to notice patterns themselves, if they notice at all.
- Retention conversations are usually reactive (a manager quits, then someone asks why) instead of
  proactive (a system flags declining engagement while there's still time to act).

---

## 4. What Commissioner OS Gives Their Commissioners

One view, per league, showing:
- **League health status** — a real, computed status, not a guess.
- **Activity trend** — is the league getting more or less active over time.
- **Active vs. inactive manager counts.**
- **Trade / waiver / draft / roster activity** — how much is actually happening.
- **Managers at retention risk** — flagged by name, with the real reason.
- **Recommended commissioner actions** — specific, prioritized suggestions tied to the data behind
  them.

Say: "It's the same idea as a health dashboard — but for a fantasy league, and grounded entirely in
real activity, not sentiment or guesswork."

---

## 5. What Decision OS Does In The Background

Keep this brief unless they want technical depth — most of the value of this section is establishing
credibility that there's a real system underneath, not a single dashboard.

> "Underneath Commissioner OS is Decision OS — an engine that takes raw league activity, turns it
> into a consistent event format regardless of which platform it came from, and derives behavioral
> signals from it: how engaged each manager is, what their retention risk looks like, and what's
> changed over time. It's provider-agnostic by design — it already works the same way on activity
> from other platforms, including for managers who don't have an AllFantasy account at all."

---

## 6. Demo Walkthrough Talking Points

Use alongside the actual screen-share (Commissioner Hub → Mission Control card):

1. **"This is our live Commissioner Hub — the same dashboard our commissioners already use."**
   (Establishes this isn't a mockup built for the call.)
2. **"This card here — Mission Control — is the piece we'd be talking about bringing to your
   leagues."**
3. Point at the health status: *"This sentence and status are generated automatically from real
   counts — nobody typed this."*
4. Point at the trend: if available, *"You can see activity has been [increasing/decreasing] over
   the last few periods."* If not yet available: *"For a brand-new league integration, you'd see
   this exact honest state — 'not enough history yet' — for the first couple of days. We don't fake
   a trend line before there's real data to support one."*
5. Point at retention-risk managers (or the empty state): *"Each flagged manager has a specific
   reason, not just a red flag — so a commissioner knows what to actually do about it."* Or, if
   none are flagged: *"An empty list here is also a correct, honest answer — it means the league is
   currently healthy, not that the feature is broken."*
6. Point at recommended actions: *"These come from the same real data — they're explainable, not an
   arbitrary AI suggestion."*
7. Close the walkthrough: *"Everything you just saw is powered by real trade/waiver/roster/draft
   activity. The only thing standing between this and working on your leagues is getting that same
   kind of activity data flowing to us — which is exactly what we want to talk through today."*

---

## 7. How This Helps Retention Without Overpromising ROI

Exact framing to use:

> "We believe giving commissioners earlier, clearer visibility into league health should help them
> intervene before a league quietly dies — but we haven't run a measured pilot yet, so we're not
> going to hand you a retention-lift percentage today. What we'd want to do is run this on a real
> pilot, measure it honestly, and let the data tell us what the actual impact is."

If pushed for a number: *"We don't have one yet, and we'd rather tell you that plainly than make one
up. A pilot is exactly how we'd get a real answer."*

---

## 8. What We Need From Their Platform

Keep this simple and concrete on the call — full detail lives in the technical discovery handoff:

- Stable IDs for leagues, managers/teams, and individual events.
- Real timestamps for trades, waivers, roster moves, and draft picks.
- Some way to access that data — an API, a scheduled export, or webhooks (whatever's realistic for
  them).
- A small number of pilot leagues, not their whole platform.

---

## 9. What We Do Not Need

Say this proactively — it builds trust and shortens the "what are you actually asking for" back-
and-forth:

- No user passwords or account credentials.
- No payment or billing data.
- No private messages or personal user content.
- No access to their full roster/scoring engine or live game data.
- No production write access — this is read-only, one direction, into our system.
- No full platform migration — their leagues stay exactly where they are.

---

## 10. Avoid Saying

Explicit lines not to cross on this call:

- **Do not promise a guaranteed retention lift or any specific ROI/engagement percentage.** None has
  been measured. Say so plainly if asked (§7).
- **Do not imply DFS support exists or is imminent.** It does not exist and is not part of this
  conversation.
- **Do not imply a "User OS" product exists.** It does not exist.
- **Do not imply "full League Analytics" exists today.** Only Mission Control (a single-league view)
  is built and demoable; a broader cross-league analytics surface has not been built.
- **Do not say the adapter for their platform is already built or production-ready.** It is not —
  today it's a plan (`THE_REPLACEMENTS_PROVIDER_ADAPTER_PLAN.md`) waiting on their actual data
  contract.
- **Do not ask for or imply we want access to private user data** beyond what's explicitly listed in
  §8 — no passwords, no payment info, no DMs, no more than stable ids/timestamps/activity.

---

## 11. If They Ask How Integration Works

A simple, three-step explanation to give verbally:

> "At a high level: you'd provide us with stable league, manager, and team IDs, plus a feed of
> activity events — trades, waivers, roster moves, drafts, each with a timestamp. Our system,
> Decision OS, normalizes that activity into a consistent format and derives behavioral signals from
> it — engagement, retention risk, activity trend. Commissioner OS then takes those signals and
> shows them to the commissioner as health status, trend, flagged managers, and recommended actions.
> That's it — three steps: you send activity, we score it, we show it."

---

## 12. Technical Discovery Questions

Ask these live, or note them for a scheduled technical follow-up if the call is more of a
product/business conversation:

1. Do you have a documented API today, or would this start as a data export?
2. What authentication do you support for third-party read access?
3. Are your league/team/manager/event IDs permanent, or can they change or be reused?
4. Do your transactions have real timestamps, and do you distinguish pending vs. completed?
5. How much historical activity could you provide at onboarding?
6. What volume should we expect (leagues, managers per league, weekly transaction count)?
7. Which specific leagues would you want in a pilot, and for how long?
8. Who on your side owns data-sharing/privacy sign-off?

(Full technical detail and sample payloads are in `THE_REPLACEMENTS_TECHNICAL_DISCOVERY_HANDOFF.md`
— send that as a leave-behind after the call.)

---

## 13. Questions We Need Answered Before Building The Adapter

The hard blockers — nothing below can start until these are answered:

- Do they have a documented API, or is this an export/webhook integration? (Determines the entire
  sync architecture.)
- What's their auth model? (Cannot design integration security without this.)
- Are IDs stable and timestamps real/available? (If not, we need to know what workaround exists, if
  any — some data may need to be honestly excluded rather than guessed at.)
- Which leagues, and for how long, is the pilot scoped to?
- Who owns the data-sharing agreement on their side?

---

## 14. Pilot Proposal

If the conversation goes well, propose concretely rather than vaguely:

> "What we'd propose as a next step: a small pilot covering 2–3 of your leagues. We'd need either a
> non-production sample export or sandbox API access to those leagues' trade, waiver, roster, and
> draft activity. We'd build against that, validate it end-to-end in a non-production environment,
> and then walk through the results together — Mission Control and League Health running on your
> real data. From there, we'd talk about what a broader pilot or integration looks like."

Success criteria to state plainly (full detail in the technical handoff §12):
- Real activity ingests correctly, with no duplicates on re-sync.
- Mission Control and League Health show real data for the pilot leagues.
- Trend history builds up across at least two time periods.
- Retention-risk managers are identified where the pattern genuinely exists (or honestly none are
  flagged, for a healthy league).
- Commissioner action recommendations generate from real signals.

---

## 15. Ideal Next Step

Close on one, concrete ask — don't leave the call without a specific next action:

1. **Request a small, non-production sample export or sandbox API access** covering 2–3 leagues'
   trade/waiver/roster/draft activity.
2. **Schedule a technical follow-up call** with whoever on their side owns their API/data
   architecture, using the questions in §12/§13.
3. **Agree on pilot success criteria together** (§14) — so both sides know what "the pilot worked"
   actually means before it starts.

---

## 16. Close / Next Step Ask

Exact closing language:

> "Here's what I'd suggest as a concrete next step: let's get a small, non-production sample of 2–3
> of your leagues' activity data — even a one-time export is enough to start — and schedule a
> technical follow-up with your team to walk through exactly how we'd connect to your data. If that
> goes well, we'd propose a short pilot with clear, honest success criteria before either of us
> commits to anything bigger."

If they want to move faster: *"We can move as fast as your data access allows — the limiting factor
isn't our side, it's getting a real sample of your activity data to build against."*

If they're not ready yet: *"No problem — happy to leave you with the technical discovery document so
your engineering team can review at their own pace, and we can pick this back up whenever you're
ready."*
