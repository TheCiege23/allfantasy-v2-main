/**
 * Component browser proof for /core/my-team, without a database or Next server.
 *
 * Bundles the REAL MyTeam screen, the REAL AfCoreShell chrome and the real CSS
 * with a deterministic roster, then measures the things an authenticated journey
 * run could not: the roster is empty on the tracked e2e league fixture
 * (`lib/e2e/seedG8League` writes DraftPick rows; MyTeam reads
 * `Roster.playerData.starters`), so no roster row and no primary control ever
 * renders there.
 *
 * Runs in Chromium AND WebKit at 320/360/390/430. WebKit matters here beyond
 * habit: the two-line name clamp is `-webkit-box`, and the phone hit area it
 * replaces was an absolutely-positioned `::after`.
 *
 * Run: node scripts/audits/mobile-my-team-browser-proof.cjs
 * Optional AF_PROOF_ENGINES=chromium to skip WebKit.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert/strict");
const root = path.resolve(__dirname, "../..").split(path.sep).join("/");
const playwright = require(root + "/node_modules/playwright");
const esbuild = require(root + "/node_modules/esbuild");

const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), "af-myteam-proof-"));
const WIDTHS = [320, 360, 390, 430];
const ENGINES = (process.env.AF_PROOF_ENGINES || "chromium,webkit").split(",");

/*
 * AF_PROOF_REPORT_ONLY=1 reports every measurement instead of stopping at the
 * first failure. It exists for the positive control: reverting a fix and
 * re-running must show THIS check going red for THAT reason, and a run that
 * aborts on the first assertion cannot show the others.
 */
const REPORT_ONLY = process.env.AF_PROOF_REPORT_ONLY === "1";
const failures = [];
function check(condition, message) {
  if (condition) return;
  if (REPORT_ONLY) failures.push(message);
  else assert.fail(message);
}

/* A name long enough to force the ellipsis/clamp in every band. */
const LONG_NAME = "Christian Kirkpatrick-Wetherington III";

const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import AfCoreShell from '${root}/components/core-app/AfCoreShell';
import MyTeam from '${root}/components/core-app/screens/MyTeam';

const player=(id,name,pos,team)=>({sleeperId:id,name,position:pos,team,sport:'NFL',imageUrl:null,
  gameContext:'vs BUF',kickoff:null,preseason:false,venue:null,injuryStatus:null,ruledOut:false,
  projectedPoints:12.4,afProjectedPoints:11.8,pprProjectedPoints:12.4,startPercent:null,ownPercent:null,
  onBye:false,seasonPoints:110.2,weekPoints:null});

const slot=(label,p,empty)=>({slotLabel:label,benchCheck:null,player:p,empty:!!empty,unresolvedId:null});

const starters=[
  slot('QB',player('1','${LONG_NAME}','QB','KC')),
  slot('RB',player('2','Javonte Williams','RB','DEN')),
  slot('RB',player('3','Rhamondre Stevenson','RB','NE')),
  slot('WR',player('4','Amon-Ra St. Brown','WR','DET')),
  slot('FLEX',null,true),
];

const data={
  league:{id:'fixture',name:'The Extremely Long Dynasty Superflex League Name',platform:'sleeper',format:'Redraft',
    sourceLink:{url:'https://sleeper.com/leagues/1/team',label:'Fix Lineup in The Extremely Long Dynasty Superflex League Name',platform:'sleeper'}},
  team:{available:true,data:{teamName:'The Very Long Championship Team Name',ownerName:'Manager',
    managerAvatarUrl:null,record:'2-1',recordKnown:true,rank:3,pointsFor:340.2,pointsAgainst:311.4,teamCount:12}},
  starters:{available:true,data:starters},
  identityNote:null,
  bench:{available:true,data:[player('5','Tyjae Spears','RB','TEN'),player('6','${LONG_NAME}','WR','SF')]},
  ir:{available:false,reason:'nobody on injured reserve'},
  taxi:{available:false,reason:'nobody on the taxi squad'},
  lock:{available:true,data:{at:new Date(Date.UTC(2026,8,13,17,0)),anyEmptySlot:true,week:3,season:2026,daysAway:2}},
  projections:{available:true,data:{total:96.4,projected:5,unprojected:0,season:'2026',week:3,
    afTotal:88.1,afProjected:4,standardComparable:true}},
  projectionBasis:{notes:['League scoring applied on the component line.'],scoringKnown:true},
  nextMatchup:{available:false,reason:'no matchups yet'},
  rosterGrade:{available:false,reason:'no results read for this league yet'},
  upcomingByes:[],
  liveScore:{available:false,reason:'not computed'},
};

