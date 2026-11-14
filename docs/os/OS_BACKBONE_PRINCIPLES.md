# The OS backbone: how it should work, and the rules that keep it from breaking

**Written 2026-11-14.** This file sets direction. It does not record what has been measured. It turns
the owner's stated intent into working rules and maps them onto the code that exists today. For
what is built and how complete each part is, read `docs/decision-os/OS_INVENTORY_AND_ROADMAP.md`.

## 1. The intent, in the owner's words, made concrete

> The OS is the backbone — checks and balances for the app. It brings all the relevant
> information into one place and sends out what the user needs to improve or learn more. The B2C
> is a background function the user does not see. It ties into its equivalent on the front end.
> The B2B is front-facing: companies tie in and get insight into their apps, with visuals.

There are two products, and they need opposite rules:

| | **B2C backbone** | **B2B platform** |
|---|---|---|
| Who sees it | Nobody. Only its results show up. | Partner companies, on purpose |
| Branding | **None.** No "OS" label on any consumer screen | "Decision OS", "League Intelligence" and so on are the product |
| How it is reached | In-process function calls from our own pages | Versioned HTTP API, API keys, sandbox and widgets |
| Success | The Trades, Waivers and Draft screens get smarter and faster | A partner understands their leagues, their users and our value in five minutes |
| Code today | `lib/decision-os/*`, `lib/sports-os/*`, `lib/import-os/*` | `app/api/v1/*`, `lib/domain/*`, `prisma/tenancy.prisma`, `lib/decision-os/sdk/` |

## 2. The B2C backbone: three layers, one direction

```
  FACTS                         DECISIONS                         SURFACES (what users see)
  ─────                         ─────────                         ─────────────────────────
  Import OS (league sync)  ─┐   draft engine      (missing) ───▶  Draft HQ, mock drafts
  Sports data (players,     │   waiver engine     ✅      ───▶  Waivers, waiver-wire
   injuries, schedule)      ├─▶ trade engine      ✅      ───▶  Trades, War Room, Trade Evaluator
  Market values             │   lineup engine     ✅      ───▶  My Team, Matchup
  Behaviour events          │   commissioner health ✅    ───▶  Commissioner, Commissioner OS
  (trades/claims/moves)    ─┘   attention / brief ✅      ───▶  Your week, notifications
                                grounding packet  ✅      ───▶  Chimmy answers
```

Facts flow right. A surface never reaches back past the decision layer to compute its own verdict,
and a decision engine never renders anything.

### The domain map: every engine has exactly one front-end home

| Domain | Engine (backbone) | Front-end equivalent | Status |
|---|---|---|---|
| Trades | `lib/decision-os/trade/` | `/core/trades`, War Room, `/trade-evaluator` | ✅ wired |
| Waivers | `lib/decision-os/waiver/` | `/core/waivers`, `/waiver-wire` | ✅ wired |
| Lineup | `lib/decision-os/lineup/` | `/core/my-team` | ✅ wired |
| Commissioner | `commissioner-health/` plus the behavioural API | `/core/commissioner`, `/commissioner-os` | ✅ in-process since 2026-11-14 |
| Cross-league "what needs me" | `managerCommandCenter.ts`, `attentionQueue.ts` | **Your week** (`/core/week`) | ⚠ lives on a separate page (`/manager-hub`) — fold it in (§5, idea 1) |
| Draft | **none** — feed only (`draft-os/`) | Draft HQ | ❌ the biggest gap |
| Chat | `grounding/` packet | Chimmy | ✅ on in production per 2026-09-12 note |
| Speed | `lib/sports-os/` summaries | every `/core` screen | ✅ 100% since 2026-11-14 |

## 3. The rules

Every rule here comes from a failure already recorded in this repo; the source is cited where one exists.

### Wiring

1. **One engine per domain, one home per engine.** If two screens need a trade verdict, both call
   the trade engine. A screen that computes its own verdict will drift from the engine.
   `DashUserOs` and `UserOsCard` already follow this by sharing one presentational component.
2. **First-party calls are function calls, never HTTP back into ourselves.** Commissioner OS used
   to call its own `/api/v1/intelligence/*` routes over the network, and five paid modules depended
   on three production settings being correct. HTTP plus an API key is the **B2B** interface only.
   See `lib/decision-os/behavioral/api/in-process.ts`.
3. **Ship the writer with the reader, or ship neither.** A surface pointed at a table nothing
   refreshes fails silently and looks correct (CLAUDE.md, the CFBD / `ingestCFBDStats` history).
4. **Nothing ships without a caller.** A built engine with no surface, or a surface fed `null`, is
   unfinished work. The Manager DNA and recommendation cards on the league page rendered a
   placeholder for months, and were removed 2026-11-14.

### Trust

5. **Every output carries its evidence, freshness and confidence.** Use the canonical envelope
   (`docs/decision-os/CANONICAL_DECISION_CONTRACT.md`): headline, reasons, evidence, confidence,
   `dataAsOf`, and the action to take. A recommendation with no "why" is not shown.
6. **An honest absence beats a wrong claim.** "We have no recent activity for this league" is a
   different statement from "your managers are inactive". The Mission Control data-age caveat
   (`lib/commissioner-ui/decision-os-client/live.ts`, `withDataAgeCaveat`) is the model.
