/**
 * Rendered touch-target and form-text CENSUS for the highest-traffic /core
 * phone surfaces.
 *
 * WHY THIS EXISTS. The 2026-09-11 mobile audit reported "793 potential sub-44px
 * button matches" and "174 form controls below 16px". Both are source greps —
 * the audit says so itself and calls them risk indicators, not defects. A grep
 * cannot see a 30px class that an ancestor pads to 48, nor a 13px input that a
 * media query lifts to 16 at phone widths, and it gets both directions wrong.
 *
 * This renders the REAL components and reads getComputedStyle plus
 * elementFromPoint, so every number below describes a painted control.
 *
 * 🛑 IT MEASURES BOTH AXES. The existing my-team proof asserts `h >= 44` only,
 * which is why `.af-mt-fix` passes it at 34px WIDE. Width is the axis that fails
 * silently: a control tall enough to look right can still be too narrow to hit.
 *
 * Scope, stated so the number is not over-read: two surfaces (my-team,
 * standings) plus the shared AfCoreShell chrome, at 390px, Chromium + WebKit.
 * This is NOT the whole app. It is the part reachable without a database.
 *
 * Run: node scripts/audits/mobile-target-census.cjs
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const root = path.resolve(__dirname, "../..").split(path.sep).join("/");
const playwright = require(root + "/node_modules/playwright");
const esbuild = require(root + "/node_modules/esbuild");

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "af-census-"));
const WIDTH = Number(process.env.AF_CENSUS_WIDTH || 390);
const ENGINES = (process.env.AF_CENSUS_ENGINES || "chromium,webkit").split(",");
const MIN = 44;
const MIN_FONT = 16;

const LONG = "Christian Kirkpatrick-Wetherington III";
const LEAGUES =
  "Array.from({length:6},(_,i)=>({id:String(i),name:'Test Dynasty League '+i,platform:'sleeper',mark:'L'+i}))";

const myTeamFixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import AfCoreShell from '${root}/components/core-app/AfCoreShell';
import MyTeam from '${root}/components/core-app/screens/MyTeam';
const player=(id,name,pos,team)=>({sleeperId:id,name,position:pos,team,sport:'NFL',imageUrl:null,
  gameContext:'vs BUF',kickoff:null,preseason:false,venue:null,injuryStatus:null,ruledOut:false,
  projectedPoints:12.4,afProjectedPoints:11.8,pprProjectedPoints:12.4,startPercent:null,ownPercent:null,
  onBye:false,seasonPoints:110.2,weekPoints:null});
const slot=(label,p,empty)=>({slotLabel:label,benchCheck:null,player:p,empty:!!empty,unresolvedId:null});
const starters=[slot('QB',player('1','${LONG}','QB','KC')),slot('RB',player('2','Javonte Williams','RB','DEN')),
  slot('RB',player('3','Rhamondre Stevenson','RB','NE')),slot('WR',player('4','Amon-Ra St. Brown','WR','DET')),
  slot('FLEX',null,true)];
const data={league:{id:'fixture',name:'The Extremely Long Dynasty Superflex League Name',platform:'sleeper',format:'Redraft',
    sourceLink:{url:'https://sleeper.com/leagues/1/team',label:'Fix Lineup in The Extremely Long Dynasty Superflex League Name',platform:'sleeper'}},
  team:{available:true,data:{teamName:'The Very Long Championship Team Name',ownerName:'Manager',
    managerAvatarUrl:null,record:'2-1',recordKnown:true,rank:3,pointsFor:340.2,pointsAgainst:311.4,teamCount:12}},
  starters:{available:true,data:starters},identityNote:null,
  bench:{available:true,data:[player('5','Tyjae Spears','RB','TEN'),player('6','${LONG}','WR','SF')]},
  ir:{available:false,reason:'nobody on injured reserve'},taxi:{available:false,reason:'nobody on the taxi squad'},
  lock:{available:true,data:{at:new Date(Date.UTC(2026,8,13,17,0)),anyEmptySlot:true,week:3,season:2026,daysAway:2}},
  projections:{available:true,data:{total:96.4,projected:5,unprojected:0,season:'2026',week:3,
    afTotal:88.1,afProjected:4,standardComparable:true}},
  projectionBasis:{notes:['League scoring applied on the component line.'],scoringKnown:true},
  nextMatchup:{available:false,reason:'no matchups yet'},
  rosterGrade:{available:false,reason:'no results read for this league yet'},
  upcomingByes:[],liveScore:{available:false,reason:'not computed'}};
createRoot(document.getElementById('root')).render(
  <AfCoreShell active="my-team" leagues={${LEAGUES}} syncAge={{label:'just now',stale:false}}
    syncEligibleCount={0} selectedLeagueId="0"><MyTeam data={data}/></AfCoreShell>);`;

const standingsFixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import AfCoreShell from '${root}/components/core-app/AfCoreShell';
import Standings from '${root}/components/core-app/screens/Standings';
const teams=Array.from({length:12},(_,i)=>({rosterId:String(i),name:i===0?'The Very Long Championship Team Name':'Team '+i,
  isYou:i===0,rank:i+1,pointsFor:450-i*10,average:150-i*3,weeksPlayed:3,wins:2,losses:1,movement:1}));
const data={available:true,league:{id:'fixture',name:'Mobile Test League',platform:'sleeper'},season:2026,week:3,
  seasonComplete:false,teams,you:teams[0],trend:[],recent:[],projection:{available:false,reason:'Too early'},
  scoredWeeks:3,history:teams.map((t,i)=>({...t,season:2025,teamKey:String(i),ties:0,pointsAgainst:400}))};
createRoot(document.getElementById('root')).render(
  <AfCoreShell active="standings" leagues={${LEAGUES}} syncAge={{label:'just now',stale:false}}
    syncEligibleCount={0} selectedLeagueId="0"><Standings data={data}/></AfCoreShell>);`;

const empty =
  "export default function Empty(){return null}; export const GeoRestrictionNotice=Empty; export const GameDayAlertsBanner=Empty";

function buildPlugin() {
  return {
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
              ? "export const useRouter=()=>({push(){},replace(){},prefetch(){}}); export const usePathname=()=>'/core'; export const useSearchParams=()=>new URLSearchParams();"
              : empty,
        loader: "js",
        resolveDir: root,
      }));
    },
  };
}

async function build(name, fixture) {
  await esbuild.build({
    stdin: { contents: fixture, resolveDir: root, loader: "tsx" },
    bundle: true,
    outfile: path.join(outDir, name + ".js"),
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [buildPlugin()],
  });
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const name = (req.url || "/").split("?")[0].replace(/^\//, "");
      if (name.endsWith(".js") || name.endsWith(".css")) {
        const p = path.join(outDir, name);
        if (fs.existsSync(p)) {
          res.writeHead(200, {
            "Content-Type": name.endsWith(".css")
              ? "text/css"
              : "text/javascript",
          });
          return res.end(fs.readFileSync(p));
        }
        res.writeHead(404);
        return res.end("");
      }
      if (name === "__probe") {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
            "<style>body{margin:0;padding:40px}button{display:block;margin:24px;padding:0;border:0}" +
            ".af-probe-both{width:20px;height:20px}" +
            ".af-probe-short{width:200px;height:20px}" +
            ".af-probe-narrow{width:20px;height:200px}</style>" +
            '<button class="af-probe-both">a</button>' +
            '<button class="af-probe-short">b</button>' +
            '<button class="af-probe-narrow">c</button>',
        );
      }
      const surface = name || "my-team";
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<link rel="stylesheet" href="/' +
          surface +
          '.css">' +
          /*
           * 🛑 BORDER-BOX, BECAUSE THE APP IS BORDER-BOX. `app/globals.css`
           * pulls `@tailwind base`, whose Preflight sets it on every element.
           * Without this line the harness measures in CONTENT-box, so padding
           * is ADDED to the declared width and every control renders LARGER
           * than it does in the product - .af-mt-fix came out 64x46 here
           * against 34x44 in the existing my-team proof, which does inject it.
           * A target census that silently inflates its targets under-reports,
           * which is the one direction that cannot be caught by reading the
           * output.
           */
          "<style>*,*::before,*::after{box-sizing:border-box}body{margin:0}</style>" +
          '<div id="root"></div>' +
          '<script src="/' +
          surface +
          '.js"></script>',
      );
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/*
 * The census itself, evaluated IN the page.
 *
 * The hit walks step outward from the centre with elementFromPoint, so a control
 * whose tap area is enlarged by a padded ancestor or an absolutely-positioned
 * ::after measures at its REAL size rather than its border box. That is exactly
 * the thing a source grep cannot answer, in either direction.
 */
