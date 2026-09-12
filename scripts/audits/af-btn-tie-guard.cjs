#!/usr/bin/env node
/**
 * 🛑 `.af-core .af-btn { min-height: 36px }` IS A (0,2,0) PRIMITIVE, SO ANY
 * `.af-core .X` HEIGHT RULE ON A BUTTON TIES WITH IT — AND AN EQUAL-SPECIFICITY
 * TIE IS DECIDED BY WHICHEVER STYLESHEET LANDS LAST IN THE CONCATENATED
 * page.css, WHICH NO COMPONENT CONTROLS.
 *
 * Measured 2026-09-12 across the whole design system, in a real browser at
 * 390px, with af-core.css bundled first and last:
 *
 *     29 classes matched the pattern, in 14 stylesheets
 *     27 were ORDER-DEPENDENT — 44-50px one way, 36px the other
 *     28 fell under 44px in at least one order
 *
 * That is essentially every primary CTA in the app, on a phone, sized by chunk
 * order. Auth, connected accounts, commissioner hub, import, ESPN, progress,
 * landing, player finder, season outlook, league sync, week, waivers.
 *
 * THE FIX IS TO QUALIFY ON THE ELEMENT'S OWN CLASS — `.af-core .af-btn.X` is
 * (0,3,0) and wins in either order. `.af-lp-cta` already used that form and was
 * the ONLY one of the 29 that measured identically both ways, which is as close
 * to a controlled experiment as this codebase offers.
 *
 * ⚠ THIS GUARD IS STATIC ON PURPOSE. A rendering test would only cover the
 * classes someone remembered to add to a fixture; this fails on the PATTERN, so
 * a NEW `.af-core .X` height rule on a button is caught the day it is written
 * rather than the day someone measures a phone.
 *
 * ⚠ AND IT ONLY FLAGS CLASSES ACTUALLY USED ON AN `af-btn` ELEMENT. A
 * `.af-core .X` height rule on a non-button ties with nothing and is fine; the
 * tie needs both sides to exist. Flagging every two-class rule would make this
 * noise, and noisy guards get deleted.
 */
const fs = require("fs")
const path = require("path")

const ROOT = path.resolve(__dirname, "../..")
const CSS_DIR = path.join(ROOT, "components/core-app")
const SRC_DIRS = ["components", "app"].map((d) => path.join(ROOT, d))

const HEIGHT = /min-height\s*:|(?<!line-)height\s*:/

/**
 * 🛑 TWO KNOWN TIES THAT ARE NOT FIXED BY THE MECHANICAL REWRITE, EACH BECAUSE
 * APPLYING IT WOULD DECIDE SOMETHING THAT IS NOT MINE TO DECIDE. Both are real
 * findings, recorded here rather than silently excused or silently changed.
 *
 * ⚠ THIS LIST CAN ONLY SHRINK. Adding an entry to make a run pass is how a
 * guard becomes decoration — the same rule the TS error baseline carries.
 */
const KNOWN = {
  "af-lp-cta": `af-landing-import.css sets \`.af-core .af-lp-cta { min-height: 52px }\` at
    (0,2,0), while af-landing.css already sets \`.af-core .af-btn.af-lp-cta\` at
    (0,3,0) and 44px. So the 52px NEVER APPLIES — measured 44/44 in both bundle
    orders, the only one of 29 that was already order-independent.
    Rewriting this one to (0,3,0) would produce TWO competing (0,3,0) rules,
    44px and 52px, and manufacture a fresh coin toss — the exact defect being
    removed. The real question is whether the import landing page wants 52px or
    44px, and that is a design decision.`,
  "af-pf-cmp-btn": `Its own rule sets \`min-height: 36px\`, so it measures 36/36 —
    order-INdependent, and not a tie loss at all. Rewriting to (0,3,0) changes
    nothing; raising it to 44px is a separate decision about a control that was
    deliberately sized small. Left as measured debt.`,
}

