# Operator Console — Authed Review Checklist

**What:** The `/admin/operator` operator console (Platform Command Center) has been built as a
parallel shell to the existing `/admin`. It is typecheck-clean and its server-side auth gate is
verified, but **the authed UI has not been visually reviewed yet.** This checklist closes that gap.

**When:** Run this before the cutover ([OPERATOR_CONSOLE_CUTOVER.md](./OPERATOR_CONSOLE_CUTOVER.md)).
Sequence is **look → cutover → deepen** — deep-building sections happens after cutover so any
layout/nav changes surfaced here are made once, not on top of more sections.

**How:** Open `/admin/operator` signed in as an allowlisted admin. Walk top to bottom with the
console open. The output is an **adjustment list** (section G) — the changes to make before cutover.

---

## A. Shell & nav
- [ ] All 24 sections appear in the sidebar, grouped: Command / Operations / Business / Governance. No group is empty or mislabeled.
- [ ] Clicking each nav item routes and highlights the active item correctly.
- [ ] Every section shows an honest status dot (live / partial / planned) that matches what the body actually renders — a "live" dot over an empty panel is a bug; note it.
- [ ] Collapse the window / open on mobile: the drawer opens and closes cleanly.

## B. Environment badge (do this deliberately)
- [ ] The top-bar badge reflects where you actually are. On production it must read **PROD**; on staging/dev it must **NOT** read PROD. A dev build mislabeled PROD (or vice-versa) is the single most dangerous bug here — flag it first.
- [ ] Operator identity in the top bar is your real signed-in account.

## C. The honesty test (the core principle — check this hardest)
- [ ] "Planned" sections (Draft Operations, Legacy & Rankings, Incidents) show an honest placeholder, **NOT** a fake dashboard of zeros dressed as green.
- [ ] Any metric the platform doesn't actually measure (Open Incidents, MRR, uptime %) reads "Not configured" / "Unknown" — never a green 0.
- [ ] Attention Queue on the Overview is built from REAL signals (provider gaps, missing critical env, cron gaps, failed sync jobs, identity problems, DB health). Cross-check one item against what you know is actually true right now. If the queue is empty, confirm that's because things are genuinely clean, not because the feed is stubbed.

## D. Live sections — confirm real data, not placeholders
- [ ] **Users:** search returns a real user you know exists.
- [ ] **Data Providers / Sports Data:** health reflects reality (compare to what you'd see in the old `/admin`).
- [ ] **Communications, Subscriptions, Tokens, Platform OS, Chimmy:** each shows real numbers, and they match the old panel where the two overlap.

## E. Partial sections — confirm gaps are LABELED, not hidden
- [ ] Leagues, Imports, Decision OS, Automation, Payments, Moderation, Security, Audit Logs, Feature Flags, Support Tools, System Settings: the real part shows real data AND the unbuilt part is clearly marked as a gap.
- [ ] Feature Flags and Audit Logs show live values (these were wired to real models) — spot-check one flag and one recent audit event against truth.

## F. Security re-confirm
- [ ] In a separate private/incognito window (signed out or as a non-admin), open `/admin/operator`: you must get the neutral "Access denied" crest screen with **ZERO** info leak — no section names, no env, no hints.

## G. Capture (the adjustment list)
- [ ] Note any section where **status ≠ reality**, any **green 0**, any **env-badge mismatch**, and any place the new console **disagrees with the old `/admin`**. Those are the adjustment list before cutover.

---

### Result
- **Passes clean →** proceed to the cutover.
- **Adjustments found →** list them; they get fixed first, then re-check, then cutover.
