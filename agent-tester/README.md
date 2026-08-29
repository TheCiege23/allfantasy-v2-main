# Agent tester

Exploratory browser testing with archetype-driven personas. Complements `e2e/` —
it does not replace it.

## What this is for

`e2e/` encodes ~90 known-good paths. Those specs answer *"does the flow I wrote
down still work?"* This answers a different question: *"can a distracted human
who has never seen this get through it?"*

The agent is given a **goal**, not a script. It looks at the page, decides what
that persona would click, does it, and judges the result against that persona's
patience. There are no hardcoded selector paths, so it finds things nobody wrote
a spec for — dead buttons, screens that never respond, sessions that quietly die
when someone steps away.

## ⚠ Safety — read this before your first run

**This must never point at production.** Not "should not" — the preflight will
refuse.

The agent creates accounts and submits forms it discovers on its own. Against
production, per `app/api/auth/register/route.ts`, every signup:

- hits the **5-per-10-minute signup rate limit** (so you'd mostly test the limiter)
- sends a **real Resend verification email** to a fake address (bounces, charged
  against your sender reputation)
- fires **`notifyOwnerOfNewSignup`** — your inbox, once per fake account
- sends a **Meta CAPI `CompleteRegistration` conversion**, teaching your ad
  optimiser to buy the wrong audience. This one is not reversible.

This is not hypothetical. `lib/email/undeliverableDomains.ts` documents that
Vercel **preview** deployments point at the **production** database, which put
114 test rows into a 146-row `EarlyAccessSignup` table. **A `.vercel.app` URL is
not proof you are off production data.**

### How the preflight protects you

`agent-tester/preflight.ts` runs once before any persona starts and:

1. **Requires `AGENT_TESTER_BASE_URL` explicitly.** There is no default, because
   a default is how a suite finds production.
2. **Denies production hostnames** (`allfantasy.ai` and subdomains). Add more via
   `AGENT_TESTER_DENY_HOSTS`.
3. **Probes whether the e2e bypass is actually live**, by registering one account
   at a reserved domain (`@example.com`, so it cannot enter the marketing list)
   and checking the response. If `emailVerificationPrepared` comes back `true`, a
   real email was just sent — the run aborts. A 429, 451, or beta-gate 403 also
   aborts, since each only fires when the bypass is off.

If the probe fails, write missions do not run. Full stop.

## Setup

Your staging target needs `ALLOW_E2E_SEED=1` set in its environment. That is the
flag the register route checks alongside the `x-allfantasy-e2e` header.

```powershell
$env:AGENT_TESTER_BASE_URL = "https://allfantasy-v2-<hash>.vercel.app"
npm run test:agent
```

Verify the staging DB is not the production one first — you already have the tool:

```powershell
npx tsx scripts/check-staging-env.ts
```

## Running

```bash
npm run test:agent           # all missions, desktop
npm run test:agent:mobile    # all missions, Pixel 5 viewport
npm run test:agent:sweep     # exploratory sweep only
npm run test:agent:readonly  # sweep with zero writes — safe on any target
npm run test:agent:llm       # LLM-driven decisions (needs ANTHROPIC_API_KEY)
```

On macOS/Linux use the `:unix` variants of the env-setting scripts.

**`test:agent:readonly` is the one to run against an unfamiliar deploy.** It
never registers, never submits, and still catches dead links, 5xx, console
errors, slow screens, and tap-target problems.

## The archetypes

| Persona | What it exists to find |
|---|---|
| **Casual returner** | Seasonal reality — hasn't opened the app since last season, remembers nothing, short fuse. Highest-value persona for this product. |
| **Power user** | Race conditions and rate limits. Moves fast, double-clicks, keeps tabs open. |
| **Anxious first-timer** | Copy and trust problems. Mobile, slow network, reads everything, quits if a form feels invasive. |
| **Interrupted user** | Session handling. Starts a flow, idles, reloads, presses Back, returns from a second tab. |
| **Commissioner** | Widest surface area. Settings changed after the fact, invites, whole-league blast radius. |

Behaviour is defined in `archetypes.ts` — pacing, patience, device, and the
quirks each persona injects. The **patience** knob is the important one: a 30s
spinner is a pass for a script and an abandonment for a human.

## The two brains

- **heuristic** (default) — deterministic, no API key, no per-run cost, safe on
  every PR. Catches the whole dead-end / patience / session / double-submit /
  tap-target class, because those are structural failures.
- **llm** (`AGENT_TESTER_BRAIN=llm`) — uses `@anthropic-ai/sdk`, already a
  dependency here. Adds what heuristics genuinely can't do: judging whether a
  screen makes sense to a person. Falls back to heuristics on any API failure, so
  a model outage never fails a run.

Run heuristic in CI, LLM for a deeper sweep.

## Output

Reports land in `agent-tester/reports/`:

- `latest.md` — stable path, human-readable
- `agent-report-<timestamp>.md` / `.json` — per-run history
- `reports/playwright/` — Playwright HTML report with traces

Findings are written from the persona's side ("clicked Continue and nothing
happened for 9s"), with a reproduction trail underneath. Traces are **always on**
— with retries disabled, a trace captured after the fact is impossible, and the
trace is what makes an agent finding reproducible.

## Environment variables

| Variable | Purpose |
|---|---|
| `AGENT_TESTER_BASE_URL` | **Required.** Target URL. No default, by design. |
| `AGENT_TESTER_READ_ONLY` | `1` disables all writes and skips the signup probe. |
| `AGENT_TESTER_BRAIN` | `llm` to enable model-driven decisions. |
| `AGENT_TESTER_MODEL` | Override the model. Default `claude-sonnet-5`. |
| `ANTHROPIC_API_KEY` | Required for `llm` mode. |
| `AGENT_TESTER_DENY_HOSTS` | Extra comma-separated hostnames to refuse. |
| `AGENT_TESTER_IDLE_MS` | Idle duration for the interrupted user. Default `45000`. Raise above your real token lifetime for a true expiry test. |
| `AGENT_TESTER_WORKERS` | Parallel workers. Default `1` — personas interfere on a shared staging DB. |
| `AGENT_TESTER_TIMEOUT_MS` | Per-mission timeout. Default 15 min. |
| `AGENT_TESTER_OUT_DIR` | Report directory. Default `agent-tester/reports`. |

## Why it's a separate Playwright config

`playwright.agent.config.ts` is deliberately not the root config:

1. **No `webServer`.** The root config boots `next dev`; this runs against an
   already-deployed URL and must never start a server.
2. **Own `testDir`.** So `npx playwright test` at the root doesn't sweep these up
   and run exploratory write traffic as part of the normal suite.
3. **No retries.** Retrying an exploratory agent doesn't reproduce the prior run
   — it makes different choices — so a "flaky" pass tells you nothing and costs a
   full run. Read the report instead.

## Adding a mission

Missions state a goal and how to recognise success. Keep success conditions
loose — an agent that only succeeds via one exact selector is a script wearing a
costume.

```ts
const MY_MISSION: Mission = {
  id: "trade-a-player",
  goal: "Propose a trade to another manager in my league",
  startPath: "/dashboard",
  success: { textPattern: /trade (proposed|sent)/i },
  requiresWrites: true,
}
```