7. **Privacy boundaries live in the backbone, not the UI.** Commissioner-grade facts about other
   managers go only to commissioners, and inferred personality profiles go to nobody
   (`retiredProfileRoute`). A new transport must keep the same boundary: the in-process path
   answers 410 for retired routes, exactly as HTTP does.

### Change safety (not breaking what is built, or what will be)

8. **Shadow, then a percentage, then live, with one lever per step.** New engines run in shadow
   first (`DECISION_OS_*_SHADOW`). Then they go out behind a deterministic rollout
   (`lib/sports-os/rollout.ts`), and each flag gets one env override for an instant pull-back
   (`rolloutConfig.ts`). Remember that on Railway, writing a variable is a deploy.
9. **Flags expire.** A flag that has been off for 60 days is either shipped or deleted. Keep the
   inventory in one place (§5, idea 5); flags scattered across `.env.production`, Railway and
   `platform_config` are how "built but dark" became the norm.
10. **Additive contracts.** Add fields; never repurpose one. Keep compatibility exports when moving
    an engine (the waiver and trade grader moves did this). Version anything a partner can see.
11. **Every check reproduces a known failure before its pass is trusted.** Break the code, watch the
    test go red, then restore it (CLAUDE.md, "a check that cannot fail reads as a pass"). The tests
    added on 2026-11-14 were all proved this way.

### Learning

12. **Close the loop.** Log *shown → acted on → outcome* for every decision (§1 of
    `B2B_DECISION_OS_DATA_AND_EVIDENCE_REQUIREMENTS.md`). Without it the backbone cannot learn what
    advice was good. The same ledger is what the B2B dashboard shows partners.

## 4. The B2B front: what a partner company should see

The data contracts already exist (`B2B_DECISION_OS_DATA_AND_EVIDENCE_REQUIREMENTS.md`,
`B2B_EVENT_AND_LEAGUE_HEALTH_SCHEMA.md`) and so do the tenancy layer (`lib/domain/`), the versioned
API (`app/api/v1/`) and the widget SDK (`lib/decision-os/sdk/`, `PARTNER_SANDBOX_API_ENABLED`). What
is missing is the **front door**. It should be a public partner page plus a signed-in partner
portal, with:

1. **A live demo tenant.** A sample platform with seeded leagues, so a prospect clicks around real
   charts before signing anything. Commissioner OS already has `demo.ts` fixtures for every module,
   which is most of the data.
2. **League health at a glance**: engagement, retention risk, activity trend and commissioner
   workload, across all of the partner's leagues, with drill-down to one league.
3. **What the engine decided, and whether it helped**: recommendations shown, accepted and
   dismissed, and the outcome. This needs the outcome ledger (rule 12).
4. **Data quality**: freshness, coverage and identity-resolution rates. Partners trust a system
   that shows its own gaps.
5. **How it works**: an architecture diagram (the §2 picture, partner-facing), the API reference,
   the sandbox key flow, and copy-paste widget embeds.
6. **Customer-safe language only**, per the B2B requirements doc ("Intelligence", "Assist"; never "AI").

## 5. Ideas, ordered by value

1. **Fold the Command Center into Your week.** The attention queue's survivor deadlines,
   trade/waiver priorities and career line become actions in `buildWeeklyBlueprint`, and
   `/manager-hub` stays for white-label tenants. The user gets one cross-league screen, and the
   backbone stays invisible. This is the owner-approved item 1, done the backbone way; it needs a
   decision because it changes the owner's most-curated screen.
2. **A draft engine.** It is the only domain with no engine, and draft season is when most new
   users arrive. Start with pick recommendations from the existing value plus roster-need
   primitives (`value-v2` marginal roster value, `lineup` optimal matching).
3. **A "what changed since you looked" feed** driven by the sports-os reaction events. Injuries,
   trades and waiver results get pushed instead of polled, using the notification outbox and the
   fatigue budget (R7) that already exist.
4. **The outcome ledger** (rule 12). It is the single feature that improves B2C advice quality and
   B2B sales together.
5. **One flag registry.** An admin page listing every Decision OS, Sports OS and Commissioner OS
   flag with its effective value, source (code, env or `platform_config`) and age.
6. **Delete or finish the dead ends:** `dailyBriefResolver.ts` and `notificationResolver.ts` (no
   importers), `/player-command-center` (superseded by the Player Finder on 2026-11-13), the
   three-brain Phase 1 orchestrator (zero callers), and `/fantasy-os` (an unlinked menu over three
   pages).
7. **The B2B partner front door (§4)**, starting with the demo tenant.

## 6. What changed on 2026-11-14 (this file's companion commit)

- Commissioner OS reads Decision OS **in-process**, with no base URL, API key or public flag needed;
  `DECISION_OS_TRANSPORT=http` reverts it. Each module's own `isLiveReady()` switch still applies.
- Sports OS screen summaries and league invalidation went from 10% to **100%**, with per-flag env
  pull-backs (`SPORTS_OS_SCREEN_SUMMARIES_ROLLOUT=off`).
- The league page no longer renders the always-empty Manager DNA and recommendations cards.
