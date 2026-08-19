# AllFantasy — B2C User-Readiness & Go-to-Market Plan

**Goal:** get AllFantasy to a state where you can invite real users, they feel the "everything in one place" wow, and nothing on screen betrays their trust.
**Branch:** `fix/access-tier-and-landing` · **Prepared:** Jul 15, 2026 · by Cowork (strategic planner)
**Posture:** evidence-grounded. Every "real" claim below traces to `AF_DATA_PROVENANCE_AUDIT.md`; the scope claim traces to a direct read of `lib/league-import/`.

---

## 1. The wedge — why this wins

You are building the one product the incumbents structurally *cannot* build. Sleeper, ESPN, and Yahoo are walled gardens; it is against their interest to show a user their Yahoo league next to their Sleeper league. A **neutral command center that sits above all of them** — "stop bouncing between five apps on Sunday, see everything and know exactly what to do" — is a real, defensible wedge.

And it sits on your most-certified asset. Your import layer (Sleeper, ESPN, Yahoo, MFL, Fantrax — **five providers certified against real accounts**) is the part of your product with the most runtime proof behind it. The pitch and the moat are the same thing.

**One-line positioning:** *Every league you play, in one place. Know what needs your attention, who to start, and where to go — before kickoff.*

---

## 2. What's already real (your trust foundation)

Most of the pitch is backed by surfaces the provenance audit classified **REAL**, not aspirational. This is the honest foundation for the trust you want to earn.

| The promise you're making | Backed by | Status |
|---|---|---|
| "All my leagues across every platform in one place" | Import layer — Sleeper/ESPN/Yahoo/MFL/Fantrax | **Real** (5/6 certified) |
| "Know what needs my attention across all leagues" | Priority-by-Platform (`deriveSignal()` over real roster/status/draft data) | **Real** |
| "See the player, the injury, the news, the stats" | Dynasty Planet cross-league search + live sports chain (Rolling Insights / API-Sports / TheSportsDB / CFBD) | **Real** |
| "Help me evaluate and find trades" | Trade Finder + Matchmaking (real per-league scoring, LLM clamped) | **Real** |
| "Help me work the waiver wire" | Waiver AI (real scoring + live news, LLM narrative-only) | **Real** |
| "Record my legacy — wins, playoffs, championships" | Canonical XP/rank engine + career stats | **Real** (auditable) |
| "See my whole week come together on one dashboard" | League Buzz activity feed | **Empty** (no aggregator yet) |
| "Track my performance across leagues over the season" | Portfolio Analytics weekly charts | **Empty** (no cross-league rollup yet) |

**Read this table as good news:** six of your eight headline promises are already real. Only two — both on the dashboard — are honest-empty today, and neither is load-bearing for the core pitch.

---

## 3. The honest scope — say *this*, not *that*

**Verified from source structure (`lib/league-import/`):** every provider service is a *fetch / historical-backfill / preview / commit / normalize* service. There is **no write-back service** — no lineup-submit, no waiver-submit, no push to ESPN/Yahoo/Sleeper. The native league surface (`app/league/[leagueId]`: draft, matchups, standings, commissioner, settings) is where full management happens for **AllFantasy-native** leagues.

So the true scope is:

- **Native AF leagues:** full operating system — draft, lineups, waivers, trades, commissioner tools, all in AF.
- **Imported leagues (ESPN/Yahoo/Sleeper/MFL/Fantrax):** **see everything + know exactly what to do.** The action itself (set the lineup, submit the claim) happens on the source platform; AF tells you *what*, *which league*, and *where to go.*

This is still a great pitch — but the wording is the difference between building trust and breaking it:

| ✅ Say (honest, still compelling) | ❌ Don't say (over-promises write-back) |
|---|---|
| "See every league in one place." | "Manage every league from one place." |
| "Never miss a lineup or a waiver again — we flag what needs attention across all your leagues." | "Set your lineups and submit waivers for all your leagues here." |
| "Know who to start, who to add, and where to go." | "Control your ESPN/Yahoo teams from AllFantasy." |
| "Your command center for game day." | "Your remote control for every platform." |