const CENSUS = `(() => {
  const SEL = 'button, a[href], input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="switch"], [tabindex]:not([tabindex="-1"])';
  const seen = new Set();
  const small = [];
  const tinyFont = [];
  /*
   * 🛑 COVERED ELEMENTS ARE REPORTED, NOT SKIPPED. The first version of this
   * census skipped an element when elementFromPoint at its centre did not
   * the element — the reading being "covered or off-screen, so not a target
   * question". That silently dropped .af-mt-fix, which is 34px WIDE and is
   * precisely what this census was written to catch. A census that discards
   * what it cannot measure reports a smaller number and looks healthier for it.
   */
  const covered = [];
  for (const el of Array.from(document.querySelectorAll(SEL))) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (el.hasAttribute('inert') || el.closest('[inert]')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const r0 = el.getBoundingClientRect();
    if (!r0.width || !r0.height) continue;

    const tag = el.tagName.toLowerCase();
    const fontPx = parseFloat(cs.fontSize);
    const typeAttr = (el.getAttribute('type') || '').toLowerCase();
    const isField = tag === 'select' || tag === 'textarea' ||
      (tag === 'input' && !['checkbox','radio','range','color','submit','button','reset','hidden','image','file'].includes(typeAttr));
    if (isField && fontPx < ${MIN_FONT}) {
      tinyFont.push({ tag, type: typeAttr || null, cls: String(el.className || '').slice(0, 44), fontPx });
    }

    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const b = el.getBoundingClientRect();
    const cx = Math.round(b.left + b.width / 2);
    const cy = Math.round(b.top + b.height / 2);
    const owns = (n) => n === el || el.contains(n);
    const centre = document.elementFromPoint(cx, cy);
    if (!owns(centre)) {
      /* Fall back to the BORDER BOX, which is a floor on the real target. */
      const bw = Math.round(b.width), bh = Math.round(b.height);
      covered.push({
        tag,
        cls: String(el.className || '').slice(0, 44),
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 34),
        boxW: bw, boxH: bh,
        onTop: centre ? centre.tagName.toLowerCase() + '.' + String(centre.className || '').slice(0, 30) : 'null',
        undersizedByBox: bw < ${MIN} || bh < ${MIN},
      });
      continue;
    }
    let up = 0, down = 0, left = 0, right = 0;
    for (let d = 1; d <= 40; d++) { if (owns(document.elementFromPoint(cx, cy - d))) up = d; else break; }
    for (let d = 1; d <= 40; d++) { if (owns(document.elementFromPoint(cx, cy + d))) down = d; else break; }
    for (let d = 1; d <= 40; d++) { if (owns(document.elementFromPoint(cx - d, cy))) left = d; else break; }
    for (let d = 1; d <= 40; d++) { if (owns(document.elementFromPoint(cx + d, cy))) right = d; else break; }
    const hitH = up + down + 1;
    const hitW = left + right + 1;
    if (hitH < ${MIN} || hitW < ${MIN}) {
      small.push({
        tag,
        cls: String(el.className || '').slice(0, 44),
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 34),
        boxW: Math.round(b.width), boxH: Math.round(b.height),
        hitW, hitH,
        axis: (hitW < ${MIN} && hitH < ${MIN}) ? 'both' : (hitW < ${MIN} ? 'width' : 'height'),
      });
    }
  }
  return { total: seen.size, small, tinyFont, covered };
})()`;