/** Classes that appear on an element also carrying `af-btn`. */
function classesOnButtons() {
  const found = new Set()
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue
        walk(p)
      } else if (/\.tsx?$/.test(e.name)) {
        const src = fs.readFileSync(p, "utf8")
        for (const m of src.matchAll(/className=\{?["`']([^"`']+)["`']/g)) {
          const cls = m[1].split(/\s+/)
          if (!cls.includes("af-btn")) continue
          for (const c of cls) if (c !== "af-btn") found.add(c)
        }
      }
    }
  }
  for (const d of SRC_DIRS) if (fs.existsSync(d)) walk(d)
  return found
}

/**
 * Every `.af-core .X` selector in a rule that sets a height.
 *
 * ⚠ A PRECEDING COMMENT IS SWALLOWED INTO THE SELECTOR GROUP by `[^{}]+`, so a
 * naive fullmatch silently SKIPS every documented rule. The first sweep of this
 * defect missed 7 of 27 that way — and missed exactly the ones somebody had
 * already written an explanation for. Take the text after the last comment close.
 *
 * ⚠ AND THIS COMMENT ORIGINALLY CONTAINED A LITERAL COMMENT-CLOSE SEQUENCE while
 * describing that hazard, which terminated the block early and turned the rest of
 * the file into syntax. Node then reported the error 30 lines later, at the first
 * line that could not parse — so the location it named had nothing to do with the
 * cause.
 *
 * ⚠ THE EXPENSIVE PART WAS NOT THE TYPO. A SyntaxError exits 1, and so does this
 * guard when it FINDS ties. The positive control ran three times — clean tree,
 * tie reintroduced, restored — and reported exit 1 every time, which read as
 * "the control fires correctly". It was a broken script in all three. A status
 * shared between "working and reporting a finding" and "never ran" is not a
 * verdict; the tell was that the PASS case failed too.
 */
function tiedSelectors() {
  const out = []
  for (const name of fs.readdirSync(CSS_DIR)) {
    if (!name.endsWith(".css")) continue
    const css = fs.readFileSync(path.join(CSS_DIR, name), "utf8")
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!HEIGHT.test(m[2])) continue
      for (const part of m[1].split(",")) {
        const sel = part.split("*/").pop().trim()
        const mm = /^\.af-core\s+\.([a-z0-9-]+)$/.exec(sel)
        if (mm && mm[1] !== "af-btn") out.push({ file: name, cls: mm[1], sel })
      }
    }
  }
  return out
}

const buttons = classesOnButtons()
const all = tiedSelectors().filter((t) => buttons.has(t.cls))
const ties = all.filter((t) => !(t.cls in KNOWN))
const known = all.filter((t) => t.cls in KNOWN)

if (known.length) {
  console.log("[af-btn-tie-guard] " + known.length + " known tie(s), each recorded with a reason:")
  for (const t of known) console.log("  - " + t.file + ": ." + t.cls)
}

/*
 * ⚠ A KNOWN ENTRY THAT NO LONGER MATCHES IS ALSO A FAILURE. Without this the
 * list only ever grows stale: a class gets fixed or deleted, its excuse stays,
 * and the next genuine tie on that name is pre-excused. Same reasoning as the
 * stale-entry check on the phone gate's target baseline.
 */
const stale = Object.keys(KNOWN).filter((c) => !all.some((t) => t.cls === c))
if (stale.length) {
  console.error("[af-btn-tie-guard] STALE known entries — these no longer tie, delete them: " + stale.join(", "))
  process.exit(1)
}

if (ties.length === 0) {
  console.log("[af-btn-tie-guard] OK — no `.af-core .X` height rule ties with `.af-core .af-btn`.")
  process.exit(0)
}

console.error("[af-btn-tie-guard] " + ties.length + " equal-specificity tie(s) with `.af-core .af-btn`:\n")
for (const t of ties) {
  console.error(`  ${t.file}: \`${t.sel}\` is (0,2,0) on a class used with af-btn`)
}
console.error(
  "\nAn equal-specificity tie is decided by stylesheet order in the concatenated" +
    "\npage.css, so the rule applies or does not on a coin toss. Qualify on the" +
    "\nelement's own class instead — `.af-core .af-btn.X` is (0,3,0) and wins in" +
    "\neither order:\n",
)
for (const t of ties) console.error(`  ${t.file}:  .af-core .${t.cls}  ->  .af-core .af-btn.${t.cls}`)
process.exit(1)
