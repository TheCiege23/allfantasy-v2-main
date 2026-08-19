---
name: af-build-workflow
description: Use when starting any AllFantasy feature or product build, or right after a product/pricing/tier decision is made. Produces a research-grounded build brief for Claude Code that follows the AllFantasy build checklist and brand rules, reconciles any external service (e.g. Stripe) with confirmation before writes, commits the brief into the repo, and updates project memory. Triggers on: "build brief", "turn this into a brief", "spec this feature", "implement <feature>", "we decided <X>, now build it", "update code and push to prod".
---

# AllFantasy Build Workflow

The standing way to move an AllFantasy decision into shipped code. Cowork does the thinking + external-service work; Claude Code (in `F:\allfantasy-v2-main`) does the implementation and push-to-prod. The hand-off artifact is a build brief.

## Order of operations (never skip)

1. **Decision first, brief second.** Never write a build brief before the decision is locked. If the decision isn't clear, propose options (a matrix, a short list) and get explicit approval. Only then write the brief.
2. **Research + ground before writing.** Read the real repo state (files, `.env`, catalog/config, Prisma) and any connected service before proposing. Build on what exists; do not invent file paths or duplicate existing code.
3. **Write the brief** as a `.md` in the repo root (e.g. `AF_<FEATURE>_BUILD.md`), commit it via `device_commit_files`, and tell the user how to run it: open Claude Code and say "implement the plan in `<file>`."
4. **Update project memory** with the decision and any non-obvious constraints (see the memory files below). Convert relative dates to absolute.

## Every build considers all seven (definition of done)

Thread these through the brief and self-check before shipping:

1. Visual changes — the UI, not just the logic.
2. Backend coding — API/data/services.
3. UI/UX — clarity plus loading/empty/error states.
4. Delete old/unneeded code — audit first, protect proven-live paths.
5. Fixes & gaps — close related holes the change touches.
6. SEO + ASO — titles, meta, OG, semantic headings, JSON-LD, clean URLs; app-store keywords.
7. On-brand — see brand rules below.

## Brand rules (non-negotiable, customer-facing)

- **Never the word "AI"** anywhere a customer sees (UI, copy, marketing, ASO, Stripe product names, receipts). Use Assistant / Coach (Chimmy) / Insights / Intelligence-as-a-feeling. Internal code/keys may say the real tech.
- **See-and-advise scope:** AllFantasy shows and advises across imported leagues; it does not write back / manage them in place. Say "see and decide," never "manage your ESPN/Yahoo team here."
- **Real numbers or nothing** — no fabricated projections; every number traces to a real source.
- 5-second clarity, one point per page, premium-but-simple, navy/cyan (logo) direction.

## Build brief template

```
# AF <Feature> Build Brief
Status · Prepared date · For: Claude Code in F:\allfantasy-v2-main · Goal (1–2 sentences)
Read alongside: <existing repo docs it depends on>

## 0. Build-checklist — apply all seven (list them, tailored to this feature)
## 1. Audit first — what exists in the repo to build on (never duplicate)
## 2. Scope — in scope / out of scope (leave clean seams for follow-ons)
## 3. Technical requirements — flow, data model (Prisma), endpoints, edge cases
## 4. Copy & compliance — brand rules for this surface
## 5. Acceptance criteria — checkboxes, testable
## 6. Verification — build + typecheck + tests + manual pass
## 7. Open follow-ups — what this brief deliberately defers
```

## External services (Stripe, etc.) — reconcile safely

When a build touches a live service:

1. **Read the source of truth first** — the price IDs / config the app actually uses (from `.env` + catalog), not assumptions.
2. **Map before mutating** — fetch the real objects; identify canonical vs duplicate.
3. **Surface conflicts** between the decision and the as-built reality; get a decision before writing.
4. **Confirm before live writes**, then sequence to avoid breaking prod: create new → switch env (prod dashboard, not just local) → verify → only then archive old.
5. Anything the user must do in a host dashboard (prod env, DNS) that Cowork can't reach → put it in an ordered cutover checklist.

## Project memory to load/update

- `MEMORY.md` (index) · `brand_principles.md` · `build_checklist.md` · `product_strategy.md` · `monetization_and_trial.md` · `workflow_rules.md`

Read relevant ones at the start; update them after a decision or a non-obvious learning.