> **Optional 10-minute confirmation** for your executor before you finalize marketing copy: `grep -ri "submit\|writeLineup\|setLineup\|waiverClaim\|POST.*roster" lib/league-import lib/sleeper-client server/` — confirm there is no external write path. My read says there isn't; this proves it cold.

*(If you ever DO want in-place management of imported leagues, that's a large, credential-heavy roadmap item — separate initiative, not a beta blocker. The see-and-advise cockpit is the right v1.)*

---

## 4. The golden path — the one flow that must be bulletproof

Your entire conversion event is a new user's **first five minutes**. Everything in the plan serves this flow working flawlessly:

1. **Sign up** → land on the command center (empty, but inviting).
2. **Connect a league** (Sleeper handle / ESPN / Yahoo OAuth) → import runs, fast and reliable.
3. **The board lights up** → all their leagues appear at once. *This is the wow.*
4. **"Here's what needs your attention"** → Priority-by-Platform shows the cross-league to-do (incomplete lineup, waiver run today, pending trade), each tagged with *which league* and *where*.
5. **Drill into one league** → real players, injuries, matchup, waiver targets, trade analysis.
6. **See their legacy** → real career record, XP, tier.

If steps 2–4 are fast and real, you have a product. If they stutter, no amount of feature depth saves it. **Certify this path first.**

---

## 5. Gates to "user-ready" (A–E)

Work them in order. Each has an exit criterion — no gate is "done" without it.

### Gate A — Certify the golden path end-to-end
- **Depends on:** the 6-item Demo-Safe Certification Pack (already in your repo) landing first.
- **Steps:** run the full golden path with a **brand-new account** importing a **real** Sleeper/ESPN/Yahoo league; capture a screenshot at each step; confirm zero fabricated numbers on any surface a user touches.
- **Exit:** a screenshot reel of the golden path, from a fresh account, with every number real or honestly empty.

### Gate B — Game-day completeness (close or honestly-defer the two empty tiles)
- **Decision:** League Buzz (Large) and Portfolio weekly charts (Medium–Large) are real builds. For the first beta, **don't block on them.** Instead: (a) give each a well-designed, honest empty state ("Cross-league activity is coming — here's what's live today"), and (b) make sure the one thing a user *does* expect on game day — a single cross-league "what needs attention now" view — is front and center (it's Priority-by-Platform, already real).
- **Exit:** the game-day screen reads as *complete and intentional*, never broken or placeholder-y. A prospect never asks "why is this empty?"

### Gate C — First-run onboarding = the wow
- **Steps:** measure time-to-first-value (target: unified board populated in **under ~90 seconds** from connect); harden import reliability (retry, clear progress, graceful failure with a real error not a spinner-of-death); design the empty→populated transition to *feel* like a reveal.
- **Exit:** N test users (5–10) import successfully on the **first try**, unassisted, and can articulate the value back to you.

### Gate D — The trust layer (your actual differentiator)
- **Steps:** make provenance visible where it matters — legacy records show their real history, trade/waiver analysis shows it's grounded in their real league settings, and the "live data" freshness signal (now real, per cert #3) is honest. Adopt "we never show you a made-up number" as an explicit stance.
- **Exit:** a skeptical user can trace any number on screen back to a real source (their import, live stats, or a disclosed formula).

### Gate E — Go-to-market engine
- **Steps:** benefit-led positioning (§7); a recorded golden-path walkthrough as your demo asset; a **commissioner-first** recruiting loop (§9); a tight feedback channel.
- **Exit:** a repeatable recruit → onboard → feedback loop and a named target cohort (work toward your ~100-league beta goal).

---

## 6. User-ready gate checklist (go / no-go to invite users)

