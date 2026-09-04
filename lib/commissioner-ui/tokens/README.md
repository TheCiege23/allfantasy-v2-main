# Commissioner OS Design Tokens

Phase 0.1 foundation — the design token layer every future Commissioner OS
component builds on, per the Commissioner OS Developer Playbook and
Implementation Program. Nothing in this directory implements a page, a
component, or any business logic.

## Where the values actually live

`app/globals.css` is the single source of truth, not this directory. The
Commissioner OS token block there (search for "Commissioner OS — design
tokens") is additive to the app's existing theming system — it extends the
pre-existing `--alert-*`, `--space-*`, `--radius-*`, `--transition-*`, and
`--focus-ring*` tokens rather than replacing them. Every new severity and
status color is a `var()` alias onto an already-themed color (the alert
palette, `--muted`, `--accent-purple`) rather than a new hex value, so
light/dark/legacy theming is inherited automatically, not reimplemented.

This directory (`lib/commissioner-os/tokens/`) exists only to give
components a typed, autocomplete-safe way to reference those CSS variable
*names* — matching this codebase's existing convention of consuming theme
variables via `var(--name)` in inline styles (see
`components/auth/OAuthButtonRow.tsx`). It never stores a duplicate copy of
a token's value.

## Files

- `colors.ts` — severity tiers (critical/elevated/standard/advisory/positive),
  status roles (information/opportunity/disabled), and benchmark comparison
  tokens (above/equal/below — kept distinctly named from severity even
  where the underlying value is shared, per the Design Language &
  Experience System §11).
- `spacing.ts` — spacing, radius, elevation, motion, icon/control/badge/
  container sizing, z-index, and opacity scales.
- `breakpoints.ts` — the authoritative breakpoint numbers. CSS custom
  properties can't be read inside `@media` conditions, so this file (not
  `app/globals.css`'s reference-only `--breakpoint-*` properties) is what
  any JS breakpoint logic should import.
- `index.ts` — re-exports all of the above.

## Why `commissioner-os`, not `commissioner`

`lib/commissioner/` and `components/commissioner/` already exist in this
repository and are unrelated — they're the existing product's ordinary
league-commissioner tooling (`lib/commissioner/permissions.ts`'s
`Commissioner = league owner` authorization check, draft-room components
like `PreDraftWizard.tsx`). This directory is disambiguated to avoid
colliding with, or being confused with, that pre-existing code. See the
Commissioner OS Architecture Index and Canon for the full module map.

## Usage

```ts
import { severityTokens, cssVar } from '@/lib/commissioner-os/tokens'

// -> "var(--severity-critical-text)"
const criticalTextColor = cssVar(severityTokens.critical.text)
```

Reference token names through this module; never hand-type a Commissioner
OS CSS variable string in a component.
