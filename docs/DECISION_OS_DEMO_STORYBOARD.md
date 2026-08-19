# AllFantasy Decision OS — Demo Storyboard & Partner Pitch

**A presentation-ready walkthrough** of the Decision OS intelligence surfaces for partners /
investors. Pairs with the operational [demo flow doc](./DECISION_OS_MANAGER_COMMISSIONER_DEMO_FLOW.md)
(prerequisites, flags, routes). This document is the **narrative + talk track** — what to show,
what to say, and why it matters.

> **Honesty note (unchanged):** the surfaces are built, tested, and packaged. This is a
> **seeded / live-like demo** — it is **not yet** validated against approved non-prod live Sleeper
> data. Present it as "here's the product working," not "here's a signed-off live pass." See
> [Status & what's next](#status--whats-next).

---

## One-line positioning

**AllFantasy Decision OS turns a fantasy league's own data into intelligence for two audiences —
the manager and the commissioner — without ever crossing into telling people what to do.**

## The wedge (why a partner should care)

Fantasy platforms win on **engagement, retention, fairness, and reduced commissioner workload**.
Most "AI" in the space reaches straight for recommendations — which is risky (liability, trust,
"the app told me to") and easy to get wrong. Decision OS takes the **observational** lane:

- **Managers** get a personal read on their team.
- **Commissioners** get a read on their league's health, activity, and rules.
- It is **provider-agnostic** — it sits on AllFantasy's own event/config model, so it works for an
  imported Sleeper league today and other providers later.
- The **recommendation boundary is a feature, not a limitation**: it de-risks the product and
  keeps the human in charge.

---

## The story arc

```
A league lives on (or is imported into) AllFantasy
   → Decision OS observes real league state (stored config + behavioral events)
      → the Manager opens Manager Intelligence  → personal, weekly, historical read
      → the Commissioner opens League Intelligence → league health, activity, trades, rules
      → Chimmy can explain historical replay context, observationally
   → at no point does the product tell anyone what to do
```

---

## Storyboard (scene by scene)

Each scene: **SCREEN** (what's visible) · **SAY** (talk track) · **WHY** (the point).

### Scene 1 — League Home (the launcher)
- **SCREEN:** A real league's home tab. Two clearly-labeled entry cards: **Manager Intelligence**
  and **League Intelligence**.
- **SAY:** "Everything starts from the league. From here, a manager and a commissioner each get
  their own intelligence surface — one click, grounded in this league's real data."
- **WHY:** Discovery is built in; it's not a hidden feature. League home is a launcher, not a
  dumping ground — it doesn't duplicate the hubs.

### Scene 2 — Manager Intelligence: the weekly read
- **SCREEN:** `/league/[id]/manager-hub` — **Team Health**, **Weekly Outlook**, **Transaction
  Readiness**, **League Context** cards.
- **SAY:** "This answers 'what should I pay attention to this week?' — injuries and byes on my
  starters, how my matchup projects, whether my roster is ready for moves, where I sit in the
  standings. Observations, not advice."
- **WHY:** Personal, sticky, weekly-return value — the retention hook for managers.

### Scene 3 — Manager Intelligence: the historical read
- **SCREEN:** The **Historical Replay** panel with the "Observations, not advice" framing.
- **SAY:** "We also replay history: how did this manager's past trades and lineups actually work
  out? These are validated observations from real outcomes — evidence, not a crystal ball."
- **WHY:** Depth + credibility. It's backtested signal, explicitly labeled as observational.

### Scene 4 — Commissioner Intelligence: league health at a glance
- **SCREEN:** `/league/[id]/intelligence` — **League Health** score, **Activity** summary,
  **Action Items**.
- **SAY:** "For the commissioner: one health score to track retention, an activity pulse, and an
  attention list — pending trades, inactivity — as alerts, never instructions."
- **WHY:** This is the **platform-facing** value: league health = retention signal; action items =
  reduced commissioner workload.

### Scene 5 — Commissioner Intelligence: trades, rules, receipts
- **SCREEN:** **Trade Review** (review workload), **Rule Settings** (configuration summary),
  **Audit Feed** (event timeline), **Stories** (auto-drafted recaps with a safety note).
- **SAY:** "Trade Review shows the commissioner's review *workload* — never a verdict on whether a
  trade is fair. Rule Settings *describes* how the league is configured — never judges it. And the
  audit feed is the receipts behind all of it."
- **WHY:** The boundary made concrete. Trust & safety you can point at. **Rule Settings also works
  on an import-only league** (it reads stored config), so it's the strongest opener for a
  freshly-imported Sleeper league.

### Scene 6 — Chimmy: historical context, still observational
- **SCREEN:** Chimmy answering a trade question, with a "Historical Replay Summary (observational
  only)" section.
- **SAY:** "Ask Chimmy 'how have my trades worked out?' — it brings in the historical replay
  context, with a disclaimer that these summarize the past and are not recommendations. Even the
  chat assistant stays on the observational side of the line."
- **WHY:** The boundary holds all the way through the conversational surface.

### Scene 7 — The boundary (the close)
- **SCREEN:** The safety framing / a single slide.
- **SAY:** "Decision OS observes and explains. The human still decides. That's deliberate — it's
  what makes this safe to ship across leagues and providers, and it's the foundation any
  recommendation layer would later sit *on top of*, under its own controls."
- **WHY:** Turn the constraint into the strategic moat + the roadmap hook.

---

## Value pillars (the recap slide)

| Pillar | Manager | Commissioner | Platform/partner |
| --- | --- | --- | --- |
| Engagement / retention | weekly + historical read | league health score, activity pulse | trackable retention signal |
| Fairness / trust | — | trade-review workload, audit feed | observational, no verdicts = low liability |
| Commissioner workload | — | action items, rule summary | fewer manual chores |
| Provider-agnostic | works on imported Sleeper data | same | Sleeper today, others later |

## Trust & safety framing (say / never say)

- **SAY:** "Grounded in the league's own data. Observational — it describes state, it doesn't
  dictate moves. The human decides."
- **NEVER SAY:** "The AI tells you what to do," "guaranteed winning," "automated commissioner
  decisions."

---

## Presenter checklist

1. Non-prod / demo env with the [nine feature flags](./DECISION_OS_MANAGER_COMMISSIONER_DEMO_FLOW.md#feature-flag-summary) on.
2. A demo league with **native in-app activity** (event-driven modules need it); **or** lead with
   **Rule Settings** if the league is import-only (it renders from stored config).
3. A commissioner account for the full Commissioner surface; a member account shows the manager +
   member-readable commissioner sections (commissioner-only cards show an honest restricted state).
4. Walk Scenes 1→7. Keep returning to the boundary line.

---

## Status & what's next

| Claim | Status |
| --- | --- |
| Surfaces built (5 Manager + 7 Commissioner modules) | ✅ done |
| Deterministic / display-only, no recommendation boundary crossed | ✅ verified by tests |
| Discoverable from league home + packaged demo flow | ✅ done |
| Ready to demo with seeded / live-like data | ✅ yes |
| **Validated against approved non-prod live Sleeper data** | ❌ **not yet** — needs an approved non-prod run |

**Next real unlock:** an **approved non-prod live execution** (Demo Layer Phase 2) — flip the last
line to ✅ by running the [Manager](./MANAGER_INTELLIGENCE_NONPROD_VALIDATION_RUNBOOK.md) +
[Commissioner](./COMMISSIONER_INTELLIGENCE_SNAPSHOT_SEED_RUNBOOK.md) runbooks against a real
imported Sleeper league in an approved non-prod environment, and recording results. Until then,
present this as a working product demo, not a signed-off live validation.
