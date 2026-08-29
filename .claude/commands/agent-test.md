---
description: Run the archetype-driven agent tester against a staging target, gated on the staging env safety check
argument-hint: "[readonly|sweep|mobile|llm|full] — default readonly"
allowed-tools: Bash(npx tsx scripts/check-staging-env.ts*), Bash(npm run test:agent*), Bash(printenv*), Read, Glob, Grep
---

Run `agent-tester/` against the staging target named by `AGENT_TESTER_BASE_URL`.
Mode: `$ARGUMENTS` (empty means `readonly`).

Background: `agent-tester/` is exploratory — it clicks what it finds and submits
forms nobody wrote a spec for. See the "Exploratory agent testing" section of
`CLAUDE.md` and `agent-tester/README.md` for why the target matters.

## Non-negotiables

- **Never weaken or bypass the preflight.** Do not edit `agent-tester/preflight.ts`,
  do not remove hosts from its denylist, do not introduce a default or fallback
  `AGENT_TESTER_BASE_URL`, and do not pass `--allow-prod-db` or
  `--allow-live-stripe` to the staging check. If the preflight refuses, the
  refusal is the result — report it and stop.
- **Never run against production.** `allfantasy.ai` and its subdomains are denied
  in code; do not look for a way around that.
- A `.vercel.app` hostname is **not** evidence the target is off the production
  database. Only step 2 settles that.

## Step 1 — require the target URL

Read `AGENT_TESTER_BASE_URL` from the environment (`printenv AGENT_TESTER_BASE_URL`).

If it is empty or unset, **stop immediately**. Do not guess a URL, do not read one
out of `.env`, and do not run any test command. Tell the user:

```
AGENT_TESTER_BASE_URL is not set, and there is deliberately no default.
Set it to your staging/preview deployment, then re-run /agent-test:

  PowerShell:  $env:AGENT_TESTER_BASE_URL = "https://allfantasy-v2-<hash>.vercel.app"
  bash:        export AGENT_TESTER_BASE_URL="https://allfantasy-v2-<hash>.vercel.app"
```

Echo the resolved URL back to the user before going further.

## Step 2 — staging env safety check

```bash
npx tsx scripts/check-staging-env.ts
```

It exits `1` when the environment is not safe (production DB host, live Stripe
key, and so on). **A non-zero exit ends the run** — surface the ❌ lines verbatim
and stop. Do not re-run it with an override flag. Report ⚠️ warnings but continue.

🛑 **A PASS HERE DOES NOT CLEAR A LOCAL DEV SERVER.** The script overlays
`.env.staging` on top of `.env`/`.env.local`; **Next.js never loads
`.env.staging`**. So the check can report "safe" on a file set the running
server does not use. Observed: it passed on `ep-winter-salad-…` from
`.env.staging` while `.env.local` — the file `next dev` actually reads — pointed
at `ep-curly-block-…`, the production host.

**So when the target is localhost or any dev server, read the effective
`DATABASE_URL` directly** and refuse if it is the production host:

```bash
grep -m1 '^DATABASE_URL=' .env.local .env | sed 's#.*@##; s#/.*##'
```

The staging check answers "is the staging file set safe"; only this answers
"what will the server I am about to point an agent at actually write to". If it
is the production host, `readonly` is the ONLY acceptable mode — it returns from
the preflight before `probeBypass`, so nothing is registered or submitted.

## Step 3 — run the agent tester

Only after steps 1 and 2 both pass. Pick from `$ARGUMENTS`:

| Mode | Command |
|---|---|
| `readonly` (default) | `npm run test:agent:readonly` |
| `sweep` | `npm run test:agent:sweep` |
| `mobile` | `npm run test:agent:mobile` |
| `llm` | `npm run test:agent:llm` (needs `ANTHROPIC_API_KEY`) |
| `full` | `npm run test:agent` |

`readonly` is the right choice for any target you have not run against before:
it sets `AGENT_TESTER_READ_ONLY=1`, never registers an account or submits a form,
and still finds dead links, 5xx, console errors, slow screens and tap-target
problems. Every other mode is write-capable — before running one, confirm with
the user that the target sets `ALLOW_E2E_SEED=1` and is not on the production DB.

On macOS/Linux use the `:unix` variant of `readonly` and `llm`; the default
scripts use Windows `set`.

Give the run a long timeout — a full pass is several missions at up to 15 minutes
each.

## Step 4 — report

Read `agent-tester/reports/latest.md` and summarise for the user:

- the target and mode actually run, and whether writes were enabled
- findings grouped by severity, in the persona's words, each with its archetype
  and mission
- the trace path for anything worth reproducing (traces are always on)

If the run aborted in preflight, say which check refused and what the operator
needs to change about the *target* — never about the guard.
