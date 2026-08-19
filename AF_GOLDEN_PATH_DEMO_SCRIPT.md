# AllFantasy — Golden-Path Demo Script

**Two jobs, one document:** (1) the exact flow to **certify** the product works end-to-end for a new user (Gate A of the B2C readiness plan), and (2) the **recording script** for your marketing walkthrough. Certify it first; the moment it's clean, record the same flow.

**Branch:** `fix/access-tier-and-landing` · **Prepared:** Jul 15, 2026
**Routes below are real** (from `app/`). Anything tagged **CERTIFY** depends on the Demo-Safe Certification Pack landing first.

---

## 0. Pre-flight — set up before you record a single second

- [ ] **A real demo account** with real leagues across **at least two platforms** — Sleeper + one of ESPN/Yahoo. The whole pitch is "all your platforms in one place"; a one-platform demo undersells it.
- [ ] The account has **believable history** — a few seasons so the legacy/career surfaces show real numbers, not empty states.
- [ ] The **6-item Certification Pack is landed** (so Team Direction valuations, grades, the live-data chip, acceptance %, championships, and the archetype tile are all runtime-real). Until then, use the "safe substitutions" in §3.
- [ ] Decide **environment**: record against a stable target (prod `www.allfantasy.ai` or a clean local build) — not a half-migrated branch.
- [ ] Clean browser: logged-out incognito, no dev overlays, 1920×1080 (or 1280×800 for a tighter frame), cursor visible, notifications off.
- [ ] Know your **two cuts** up front (§5): the 60-second hook and the ~3-minute full walkthrough.

---

## 1. The through-line (the story you're telling)

> "It's Sunday. You've got five leagues across three apps. Normally that's five tabs and a prayer. Watch what happens when they're all in one place."

Every step below serves that one promise: **see everything, know what to do, know where to go.** Keep the narration in benefit language — never "AI," always "it reads your real leagues and tells you what needs attention" (your terminology rules).

---

## 2. The script — minute by minute

| # | Route / surface | You do | What the viewer sees (the wow) | Talk track | Tag |
|---|---|---|---|---|---|
| 1 | `/` (landing) → `/signup` | Start logged-out; click Sign up | Clean landing, the promise up top | "This is AllFantasy. Every league you play, one place." | Real |
| 2 | `/onboarding` → `/choose-username` | Create the account | Fast, friendly first-run | "Thirty seconds to set up." | Real |
| 3 | `/import` | Connect a **Sleeper** league (username), then an **ESPN/Yahoo** league (OAuth) | Provider picker, import progress that's honest and quick | "I'm connecting my Sleeper league… and my ESPN one. It's pulling my real rosters, history, everything." | **CERTIFY** (import reliability + speed — Gate C) |
| 4 | `/import-loading` → `/dashboard/universal` | Land on the command center | **The board lights up — all leagues appear at once.** *This is the money shot.* | "And there it is — every league, side by side." | Real (LeagueCards) |
| 5 | `/dashboard/universal` — Priority-by-Platform | Point at the attention list | Cross-league to-do: incomplete lineup, waiver run today, pending trade — each tagged which league + where | "It's already telling me what needs my attention — this lineup isn't set, this league has a waiver run today. Across all of them." | Real |
| 6 | `/dashboard/universal` — Dynasty Planet search (or `/my-players`) | Search a player you own in multiple leagues | Real headshot, season stats, cross-league ownership % | "Here's every team I have this guy on, in one view." | Real |
| 7 | `/league/[leagueId]` | Click into one league | Real players, matchup, standings for that league | "Drill into any one league and it's all here — my matchup, my roster, the real numbers." | Real |
| 8 | `/trade-finder` | Run the trade finder for that league | Ranked, real trades using that league's actual scoring settings | "It finds trades that actually fit my league's scoring — not generic rankings." | Real |
| 9 | `/waiver-ai` | Show waiver targets for the league | Ranked adds with FAAB guidance, grounded in real roster needs + live news | "Same for the waiver wire — who to add, what to bid, why." | Real |
| 10 | `/af-rankings` → `/af-legacy` | Show the career/legacy record | Real wins/losses, playoff appearances, championships, XP/tier | "And it remembers everything — my real record across every league I've ever played. This is my legacy." | Real |
| 11 | Close on `/dashboard/universal` | Return to the board | The full command center, one glance | "Five leagues, three platforms, one screen. That's game day, handled." | Real |

