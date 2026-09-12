/**
 * Cascade proof for the two CTA touch-target fixes.
 *
 * WHAT IS ACTUALLY IN DOUBT. Both fixes are one-line `min-height` rules, and a
 * `min-height` rule is not interesting. What is interesting is whether it WINS:
 * `.af-core .af-btn` is (0,2,0) and sets `min-height: 36px`, and the rule it was
 * beating — `.af-lp-cta-lg` at (0,1,0) — had been declaring 46px since it was
 * written. The bug was never a missing rule. It was a losing one.
 *
 * 🛑 SO THE PROOF HAS TO BE ORDER-INDEPENDENT, BECAUSE THE PAGE IS. af-my-team.css
 * records this repo measuring a rule that sat 27,374 lines AFTER the primitive and
 * still lost, because `next dev` emits one concatenated page.css whose chunk order
 * is not stable between builds — and it records a component harness getting the
 * answer WRONG for exactly that reason, by bundling its own CSS in a lucky order.
 *
 * A tie at equal specificity is decided by order and is therefore unsafe. A win on
 * specificity is decided by the cascade and cannot be reordered out. This script
 * bundles the two stylesheets in BOTH orders and asserts the computed value is the
 * same either way — which is the difference between the two, made visible.
 *
 * It renders the markup, not the components: these are cascade questions, and
 * LandingV4/PricingV4 would drag in props and data that decide nothing here.
 *
 * Run: node scripts/audits/cta-touch-target-proof.cjs
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const assert = require("assert/strict");
const root = path.resolve(__dirname, "../..").split(path.sep).join("/");
const { chromium } = require(root + "/node_modules/playwright");

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "af-cta-proof-"));

const CORE = fs.readFileSync(root + "/components/core-app/af-core.css", "utf8");
const LANDING = fs.readFileSync(root + "/components/core-app/af-landing.css", "utf8");
const PRICING = fs.readFileSync(root + "/components/core-app/af-pricing.css", "utf8");
const TRADE = fs.readFileSync(root + "/components/core-app/af-trade-center.css", "utf8");

/*
 * The global theme toggle is styled by TAILWIND UTILITIES, not by a stylesheet
 * in this repo, so it cannot be read off disk like the three above. It is
 * compiled here from the component that owns it.
 *
 * 🛑 THIS IS THE PART THAT COULD SILENTLY DO NOTHING. `max-[720px]:min-h-[44px]`
 * is an ARBITRARY VARIANT and the first one in this codebase — nothing else uses
 * `max-[...]`. A variant Tailwind declines to emit produces no rule, no error,
 * and a control that is still 34px. Compiling it here and asserting on the
 * measured height is what turns "should work" into "does".
 */
function tailwindFor(file) {
  const { execFileSync } = require("child_process");
  const inCss = path.join(outDir, "tw-in.css");
  const outCss = path.join(outDir, "tw-out.css");
  fs.writeFileSync(inCss, "@tailwind utilities;");
  execFileSync(
    process.execPath,
    [root + "/node_modules/tailwindcss/lib/cli.js", "-i", inCss, "-o", outCss, "--content", file],
    { cwd: root, stdio: "pipe" },
  );
  return fs.readFileSync(outCss, "utf8");
}
const TOGGLE = tailwindFor("components/theme/GlobalModeToggle.tsx");

/*
 * The real markup, copied from the two screens. `af-core` on the root is what
 * brings `.af-core .af-btn` into play at all — without it the primitive never
 * applies and the whole question disappears, which would make this proof pass
 * for the wrong reason.
 */