const leagues=Array.from({length:6},(_,i)=>({id:String(i),name:'Test Dynasty League '+i,platform:'sleeper',mark:'L'+i}));

createRoot(document.getElementById('root')).render(
  <AfCoreShell active="my-team" leagues={leagues} syncAge={{label:'just now',stale:false}}
    syncEligibleCount={0} selectedLeagueId="0">
    <MyTeam data={data}/>
  </AfCoreShell>);`;

const empty =
  "export default function Empty(){return null}; export const GeoRestrictionNotice=Empty; export const GameDayAlertsBanner=Empty";

async function build() {
  await esbuild.build({
    stdin: { contents: fixture, resolveDir: root, loader: "tsx" },
    bundle: true,
    outfile: path.join(proofDir, "app.js"),
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "fixture-boundaries",
        setup(b) {
          b.onResolve({ filter: /^next\/(link|navigation)$/ }, (a) => ({
            path: a.path,
            namespace: "stub",
          }));
          b.onResolve({ filter: /^@\// }, (a) => {
            if (
              /(CommsDock|SyncNowButton|GeoRestrictionNotice|GameDayAlertsBanner|MiniPlayerImg)$/.test(
                a.path,
              )
            )
              return { path: a.path, namespace: "stub" };
            return b.resolve(path.join(root, a.path.slice(2)), {
              resolveDir: root,
              kind: a.kind,
            });
          });
          b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
            contents:
              a.path === "next/link"
                ? `import React from '${root}/node_modules/react'; export default function Link({href,children,prefetch,...props}){return React.createElement('a',{href,...props},children)}`
                : a.path === "next/navigation"
                  ? "export const useRouter=()=>({push(){},replace(){},prefetch(){}}); export const usePathname=()=>'/core/my-team'; export const useSearchParams=()=>new URLSearchParams();"
                  : empty,
            loader: "js",
            resolveDir: root,
          }));
        },
      },
    ],
  });
}

const html =
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<link rel="stylesheet" href="/app.css">' +
  "<style>*,*::before,*::after{box-sizing:border-box}body{margin:0}</style></head>" +
  '<body><div id="root"></div><script src="/app.js"></script></body></html>';

function serve() {
  const server = require("http").createServer((req, res) => {
    if (req.url === "/app.js" || req.url === "/app.css") {
      res.setHeader(
        "Content-Type",
        req.url.endsWith(".css") ? "text/css" : "text/javascript",
      );
      res.end(fs.readFileSync(path.join(proofDir, req.url.slice(1))));
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(html);
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

/* Tap target measured the way a finger finds it: hit-test the point, and
   confirm the element the browser returns is the control itself. */
const HIT = (sel) => HIT_NTH(sel, 0);
const HIT_NTH = (sel, index) => `(() => {
  const el = document.querySelectorAll(${JSON.stringify(sel)})[${index}];
  if (!el) return null;
  /* elementFromPoint answers null for a point outside the viewport, which is
     indistinguishable from "something covers it" — so bring it on screen
     first, or every control below the fold reads as unreachable. */
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  const cx = Math.round(r.left + r.width / 2);
  const cy = Math.round(r.top + r.height / 2);
  const owns = (n) => n === el || el.contains(n);
  const describe = (n) => n ? n.tagName.toLowerCase() + '.' + String(n.className || '').slice(0, 30) : 'null';
  const centre = document.elementFromPoint(cx, cy);
  let up = 0, down = 0;
  for (let d = 1; d <= 30; d++) {
    if (owns(document.elementFromPoint(cx, cy - d))) up = d; else break;
  }
  for (let d = 1; d <= 30; d++) {
    if (owns(document.elementFromPoint(cx, cy + d))) down = d; else break;
  }
  return { w: Math.round(r.width), h: Math.round(r.height),
           hitHeight: owns(centre) ? up + down + 1 : 0,
           onTop: describe(centre),
           text: (el.textContent || '').trim().slice(0, 40) };
})()`;

async function main() {
  await build();
  fs.copyFileSync(
    path.join(proofDir, "app.css"),
    path.join(proofDir, "app.css"),
  );
  const server = await serve();
  const port = server.address().port;
  const results = [];

  for (const engineName of ENGINES) {
    const engine = playwright[engineName.trim()];
    if (!engine) throw new Error("unknown engine " + engineName);
    const browser = await engine.launch();
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`http://127.0.0.1:${port}`);
      await page.locator(".af-mt-row").first().waitFor({ timeout: 30000 });

      const doc = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 2,
        scrollWidth: document.documentElement.scrollWidth,
        rows: document.querySelectorAll(".af-mt-row").length,
      }));
      check(
        doc.overflow === false,
        `${engineName} ${width}px: document overflows (${doc.scrollWidth} > ${width})`,
      );
      check(doc.rows > 0, `${engineName} ${width}px: no roster rows rendered`);

      /*
       * 1. The roster's most-tapped control: the player name.
       *
       * ⚠ MEASURE THE WORST TRIGGER, NOT THE FIRST. A long name that wraps to
       * two lines is nearly twice as tall as a short one, so sampling row 1
       * (deliberately the longest name in this fixture) reports the BEST case
       * and hides the short-name rows entirely. The fixture carries both.
       */
      const names = [];
      const triggerCount = await page.locator(".af-mt-row .af-pc-trigger").count();
      for (let i = 0; i < triggerCount; i++) {
        names.push(await page.evaluate(HIT_NTH(".af-mt-row .af-pc-trigger", i)));
      }
      const name = names
        .filter(Boolean)
        .sort((a, b) => a.hitHeight - b.hitHeight)[0];
      check(!!name, `${engineName} ${width}px: no player-name trigger found`);
      check(
        !!name && name.hitHeight >= 44,
        `${engineName} ${width}px: smallest of ${triggerCount} player-name tap targets is ${name && name.hitHeight}px < 44 (${JSON.stringify(name)})`,
      );

      /* 2. The three primary actions. */
      const controls = {};
      for (const [key, sel] of [
        ["fix", ".af-mt-fix"],
        ["source", ".af-mt-source"],
        ["ask", ".af-mt-ask"],
      ]) {
        const m = await page.evaluate(HIT(sel));
        controls[key] = m;
        if (m) {
          check(
            m.h >= 44,
            `${engineName} ${width}px: ${sel} is ${m.h}px tall, < 44`,
          );
        }
      }

      /* 3. Long names ellipsize rather than bleed out of their row. */
      const clipped = await page.evaluate(() => {
        const bad = [];
        document.querySelectorAll(".af-mt-row").forEach((row) => {
          const r = row.getBoundingClientRect();
          row.querySelectorAll("*").forEach((el) => {
            const b = el.getBoundingClientRect();
            if (b.width && b.right > r.right + 1) {
              bad.push({
                cls: String(el.className).slice(0, 40),
                over: Math.round(b.right - r.right),
              });
            }
          });
        });
        return bad.slice(0, 6);
      });
      check(
        clipped.length === 0,
        `${engineName} ${width}px: content escapes its row: ${JSON.stringify(clipped)}`,
      );

      /* 4. The bottom tab bar must not cover the last actionable control. */
      const bottom = await page.evaluate(() => {
        const bar = document.querySelector(".af-tabbar");
        if (!bar) return null;
        const barTop = bar.getBoundingClientRect().top;
        const content = document.querySelector(".af-content");
        content.scrollTop = content.scrollHeight;
        const controls = [...document.querySelectorAll(".af-mt-section a, .af-mt-section button")];
        const last = controls[controls.length - 1];
        return last
          ? { barTop, lastBottom: last.getBoundingClientRect().bottom, covered: last.getBoundingClientRect().top > barTop }
          : { barTop, lastBottom: null, covered: false };
      });

      await page.screenshot({
        path: path.join(proofDir, `myteam-${engineName}-${width}.png`),
      });

      results.push({ engine: engineName, width, doc, name, controls, bottom, status: "passed" });
      console.log(
        JSON.stringify({ engine: engineName, width, overflow: doc.overflow, rows: doc.rows, nameHit: name.hitHeight, controls, status: "passed" }),
      );
    }
    assert.deepEqual(pageErrors, [], `${engineName} page errors: ${pageErrors.join(" | ")}`);
    await browser.close();
  }

  server.close();
  if (failures.length) {
    console.error(`
${failures.length} FAILURE(S):`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(`My Team component proof passed on ${ENGINES.join(" + ")}. Screenshots: ${proofDir}`);
}

main().catch((e) => {
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
});