- [ ] All 6 demo-risk items **runtime-certified** (not just source-fixed).
- [ ] Golden path screenshot-proven from a **fresh account** on a **real** imported league.
- [ ] Import success rate ≥ ~90% first-try across Sleeper + at least one of ESPN/Yahoo.
- [ ] Every dashboard surface a user sees is **real or honestly-empty** — no fabricated numbers, no dead "—" tiles.
- [ ] Marketing copy matches the verified scope (§3) — "see & decide," not "manage in place."
- [ ] A working feedback path (in-app or email) and someone owning incident response.
- [ ] Legacy record + trade analysis + waiver help all demo cleanly on a real account.

When these are all checked, you can invite users without gambling your credibility.

---

## 7. Marketing — the message (aligned to your terminology rules)

- **Lead with the benefit, never "AI."** Your own rules: it's *Intelligence, Insights, League Health, Draft/Trade/Waiver assistance* — the product "uses your real league data and context to help you decide." Users don't buy "AI-powered"; they buy "I stopped missing waivers."
- **The game-day story is the hook.** "Sunday, 12:55pm. Five leagues. One screen tells you every lineup that's set, every one that isn't, and who to start. Then you go win."
- **Make honesty a selling point.** "We show you real numbers or nothing — never a fake projection dressed up as fact." After the discipline of your provenance audit, this is a *true* and rare claim. It directly builds the trust you named.
- **Respect the scope.** "See and decide across every platform" — confident and true beats "manage everything" and false.

---

## 8. Beta metrics that actually matter

Track these from day one — they tell you if the wow is landing:

- **Activation:** % of signups who complete at least one league import (the single most important number).
- **Time-to-first-value:** seconds from "connect" to a populated board.
- **Import reliability:** first-try success rate, by provider.
- **Leagues per user:** the multi-league users are your believers — the whole pitch is *for* them.
- **"Attention" engagement:** do users click the Priority-by-Platform items? That's proof the cockpit is useful.
- **D1 / D7 return:** do they come back next game day? (Fantasy is inherently weekly — D7 matters more than D1.)
- **Commissioner conversion:** commissioners who invite their league (see §9).

---

## 9. Recruiting — commissioners first (your viral loop)

The fastest path to your ~100-league goal isn't 100 individual users — it's **commissioners, because each one brings a whole league.** A commissioner who adopts AllFantasy is a 10–12-person acquisition event, and they're the users who feel the "manage the chaos" pain most acutely.

- **Where they are:** r/fantasyfootball, fantasy Discords, league-management communities, "dynasty" Twitter/X, and the commissioner in every group chat who already does the spreadsheet work.
- **The hook:** "Run your league *and* see all your other leagues in one place — invite your league, keep your history, get commissioner insights." Your co-commissioner workflow and invite/validation flow (already built per your brief) is the on-ramp.
- **The loop:** commissioner imports → invites league → members experience the cockpit → some of *them* import *their* other leagues → repeat.

---

## 10. Sequencing — what to do, in order

1. **Now:** finish the 6-item certification pack (already in-repo) — Gate A depends on it.
2. **Next:** certify the golden path end-to-end from a fresh account (Gate A exit).
3. **Then:** Gate B (game-day completeness via honest empty states) + Gate C (onboarding wow) — these two make the product *feel* ready.
4. **In parallel:** draft the positioning + record the golden-path walkthrough (Gate E) — you can market the moment Gates A–C are proven.
5. **Soft launch:** invite 5–10 friendly commissioners, watch the metrics in §8, fix what the golden path reveals.
6. **Scale toward the ~100-league beta** using the commissioner loop.

**Note on the rescue merge:** the `wip/phase38-rescue` branch (the fuller intelligence + redraft feature set) makes the product *deeper*, but the core B2C pitch above is already backed by real surfaces. **Don't block your first beta on the rescue merge** — get the golden path certified and start recruiting; land the rescue phases underneath as you go.

---

*Prepared as a living plan. As Gates A–E close, update the Launch Readiness Command Center so the board reflects real progress toward the invite beta.*