const BODY = `
<div class="af-core af-lp">
  <a class="af-btn af-lp-cta" href="#">Get started free</a>
  <a class="af-btn af-lp-cta-lg" href="#">Get started free</a>
  <a class="af-btn af-btn--ghost af-lp-cta-lg" href="#">See how it works</a>
</div>
<div class="af-core af-pr">
  <nav><a class="af-pr-nav-link" href="#">Sign in</a></nav>
  <div class="af-pr-toggle">
    <button class="af-pr-toggle-btn" data-on="true">Monthly</button>
    <button class="af-pr-toggle-btn">Yearly</button>
  </div>
  <a class="af-pr-cta af-pr-cta--ghost" href="#">Create an account</a>
</div>
<div class="af-core">
  <input class="af-search-input" data-proof="shell-search" type="search" placeholder="Search">
  <div class="af-tc-actions">
    <p class="af-tc-caption">caption</p>
    <button type="button" class="af-btn" data-proof="tc-propose">Propose this trade</button>
    <button type="button" class="af-btn af-btn--ghost" data-proof="tc-reset">Reset</button>
  </div>
  <div class="af-tc-offer-actions">
    <button type="button" class="af-btn" data-proof="tc-accept">Accept</button>
  </div>
  <div class="af-tc-propose">
    <button type="button" class="af-btn" data-proof="tc-send">Send offer</button>
  </div>
  <div class="af-tc-partner-chips">
    <button type="button" class="af-tc-chip af-tc-partner-chip" data-proof="tc-partner">Partner</button>
  </div>
</div>
<button data-proof="theme-toggle" class="rounded-xl border px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur max-[720px]:inline-flex max-[720px]:min-h-[44px] max-[720px]:min-w-[44px] max-[720px]:items-center max-[720px]:justify-center">Dark</button>`;

/** Both orders. If the fix depends on either, these disagree and the run fails. */
const ORDERS = {
  "core-first": [CORE, LANDING, PRICING, TRADE, TOGGLE],
  "core-last": [TOGGLE, LANDING, PRICING, TRADE, CORE],
};

