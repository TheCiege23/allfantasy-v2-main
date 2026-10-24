// Renders AllFantasy social carousels to 1080x1350 PNGs. Run: node marketing/social/render-carousels.mjs
const { chromium } = await import('playwright').catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'))
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const DIR = path.dirname(new URL(import.meta.url).pathname)
const A = (p) => pathToFileURL(path.join(DIR, '..', '..', 'public', p)).href

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800;900&display=block');
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1350px;overflow:hidden}
body{font-family:Inter,sans-serif;color:#EAF4FF;background:#030817;position:relative}
.bg{position:absolute;inset:0;background:
  radial-gradient(900px 700px at 85% -10%, rgba(11,141,203,.45), transparent 60%),
  radial-gradient(800px 700px at -10% 110%, rgba(1,41,103,.9), transparent 65%),
  linear-gradient(180deg,#041029 0%,#030817 100%)}
.grid{position:absolute;inset:0;opacity:.07;background-image:
  linear-gradient(#5cc8ff 1px,transparent 1px),linear-gradient(90deg,#5cc8ff 1px,transparent 1px);
  background-size:60px 60px;mask-image:linear-gradient(180deg,transparent,#000 30%,#000 70%,transparent)}
.wrap{position:absolute;inset:0;padding:90px 84px 170px;display:flex;flex-direction:column;justify-content:center}
.eyebrow{font-weight:800;letter-spacing:.22em;text-transform:uppercase;font-size:24px;color:#3BC4FF;display:flex;align-items:center;gap:14px}
.eyebrow:before{content:'';width:40px;height:4px;background:#3BC4FF;border-radius:2px}
h1{font-family:Anton,Impact,sans-serif;font-weight:400;text-transform:uppercase;line-height:.95;letter-spacing:.005em}
.xl{font-size:150px}.l{font-size:112px}.m{font-size:88px}
.cy{color:#3BC4FF}.dim{color:#8FA6C4}
p.lead{font-size:38px;line-height:1.35;color:#C6D6EA;font-weight:500;max-width:880px}
.foot{position:absolute;left:84px;right:84px;bottom:56px;display:flex;align-items:center;justify-content:space-between;font-weight:700;font-size:26px;color:#9FB6D3}
.brand{display:flex;align-items:center;gap:14px;color:#EAF4FF;letter-spacing:.02em}
.brand img{height:52px}
.swipe{display:flex;align-items:center;gap:12px;color:#3BC4FF}
.dots{display:flex;gap:8px}.dots i{width:10px;height:10px;border-radius:50%;background:#28405f}.dots i.on{background:#3BC4FF;width:30px;border-radius:5px}
.card{background:linear-gradient(180deg,rgba(18,40,78,.92),rgba(8,20,44,.92));border:2px solid rgba(59,196,255,.28);border-radius:34px;box-shadow:0 30px 80px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.03) inset}
.tag{display:inline-block;font-size:20px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;padding:8px 16px;border-radius:999px}
.red{background:rgba(255,77,94,.16);color:#FF7A87}.amb{background:rgba(255,184,0,.16);color:#FFC94D}.grn{background:rgba(42,214,140,.16);color:#4BE3A2}.blu{background:rgba(59,196,255,.16);color:#6FD3FF}
.row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:26px 32px;border-top:1px solid rgba(255,255,255,.07)}
.row:first-child{border-top:0}
.rt{font-size:32px;font-weight:700}.rs{font-size:24px;color:#8FA6C4;margin-top:6px;font-weight:500}
.ex{font-size:20px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#5f7898}
.btn{display:inline-flex;align-items:center;gap:16px;background:#3BC4FF;color:#03122b;font-weight:900;font-size:40px;padding:30px 52px;border-radius:999px;box-shadow:0 20px 60px rgba(59,196,255,.35)}
`

const foot = (i, n) => `<div class="foot">
  <div class="brand"><img src="${A('af-crest.svg')}"/>ALLFANTASY.AI</div>
  <div class="dots">${Array.from({ length: n }, (_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
  <div class="swipe">${i < n - 1 ? 'SWIPE <span style="font-size:34px">→</span>' : 'LINK IN BIO'}</div></div>`

const page = (body, i, n, extraBg = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
  <div class="bg"></div>${extraBg}<div class="grid"></div><div class="wrap">${body}</div>${foot(i, n)}</body></html>`

const art = (file, pos = 'center 30%') => `<div style="position:absolute;inset:0;background:url('${A(file)}') ${pos}/cover"></div>
<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(3,8,23,.15) 0%,rgba(3,8,23,.05) 35%,rgba(3,8,23,.88) 66%,#030817 82%)"></div>`

/* ---------------- Carousel 1: one board ---------------- */
const c1 = [
  () => `<div class="eyebrow">Fantasy managers, be honest</div>
   <div style="margin-top:auto">
   <h1 class="xl">4 leagues.<br/>4 apps.<br/><span class="cy">0 chill.</span></h1>
   <p class="lead" style="margin-top:44px">Sunday shouldn't feel like a part-time job. Here's how to run every league from one screen.</p></div>`,

  () => `<div class="eyebrow">01 · One board</div>
   <h1 class="l" style="margin-top:28px">All your leagues.<br/><span class="cy">One board.</span></h1>
   <div class="card" style="margin-top:56px">
     <div class="row"><div><div class="rt">Dynasty Dragons</div><div class="rs">Sleeper · 7–4 · 2nd</div></div><span class="tag red">Empty slot</span></div>
     <div class="row"><div><div class="rt">Gridiron Gang</div><div class="rs">ESPN · 6–5 · 5th</div></div><span class="tag amb">Injured starter</span></div>
     <div class="row"><div><div class="rt">Waiver Warriors</div><div class="rs">Fantrax · 8–3 · 1st</div></div><span class="tag blu">Waivers tonight</span></div>
     <div class="row"><div><div class="rt">Office Bragging Rights</div><div class="rs">MFL · 5–6 · 7th</div></div><span class="tag grn">All set</span></div>
   </div>
   <div class="ex" style="margin-top:22px">Example board</div>`,

  () => `<div class="eyebrow">02 · Player finder</div>
   <h1 class="l" style="margin-top:28px">One player.<br/><span class="cy">Every league.</span></h1>
   <div class="card" style="margin-top:56px;padding:34px">
     <div style="display:flex;align-items:center;gap:18px;background:rgba(0,0,0,.3);border-radius:20px;padding:22px 26px;font-size:30px;color:#C6D6EA">
       <span style="font-size:32px">🔎</span> Your RB1<span style="margin-left:auto" class="tag red">OUT</span></div>
     <div style="margin-top:20px">
       <div class="row" style="padding:22px 6px"><div><div class="rt">Dynasty Dragons</div><div class="rs">Starting RB → swap in your bench RB</div></div></div>
       <div class="row" style="padding:22px 6px"><div><div class="rt">Gridiron Gang</div><div class="rs">Flex → swap in your bench RB</div></div></div>
       <div class="row" style="padding:22px 6px"><div><div class="rt">Waiver Warriors</div><div class="rs">Bench → no move needed</div></div></div>
     </div></div>
   <div class="ex" style="margin-top:22px">Example search</div>`,

  () => `<div class="eyebrow">03 · Priorities</div>
   <h1 class="l" style="margin-top:28px">Know what<br/><span class="cy">needs you.</span></h1>
   <p class="lead" style="margin-top:30px">Most urgent first, tagged with the league and the deadline.</p>
   <div class="card" style="margin-top:44px">
     <div class="row"><div><div class="rt">⛔ Unset lineup</div><div class="rs">Dynasty Dragons</div></div><span class="tag red">Sun 1:00 PM</span></div>
     <div class="row"><div><div class="rt">⏱ Waivers run</div><div class="rs">Waiver Warriors</div></div><span class="tag amb">Wed 3:00 AM</span></div>
     <div class="row"><div><div class="rt">🤝 Trade offer</div><div class="rs">Gridiron Gang</div></div><span class="tag blu">Expires 14h</span></div>
   </div>
   <div class="ex" style="margin-top:22px">Example alerts</div>`,

  () => `<div class="eyebrow">Connects to</div>
   <h1 class="l" style="margin-top:28px">Bring the leagues<br/><span class="cy">you already play.</span></h1>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:56px">
     ${['Sleeper', 'ESPN', 'Fantrax', 'MyFantasyLeague', 'Fleaflicker'].map((p) => `<div class="card" style="padding:34px 36px;font-size:40px;font-weight:800">${p}</div>`).join('')}
     <div class="card" style="padding:34px 36px;font-size:40px;font-weight:800;color:#6c84a3;border-style:dashed">Yahoo <span style="font-size:22px;letter-spacing:.12em">SOON</span></div>
   </div>
   <p class="lead" style="margin-top:44px;font-size:32px">✓ Sleeper needs only your username<br/>✓ Read-only: we never change your league</p>`,

  () => `<div style="margin:auto 0;text-align:left">
   <img src="${A('af-crest.svg')}" style="height:170px"/>
   <h1 class="xl" style="margin-top:46px">Every league<br/><span class="cy">is free.</span></h1>
   <p class="lead" style="margin-top:36px">Create, import and run as many leagues as you want. Drafts, trades, waivers and live scoring included.</p>
   <div class="btn" style="margin-top:56px">Start free at allfantasy.ai →</div></div>`,
]

/* ---------------- Carousel 2: Chimmy ---------------- */
const bubble = (who, txt) => who === 'q'
  ? `<div style="align-self:flex-end;max-width:760px;background:#3BC4FF;color:#03122b;font-weight:700;font-size:34px;line-height:1.3;padding:28px 34px;border-radius:34px 34px 8px 34px">${txt}</div>`
  : `<div style="display:flex;gap:18px;align-items:flex-end"><div style="flex:none;width:76px;height:76px;border-radius:50%;background:#0b2350;border:2px solid #3BC4FF;display:grid;place-items:center"><img src="${A('af-crest.svg')}" style="height:46px"/></div>
     <div class="card" style="max-width:780px;font-size:31px;line-height:1.42;padding:28px 34px;border-radius:34px 34px 34px 8px;color:#DCE8F7;font-weight:500">${txt}</div></div>`

const c2 = [
  () => `<div class="eyebrow">Meet Chimmy</div>
   <div style="margin-top:auto"><h1 class="xl">One question.<br/><span class="cy">Every league.</span></h1>
   <p class="lead" style="margin-top:44px">The AI assistant that answers about <b style="color:#fff">your</b> teams, not fantasy advice in general.</p></div>`,

  () => `<div class="eyebrow">Ask it like a friend</div>
   <div style="display:flex;flex-direction:column;gap:34px;margin-top:70px">
    ${bubble('q', 'Who’s hurt across all my leagues?')}
    ${bubble('a', '<b style="color:#fff">Two starters need you.</b> Your RB1 is <span style="color:#FF7A87;font-weight:800">Out</span> in Dynasty Dragons and Gridiron Gang. Your bench RB is the swap in both.<br/><br/>Your WR in Waiver Warriors is <span style="color:#FFC94D;font-weight:800">Questionable</span> and his game hasn’t started, so you can still wait on him.')}
   </div><div class="ex" style="margin-top:30px">Example conversation</div>`,

  () => `<div class="eyebrow">Why it's different</div>
   <h1 class="l" style="margin-top:28px">It reads<br/><span class="cy">your rosters.</span></h1>
   <p class="lead" style="margin-top:34px">Chimmy works from the leagues you connect, so every answer is about your teams.</p>
   <div style="display:flex;flex-direction:column;gap:20px;margin-top:50px">
    ${['“Who should I start at flex this week?”', '“Is this trade fair for me?”', '“Who’s worth a waiver claim before Wednesday?”'].map((t) => `<div class="card" style="padding:28px 34px;font-size:34px;font-weight:600">${t}</div>`).join('')}
   </div>`,

  () => `<div style="margin:auto 0">
   <div class="eyebrow">Try it free</div>
   <h1 style="font-family:Anton;font-size:420px;line-height:.85;color:#3BC4FF;margin-top:20px">2</h1>
   <h1 class="m">free Chimmy<br/>questions a day.</h1>
   <p class="lead" style="margin-top:36px">Every account gets them. No card needed.</p></div>`,

  () => `<div style="margin:auto 0">
   <img src="${A('af-crest.svg')}" style="height:170px"/>
   <h1 class="xl" style="margin-top:46px">Ask Chimmy<br/><span class="cy">tonight.</span></h1>
   <p class="lead" style="margin-top:36px">Connect a league in about a minute. Sleeper takes just your username.</p>
   <div class="btn" style="margin-top:56px">allfantasy.ai →</div></div>`,
]

/* ---------------- Carousel 3: league formats ---------------- */
const fmt = (file, name, line, how) => (i, n) =>
  page(`<div style="margin-top:auto">
    <div class="eyebrow">League format · ${String(i).padStart(2, '0')}</div>
    <h1 class="xl" style="margin-top:20px">${name}</h1>
    <p class="lead" style="margin-top:22px;color:#fff;font-weight:700;font-size:40px">${line}</p>
    <p class="lead" style="margin-top:16px;font-size:32px">${how}</p></div>`, i, n, art(file))

const c3 = [
  (i, n) => page(`<div class="eyebrow">Save this for your league chat</div>
    <div style="margin-top:auto"><h1 class="xl">Your league<br/>is <span class="cy">boring.</span></h1>
    <p class="lead" style="margin-top:40px">5 fantasy formats that make every single week matter.</p></div>`, i, n,
    `<div style="position:absolute;right:-120px;top:40px;width:640px;height:960px;background:url('${A('league-type-guillotine.png')}') center/cover;opacity:.45;border-radius:40px;transform:rotate(8deg);mask-image:linear-gradient(90deg,transparent,#000 40%)"></div>`),
  fmt('league-type-guillotine.png', 'Guillotine', 'Lowest score each week gets chopped.', 'Their whole roster drops to waivers, so the FAAB war never stops. Last team standing wins.'),
  fmt('league-type-zombie.png', 'Zombie', 'Lose and you don’t leave. You turn.', 'Infected teams spread the virus. Weapons, serums and a Whisperer decide who survives.'),
  fmt('league-type-survivor.png', 'Survivor', 'Outscore. Outplay. Outlast.', 'Tribes, private votes, idols, Exile, the merge and a jury. Blindsides are part of the game.'),
  fmt('league-type-big-brother.png', 'Big Brother', 'Somebody’s on the block every week.', 'Head of Household, nominations, veto and eviction votes, on top of real fantasy scoring.'),
  fmt('league-type-devy.png', 'Devy', 'Draft the future. Dynasty starts in college.', 'Hold the rights to NCAA prospects and carry them all the way to the NFL.'),
  (i, n) => page(`<div style="margin:auto 0">
    <img src="${A('af-crest.svg')}" style="height:170px"/>
    <h1 class="l" style="margin-top:46px">Which one is<br/><span class="cy">your league playing?</span></h1>
    <p class="lead" style="margin-top:36px">Tag the commissioner who needs to see this 👇<br/>Start any format free at allfantasy.ai</p>
    <div class="btn" style="margin-top:56px">Create a league free →</div></div>`, i, n),
]

const sets = {
  '1-one-board': c1.map((f, i) => (n) => page(f(), i, n)),
  '2-meet-chimmy': c2.map((f, i) => (n) => page(f(), i, n)),
  '3-league-formats': c3.map((f, i) => (n) => f(i, n)),
}

const browser = await chromium.launch()
const pg = await browser.newPage({ viewport: { width: 1080, height: 1350 } })
for (const [name, slides] of Object.entries(sets)) {
  mkdirSync(path.join(DIR, 'out', name), { recursive: true })
  for (let i = 0; i < slides.length; i++) {
    const file = path.join(DIR, 'out', name, `_${i}.html`)
    writeFileSync(file, slides[i](slides.length))
    await pg.goto(pathToFileURL(file).href, { waitUntil: 'networkidle' })
    await pg.evaluate(() => document.fonts.ready)
    await pg.screenshot({ path: path.join(DIR, 'out', name, `slide-${i + 1}.png`) })
  }
  console.log(name, slides.length)
}
await browser.close()
