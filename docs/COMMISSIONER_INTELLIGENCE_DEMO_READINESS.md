# Commissioner Intelligence — Demo Readiness

**Status:** Hub polished for demo; all five modules covered by live-like render tests. **A real
imported-league pass still requires an approved non-prod environment with seeded snapshots** —
"ready to demo," not "validated live." See the [Phase 1 audit](./COMMISSIONER_INTELLIGENCE_PROOF_AUDIT.md)
and the [snapshot seed runbook](./COMMISSIONER_INTELLIGENCE_SNAPSHOT_SEED_RUNBOOK.md).

---

## Prerequisites

- **Route:** `/league/<leagueId>/intelligence` (rendered by `CommissionerIntelligenceHub`).
- **Auth role:** a **commissioner** session for the full surface (Health, Action Items, and the
  commissioner-only story types require it). A plain member sees Activity, Audit Feed, and
  member-readable stories; commissioner-only modules render a clean "Commissioner only" card.
- **Feature / tier state:** the hub has **no client feature flag** — it is always on. Gating is
  server-side: role (`requireMember`/`requireCommissioner` → 401/403) and the feature gate
  (premium-tier features return **402 → an honest "upgrade required" card**). For a clean demo,
  use a commissioner account on a tier that has the intelligence features enabled (else Health /
  Action Items may show the upgrade state by design).
- **Data:** the league must have **native `DomainEvent`s** projected into
  `IntelligenceLeagueSnapshot` (see the seed runbook). Without them, modules honestly show empty
  states.

---

## Module walkthrough

| Step | Module | What to point at | Boundary framing |
| --- | --- | --- | --- |
| 3 | League Activity | total events, open trades, per-category counts | "What's happening" — pure counts |
| 4 | League Health | 0–100 score + status + active/total managers | deterministic health, not a grade of people |
| 5 | Action Items | pending trades / staleness / inactivity alerts | **things to attend to, never prescribed moves** |
| 6 | League Stories | read-only narrative drafts + safety note | "auto-drafted recap," carries "Observations, not accusations" |
| 7 | Audit Feed | paginated event timeline | the receipts behind everything above |

Every card owns its **loading / empty / error / restricted / upgrade** states, so missing data or
permissions degrade honestly on screen.

---

## Company-friendly demo flow

1. Open an imported (or active) league **as commissioner**.
2. Open **Commissioner Intelligence** (`/league/<id>/intelligence`).
3. **League Activity** — the pulse of the league at a glance.
4. **League Health** — a single deterministic score platforms can track for retention.
5. **Action Items** — the commissioner's to-attend list (pending trades, inactivity) — *alerts,
   not advice*.
6. **League Stories** — auto-drafted, read-only recaps with a visible safety note.
7. **Audit Feed** — the underlying event timeline (transparency / trust).
8. **Explain the observation vs action boundary:** "Everything here describes the league. None of
   it takes or prescribes a commissioner action — that stays with the human commissioner."
9. **Explain the provider-agnostic future:** the same hub sits on top of AllFantasy's own event
   model, so it works across imported providers (Sleeper today, others later) without leaking
   provider internals.

Keep it company-friendly: real league data, no backend/DB detail, no raw IDs, no "AI magic"
claims — lead with **trust, safety, retention, and commissioner workload reduction**.

---

## Known blockers (honest)

1. **Imported-only leagues render mostly empty.** Commissioner data comes from **native**
   AllFantasy `DomainEvent`s, not imported provider history — an import-only league has ~0 events.
   Demo on a league with real in-app activity. (Biggest prerequisite — see seed runbook.)
2. **No live pass captured yet.** The surface is code + test verified against realistic payloads;
   a screenshotted real-league pass needs an approved non-prod env, a commissioner session, and
   seeded snapshots. No live DB was accessed.
3. **Tier/feature gate.** On a non-entitled tier, premium modules honestly show the upgrade state
   — ensure the demo account is entitled if you want Health / Action Items populated.

---

## Manual QA checklist (run in an approved non-prod env)

- [ ] Commissioner session on an entitled tier; demo league has seeded snapshots.
- [ ] All five modules render with data (Activity, Health, Action Items, Stories, Audit Feed).
- [ ] Empty/restricted/upgrade states render honestly where applicable (try a member session too).
- [ ] Audit-feed "Load more" paginates.
- [ ] No raw manager/provider IDs visible anywhere on screen.
- [ ] No recommendation/advice language; Action Items read as alerts, not instructions.
- [ ] Network tab shows only the documented `/api/v1/intelligence/...` + `/api/v1/stories/...`
      routes — no `/api/ai*` or recommendation endpoints.
- [ ] Back-to-league CTA works.
- [ ] Record results + screenshots here to promote "ready to demo" → "validated."