/*
 * Renders a bare page carrying only the three probes, then runs the SAME census
 * expression over it. Same code path, known answers.
 */
async function selfTest(port) {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 844 } });
  await page.goto("http://127.0.0.1:" + port + "/__probe");
  await page.waitForSelector(".af-probe-both", { timeout: 10000 });
  const res = await page.evaluate(CENSUS);
  await browser.close();
  return res;
}

async function main() {
  await build("my-team", myTeamFixture);
  await build("standings", standingsFixture);
  const server = await serve();
  const port = server.address().port;
  const report = [];

  for (const raw of ENGINES) {
    const engineName = raw.trim();
    const engine = playwright[engineName];
    if (!engine) continue;
    const browser = await engine.launch();
    for (const surface of ["my-team", "standings"]) {
      const page = await browser.newPage({
        viewport: { width: WIDTH, height: 844 },
      });
      await page.goto("http://127.0.0.1:" + port + "/" + surface);
      await page.waitForSelector("#root *", { timeout: 20000 });
      await page.waitForTimeout(400);
      const res = await page.evaluate(CENSUS);
      if (process.env.AF_CENSUS_DEBUG === "1") {
        const dump = await page.evaluate(() => {
          const out = [];
          document.querySelectorAll('a, button, input, select, textarea').forEach((e) => {
            const r = e.getBoundingClientRect();
            out.push(e.tagName.toLowerCase() + '|' + String(e.className || '').slice(0,40) +
              '|href=' + (e.getAttribute('href') ? 'y' : 'n') +
              '|' + Math.round(r.width) + 'x' + Math.round(r.height));
          });
          return out;
        });
        console.log('DEBUG ' + surface + ' :: ' + dump.length + ' raw nodes');
        dump.forEach((d) => console.log('   ' + d));
      }
      report.push({ engine: engineName, surface, ...res });
      await page.close();
    }
    await browser.close();
  }

  const bar = "=".repeat(72);
  console.log(bar);
  console.log(
    "RENDERED TARGET CENSUS @ " +
      WIDTH +
      "px  (min " +
      MIN +
      "x" +
      MIN +
      ", field font >= " +
      MIN_FONT +
      "px)",
  );
  console.log(bar);
  for (const r of report) {
    console.log(
      "\n--- " +
        r.engine +
        " / " +
        r.surface +
        ": " +
        r.total +
        " interactive elements examined",
    );
    console.log(
      "    undersized: " +
        r.small.length +
        "   |   fields under " +
        MIN_FONT +
        "px: " +
        r.tinyFont.length,
    );
    for (const s of r.small) {
      console.log(
        "      [" +
          s.axis.padEnd(6) +
          "] " +
          String(s.hitW).padStart(3) +
          "x" +
          String(s.hitH).padEnd(3) +
          " hit  (box " +
          s.boxW +
          "x" +
          s.boxH +
          ")  " +
          s.tag +
          "." +
          s.cls +
          '  "' +
          s.label +
          '"',
      );
    }
    for (const f of r.tinyFont) {
      console.log(
        "      [font  ] " +
          f.fontPx +
          "px  " +
          f.tag +
          (f.type ? "[" + f.type + "]" : "") +
          "." +
          f.cls,
      );
    }
    const badCovered = (r.covered || []).filter((c) => c.undersizedByBox);
    if (badCovered.length) {
      console.log(
        "    centre-point covered, measured by border box instead: " +
          badCovered.length +
          " undersized",
      );
      for (const c of badCovered) {
        console.log(
          "      [cover ] box " +
            c.boxW +
            "x" +
            c.boxH +
            "  " +
            c.tag +
            "." +
            c.cls +
            '  "' +
            c.label +
            '"  under: ' +
            c.onTop,
        );
      }
    }
  }
  const totalSmall = report.reduce((n, r) => n + r.small.length, 0);
  const totalFont = report.reduce((n, r) => n + r.tinyFont.length, 0);
  const totalCovered = report.reduce(
    (n, r) => n + (r.covered || []).filter((c) => c.undersizedByBox).length,
    0,
  );
  console.log(
    "\nTOTAL across " +
      report.length +
      " engine/surface runs: " +
      totalSmall +
      " undersized (measured), " +
      totalCovered +
      " undersized (covered, by box), " +
      totalFont +
      " sub-" +
      MIN_FONT +
      "px fields",
  );

  /*
   * POSITIVE CONTROL - DERIVED FROM THIS HARNESS, NOT INHERITED FROM ANOTHER.
   *
   * The first control here asserted that .af-mt-fix must be reported, because
   * the my-team proof measures it at 34px wide. Under THIS fixture it renders
   * 64x46, so the control failed against a census that was working correctly -
   * and a control that cries wolf gets deleted, which would have left the real
   * blindness (covered elements silently skipped) uncovered.
   *
   * A control must exercise the code under test, not a number remembered from a
   * different run. So: inject three probes of known size and assert each is
   * reported on the RIGHT AXIS. Pinning the axis is what stops the width half
   * quietly becoming dead code - the very bug this census exists to catch.
   */
  const probes = await selfTest(port);
  const want = [
    ["af-probe-both", "both"],
    ["af-probe-short", "height"],
    ["af-probe-narrow", "width"],
  ];
  let controlOk = true;
  console.log("");
  console.log("POSITIVE CONTROL (injected probes):");
  for (const [cls, axis] of want) {
    const hit = probes.small.find((s) => s.cls.includes(cls));
    const ok = Boolean(hit) && hit.axis === axis;
    if (!ok) controlOk = false;
    console.log(
      "  " + (ok ? "PASS" : "FAIL") + "  " + cls + " expected axis=" + axis +
      ", got " + (hit ? hit.axis + " (" + hit.hitW + "x" + hit.hitH + ")" : "NOT REPORTED"),
    );
  }
  if (!controlOk) {
    console.log("");
    console.log("*** CONTROL FAILED - this census is not measuring what it claims. Totals above are not evidence. ***");
    process.exitCode = 2;
  } else {
    console.log("  -> both axes verified reachable; the totals above are measurements.");
  }
  server.close();

  fs.writeFileSync(
    path.join(outDir, "census.json"),
    JSON.stringify(report, null, 2),
  );
  console.log("JSON: " + path.join(outDir, "census.json"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