const TARGETS = [
  { sel: ".af-lp-cta", label: "Get started free (header)", min: 44, phoneOnly: true },
  { sel: ".af-lp-cta-lg:not(.af-btn--ghost)", label: "Get started free (hero)", min: 44, phoneOnly: false },
  { sel: ".af-btn--ghost.af-lp-cta-lg", label: "See how it works", min: 44, phoneOnly: false },
  { sel: ".af-pr-toggle-btn[data-on='true']", label: "Monthly", min: 44, phoneOnly: true },
  { sel: ".af-pr-toggle-btn:not([data-on])", label: "Yearly", min: 44, phoneOnly: true },
  { sel: ".af-pr-cta--ghost", label: "Create an account", min: 44, phoneOnly: true },
  { sel: ".af-pr-nav-link", label: "Sign in", min: 44, phoneOnly: true, axis: "w" },
  { sel: "[data-proof='theme-toggle']", label: "Theme toggle", min: 44, phoneOnly: true },
  /*
   * ⚠ TRADE CENTER, ADDED 2026-09-12 AFTER FOUR OF ITS CONTROLS WERE FOUND TO BE
   * A COIN TOSS. `.af-tc-actions .af-btn` was (0,2,0) — dead equal to
   * `.af-core .af-btn { min-height: 36px }` — so the 44px rule applied or did not
   * depending on sheet order alone. Measured before the fix: core-then-trade 44px,
   * trade-then-core 36px. The partner chip was always fine; it is not an `.af-btn`,
   * so there was never a tie to lose.
   */
  { sel: "[data-proof='tc-propose']", label: "Propose this trade", min: 44, phoneOnly: true },
  { sel: "[data-proof='tc-reset']", label: "Trade reset", min: 44, phoneOnly: true },
  { sel: "[data-proof='tc-accept']", label: "Accept offer", min: 44, phoneOnly: true },
  { sel: "[data-proof='tc-send']", label: "Send offer", min: 44, phoneOnly: true },
  { sel: "[data-proof='tc-partner']", label: "Trade partner chip", min: 44, phoneOnly: true },
  /*
   * ⚠ NOT A TAP TARGET — AN iOS ZOOM FLOOR. A text input under 16px makes Safari
   * zoom the page in on focus and never back out. `.af-search-input` is 13px and
   * lives in the SHELL, so it is on every authenticated /core screen. Found by the
   * mobile-auth lane on its first green run; measured here in both orders because
   * the rule is equal-specificity with its own base declaration and wins on source
   * order within af-core.css — which is deterministic, unlike bundle order.
   */
  { sel: "[data-proof='shell-search']", label: "Shell search input", min: 16, phoneOnly: true, axis: "font" },
];

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const name = (req.url || "/").split("?")[0].replace(/^\//, "") || "core-first";
      const sheets = ORDERS[name] || ORDERS["core-first"];
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
          "<style>*,*::before,*::after{box-sizing:border-box}body{margin:0}</style>" +
          "<style>" + sheets.join("\n") + "</style>" +
          BODY,
      );
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const MEASURE = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return { h: Math.round(r.height), w: Math.round(r.width),
           fontPx: Math.round(parseFloat(cs.fontSize)),
           minHeight: cs.minHeight };
})()`;

async function main() {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch();
  const rows = [];
  let failures = 0;

  for (const width of [390, 1280]) {
    for (const order of Object.keys(ORDERS)) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`http://127.0.0.1:${port}/${order}`);
      for (const t of TARGETS) {
        const m = await page.evaluate(MEASURE(t.sel));
        assert(m, `${t.label}: selector ${t.sel} matched nothing — the proof would pass vacuously`);
        const applies = width <= 720 || !t.phoneOnly;
        /*
         * Some of these failed on WIDTH, not height — `.af-pr-nav-link` was
         * 42x44 and the EN/ES pills 36x44. A height-only assertion calls all
         * three of those a pass, which is exactly the gap in the my-team proof
         * that the census exists to cover.
         */
        /*
         * ⚠ THREE AXES NOW, AND AN UNKNOWN ONE MUST NOT FALL THROUGH TO HEIGHT.
         * `axis: "font"` was added for the iOS 16px zoom floor; before this switch
         * knew about it, such a target would have been measured as HEIGHT and
         * passed vacuously at 44px — a check reporting on the wrong property is
         * the same defect this harness exists to prevent.
         */
        const measured = t.axis === "w" ? m.w : t.axis === "font" ? m.fontPx : m.h;
        assert(
          typeof measured === "number" && Number.isFinite(measured),
          `${t.label}: axis "${t.axis}" produced no measurement — unknown axis?`,
        );
        const ok = !applies || measured >= t.min;
        if (!ok) failures++;
        rows.push({ width, order, label: t.label, ...m, axis: t.axis, applies, ok });
      }
      await page.close();
    }
  }
  await browser.close();
  server.close();

  console.log("=".repeat(78));
  console.log("CTA TOUCH-TARGET CASCADE PROOF");
  console.log("=".repeat(78));
  for (const r of rows) {
    console.log(
      `  ${String(r.width).padStart(4)}px ${r.order.padEnd(10)} ` +
        `${r.ok ? "PASS" : "FAIL"}  ${String(r.axis === "w" ? r.w : r.axis === "font" ? r.fontPx : r.h).padStart(3)}px ${r.axis === "w" ? "wide" : r.axis === "font" ? "font" : "tall"} ` +
        `(min-height ${r.minHeight.padEnd(6)}) ${r.applies ? "" : "[not expected at this width] "}` +
        r.label,
    );
  }

  /*
   * The order-independence assertion, which is the whole point. If a fix relies
   * on landing later in the bundle, these two differ and the page is a coin toss.
   */
  console.log("");
  let drift = 0;
  for (const width of [390, 1280]) {
    for (const t of TARGETS) {
      const a = rows.find((r) => r.width === width && r.order === "core-first" && r.label === t.label);
      const b = rows.find((r) => r.width === width && r.order === "core-last" && r.label === t.label);
      const av = t.axis === "w" ? a.w : t.axis === "font" ? a.fontPx : a.h;
      const bv = t.axis === "w" ? b.w : t.axis === "font" ? b.fontPx : b.h;
      if (av !== bv) {
        drift++;
        console.log(`  *** ORDER-DEPENDENT at ${width}px: ${t.label} is ${av}px vs ${bv}px ***`);
      }
    }
  }
  console.log(
    drift === 0
      ? "  ORDER-INDEPENDENT: every measurement identical with the primitive first and last."
      : `  ${drift} measurement(s) change with stylesheet order — the fix is a coin toss.`,
  );

  if (failures || drift) {
    console.log(`\nFAILED: ${failures} undersized, ${drift} order-dependent`);
    process.exit(1);
  }
  console.log("\nAll CTA targets >= 44px where expected, in both stylesheet orders.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