**The scope line to land (honesty = trust):** at step 5 or 11, say *"it tells me exactly what to do and where to go"* — **not** *"I manage it all from here."* Per your verified import scope, AF is the cockpit that shows and advises; the action happens on the source platform. Say it right and it still sounds great; say it wrong and the first user who tries to set a Yahoo lineup feels misled.

---

## 3. Do NOT show on camera yet (until certified or built)

Avoid these surfaces in the recording until they're proven — showing them now risks a fabricated or empty screen in your marketing:

- **Team Direction / Rankings-tab valuations** — cert #1 pending. **Use Trade Finder (step 8) instead**, which is fully real today. Add Team Direction to the demo *after* cert #1.
- **Opponent Behavior grade** (`/manager-compare`) — cert #2 pending; add after certified.
- **Trade Command Center's acceptance %** — cert #4 pending; the Trade Finder path avoids it entirely.
- **The "Live data connected" chip** — cert #3 has an unresolved offseason weather-cache case; don't zoom on it until resolved (it may read "delayed" in July even when sports data is fine).
- **League Buzz** and **Portfolio Analytics "Season Performance Index" / "Points For" tiles** — honestly empty (no aggregator/rollup yet). Don't frame them; scroll past or crop them out.
- **Alt-format surfaces** (survivor, zombie, big-brother, world-cup, bestball, etc.) — off-message for the NFL/NCAAF redraft core pitch. Keep the demo on the core cockpit.

> Rule: if a surface isn't tagged **Real** in §2 and certified, it doesn't go in the marketing cut. A demo that only shows real things is the entire point of the trust positioning.

---

## 4. Certification pass (Gate A) — run this before recording

Walk steps 1–11 with a **brand-new account** importing a **real** multi-platform set, and capture a screenshot at each numbered step. Pass criteria:

- [ ] Import (step 3) completes first-try for Sleeper **and** ESPN/Yahoo, board populated in **< ~90s**.
- [ ] Step 4 board shows **all** connected leagues, real names/records — nothing missing or duplicated.
- [ ] Steps 5–10 show **only real or honestly-empty** data — zero fabricated numbers on any visible surface.
- [ ] No dead "—" tiles, no broken empty states, in frame.
- [ ] The scope wording (see §2) is accurate for what the buttons actually do.

File the screenshot reel as your Gate-A evidence. That reel *is* your storyboard for the recording.

---

## 5. The two cuts

**60-second hook (social — TikTok/X/IG):** steps 1 → 3 → 4 (the light-up) → 5 (attention) → 11 (close). All wow, no depth. The light-up at step 4 should hit by second 15.

**~3-minute full walkthrough (site / demo / investor):** all 11 steps, unhurried, with the talk track. This is your evergreen demo asset — embed it on the landing page and send it to commissioners you're recruiting.

**Recording specs:** 1080p, 30fps min; visible cursor; slow, deliberate mouse; 1–2s pause on each reveal (especially step 4); captions burned in (many watch muted); end card with the one-line positioning + a "request early access / bring your league" CTA.

---

## 6. After the recording

- Cut both versions; put the 3-minute on the landing page and in your commissioner-recruit outreach (per the readiness plan §9).
- As certs #1/#2/#4 land, shoot **add-on clips** (Team Direction, Opponent Behavior compare, Trade Command Center) and splice them into a "deep tools" cut — a second-tier demo for users who want to see the analytical depth.
- Update the Launch Readiness Command Center: Gate A → certified once the reel is clean.

---

*This script is the bridge from "the product works" to "people can see why it's special." Certify it, record it, lead with it.*
