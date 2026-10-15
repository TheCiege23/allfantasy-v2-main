// Renders short vertical reels (1080x1920, 30fps, H.264 MP4, silent) for Instagram Reels, TikTok
// and YouTube Shorts. Silent on purpose: add trending audio in the app, which also helps reach.
// Usage: node marketing/social/render-reels.mjs [reel-name ...]   -> out/reels/<name>.mp4
//
// Each reel is a page of timed "beats". A beat is visible from `in` to `out` seconds. Frames are
// captured by pausing every CSS animation and seeking it, so the output is deterministic and
// does not depend on how fast the machine renders.
const { chromium } = await import('playwright').catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'))
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const DIR = path.dirname(new URL(import.meta.url).pathname)
const A = (p) => pathToFileURL(path.join(DIR, '..', '..', 'public', p)).href
const FPS = 30
const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const hl = (s = '') => esc(s).replace(/\[([^\]]+)\]/g, '<span class="ac">$1</span>').replace(/\n/g, '<br/>')

// Safe zone: TikTok/Reels overlay UI on the top ~220px, bottom ~420px and right ~140px.
const CSS = (ac) => `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800;900&display=block');
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1920px;overflow:hidden}
body{font-family:Inter,'Noto Color Emoji',sans-serif;color:#EAF4FF;background:#030817;position:relative;--ac:${ac}}
.bg{position:absolute;inset:0;background:radial-gradient(1000px 900px at 85% 0%, color-mix(in srgb,var(--ac) 40%,transparent), transparent 60%),radial-gradient(900px 900px at 0% 100%, rgba(1,41,103,.95), transparent 65%),linear-gradient(180deg,#041029,#030817)}
.grid{position:absolute;inset:0;opacity:.07;background-image:linear-gradient(#5cc8ff 1px,transparent 1px),linear-gradient(90deg,#5cc8ff 1px,transparent 1px);background-size:60px 60px}
.stage{position:absolute;left:84px;right:160px;top:260px;bottom:440px}
.beat{position:absolute;left:0;right:0;opacity:0;animation:bin .45s cubic-bezier(.2,.8,.2,1) var(--in) both, bout .3s ease-in var(--out) forwards}
@keyframes bin{from{opacity:0;transform:translateY(50px) scale(.98)}to{opacity:1;transform:none}}
@keyframes bout{from{opacity:1}to{opacity:0;transform:translateY(-30px)}}
.pop{animation-name:bpop,bout;animation-duration:.35s,.3s;animation-timing-function:cubic-bezier(.3,1.6,.5,1),ease-in}
@keyframes bpop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
h1{font-family:Anton,Impact,sans-serif;font-weight:400;text-transform:uppercase;line-height:.95;font-size:150px}
h2{font-family:Anton,Impact,sans-serif;font-weight:400;text-transform:uppercase;line-height:1;font-size:104px}
.ac{color:var(--ac)}
p{font-size:46px;line-height:1.3;color:#C6D6EA;font-weight:600}
.emoji{font-family:'Noto Color Emoji';font-size:220px;line-height:1}
.card{background:linear-gradient(180deg,rgba(18,40,78,.95),rgba(8,20,44,.95));border:2px solid color-mix(in srgb,var(--ac) 35%,transparent);border-radius:34px}
.row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:30px 34px;border-top:1px solid rgba(255,255,255,.07)}
.row:first-child{border-top:0}
.rt{font-size:38px;font-weight:800}.rs{font-size:28px;color:#8FA6C4;margin-top:6px;font-weight:500}
.tag{font-size:24px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;padding:10px 18px;border-radius:999px;opacity:0;animation:bpop .35s cubic-bezier(.3,1.6,.5,1) var(--in) both}
.red{background:rgba(255,77,94,.18);color:#FF7A87}.amb{background:rgba(255,184,0,.18);color:#FFC94D}.blu{background:rgba(59,196,255,.18);color:#6FD3FF}.grn{background:rgba(42,214,140,.18);color:#4BE3A2}
.ex{font-size:24px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#5f7898;margin-top:20px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:14px;min-width:300px;padding:26px 40px;border-radius:999px;font-weight:900;font-size:40px}
.end{display:flex;flex-direction:column;align-items:flex-start;gap:34px}
.end img{height:200px}
.url{font-weight:900;font-size:56px;color:var(--ac);letter-spacing:.02em}
.art{position:absolute;inset:0;background-size:cover;background-position:center 28%;animation:kb var(--dur) linear both}
@keyframes kb{from{transform:scale(1.04)}to{transform:scale(1.16)}}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(3,8,23,.2),rgba(3,8,23,.4) 26%,rgba(3,8,23,.93) 44%,#030817 60%)}
`
const beat = (inS, outS, html, cls = '', style = '') =>
  `<div class="beat ${cls}" style="--in:${inS}s;--out:${outS}s;${style}">${html}</div>`
const endCard = (inS, line, top = 300) => beat(inS, 99, `<div class="end"><img src="${A('af-crest.svg')}"/><h2>${hl(line)}</h2><div class="url">allfantasy.ai</div></div>`, '', `top:${top}px`)

const REELS = {
  'one-board': {
    accent: '#3BC4FF', seconds: 13, stage: 'top:430px',
    body: () => [
      beat(0.2, 3.2, '<h1>4 leagues.</h1>', 'pop', 'top:120px'),
      beat(0.9, 3.2, '<h1>4 apps.</h1>', 'pop', 'top:290px'),
      beat(1.6, 3.2, '<h1 class="ac">0 chill.</h1>', 'pop', 'top:460px'),
      beat(3.4, 5.6, '<h2>Sunday shouldn’t feel like a <span class="ac">part-time job.</span></h2>', '', 'top:260px'),
      beat(5.8, 10.6, `<h2 style="font-size:84px">Every league.<br/><span class="ac">One board.</span></h2>
        <div class="card" style="margin-top:44px">
          <div class="row"><div><div class="rt">Dynasty Dragons</div><div class="rs">Sleeper</div></div><span class="tag red" style="--in:6.6s">Empty slot</span></div>
          <div class="row"><div><div class="rt">Gridiron Gang</div><div class="rs">ESPN</div></div><span class="tag amb" style="--in:7.3s">Injured starter</span></div>
          <div class="row"><div><div class="rt">Waiver Warriors</div><div class="rs">Fantrax</div></div><span class="tag blu" style="--in:8.0s">Waivers tonight</span></div>
          <div class="row"><div><div class="rt">Office League</div><div class="rs">MFL</div></div><span class="tag grn" style="--in:8.7s">All set</span></div>
        </div><div class="ex">Example board</div>`, '', 'top:20px'),
      endCard(10.8, 'Every league\n[is free.]'),
    ].join(''),
    caption: {
      instagram: "4 leagues. 4 apps. 0 chill. 😮‍💨\n\nAllFantasy puts every league you play on one board: empty slots, injured starters and waiver runs, most urgent first. Sleeper, ESPN, Fantrax, MFL and Fleaflicker.\n\nFree. Link in bio.\n\n#fantasyfootball #fantasyfootballtips #sleeperfantasy #espnfantasy #allfantasy",
      tiktok: "4 leagues, 4 apps, 0 chill 😮‍💨 One board for every league. Free, link in bio.\n\n#fantasyfootball #fantasyfootballtok #nfl #allfantasy",
      youtube: "4 leagues. 4 apps. 0 chill. AllFantasy puts every league on one board, free at allfantasy.ai #fantasyfootball #shorts",
      facebook: "4 leagues. 4 apps. 0 chill. 😮‍💨 AllFantasy puts every league you play on one board, most urgent first. Free: https://allfantasy.ai",
    },
  },
  'free-agent-day': {
    accent: '#38E08F', seconds: 11, stage: 'top:430px',
    body: () => [
      beat(0.2, 2.6, '<h1>Free-agent<br/><span class="ac">day?</span></h1>', 'pop', 'top:220px'),
      beat(2.8, 7.6, `<div class="card" style="padding:40px">
          <div class="rs" style="font-size:30px">WAIVER WIRE · TODAY: FREE AGENTS</div>
          <div class="rt" style="font-size:52px;margin-top:22px">Your waiver pickup</div>
          <div class="rs">WR · available</div>
          <div style="position:relative;height:120px;margin-top:40px">
            <div class="beat btn" style="--in:3.2s;--out:4.9s;background:#33415c;color:#C6D6EA">Claim · runs overnight</div>
            <div class="beat btn pop" style="--in:5.1s;--out:99s;background:#38E08F;color:#03122b">✓ Added instantly</div>
          </div>
        </div><div class="ex">Example</div>`, '', 'top:160px'),
      beat(7.8, 9.4, '<h2>No claim.<br/><span class="ac">No overnight wait.</span></h2>', '', 'top:300px'),
      endCard(9.6, 'Live now on\n[AllFantasy.]'),
    ].join(''),
    caption: {
      instagram: "Free-agent day? Add him now. 🟢\n\nOn free-agent days the AllFantasy waiver wire lets you add players instantly, Sleeper-style. No claim, no overnight wait.\n\nLink in bio.\n\n#fantasyfootball #waiverwire #fantasyfootballtips #allfantasy",
      tiktok: "Free-agent day = instant adds now 🟢 No claim, no overnight wait.\n\n#fantasyfootball #waiverwire #fantasyfootballtok #allfantasy",
      youtube: "Free-agent day? Add him now. Instant adds on the AllFantasy waiver wire. allfantasy.ai #fantasyfootball #shorts",
      facebook: "Free-agent day? Add him now. 🟢 Instant adds on the AllFantasy waiver wire: no claim, no overnight wait. https://allfantasy.ai",
    },
  },
  'guillotine-10s': {
    accent: '#FF5A6E', seconds: 13, stage: 'top:900px',
    backdrop: () => `<div class="art" style="background-image:url('${A('league-type-guillotine.png')}');--dur:13s"></div><div class="shade"></div>`,
    body: () => [
      beat(0.2, 2.4, '<h2>Guillotine league<br/><span class="ac">in 10 seconds.</span></h2>', 'pop', 'top:60px'),
      beat(2.6, 4.6, '<h2>Every week, the lowest score…</h2>', '', 'top:80px'),
      beat(4.6, 6.4, '<div class="emoji">🪓</div><h1 class="ac">Chopped.</h1>', 'pop', 'top:0px'),
      beat(6.6, 8.6, '<h2>Their whole roster <span class="ac">hits waivers.</span></h2>', '', 'top:80px'),
      beat(8.8, 10.6, '<div class="emoji">👑</div><h2>Last team <span class="ac">standing</span> wins.</h2>', 'pop', 'top:0px'),
      endCard(10.8, 'Start one\n[free.]', -120),
    ].join(''),
    caption: {
      instagram: "Guillotine league in 10 seconds 🪓\n\nLowest score each week gets chopped. Their roster hits waivers. Last team standing wins.\n\nWould your league survive it? 👇 Start one free, link in bio.\n\n#fantasyfootball #guillotineleague #fantasyfootballleague #allfantasy",
      tiktok: "Guillotine league in 10 seconds 🪓 Would your league survive? 👇\n\n#fantasyfootball #guillotine #fantasyfootballtok #allfantasy",
      youtube: "Guillotine league in 10 seconds: lowest score gets chopped every week, last team standing wins. allfantasy.ai #fantasyfootball #shorts",
      facebook: "Guillotine league in 10 seconds 🪓 Lowest score each week gets chopped, their roster hits waivers, last team standing wins. Tag your commish 👇 https://allfantasy.ai",
    },
  },
}

const only = process.argv.slice(2)
const outRoot = path.join(DIR, 'out', 'reels')
mkdirSync(outRoot, { recursive: true })
const browser = await chromium.launch()
const pg = await browser.newPage({ viewport: { width: 1080, height: 1920 } })
let captions = '# AllFantasy reels\n\nSilent on purpose: add a trending sound in Instagram or TikTok before posting.\n\n'
for (const [name, reel] of Object.entries(REELS)) {
  if (only.length && !only.includes(name)) continue
  const work = path.join(outRoot, `_${name}`)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  writeFileSync(path.join(work, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><style>${CSS(reel.accent)}</style></head><body><div class="bg"></div>${reel.backdrop ? reel.backdrop() : '<div class="grid"></div>'}<div class="stage" style="${reel.stage || ''}">${reel.body()}</div></body></html>`)
  await pg.goto(pathToFileURL(path.join(work, 'index.html')).href, { waitUntil: 'networkidle' })
  await pg.evaluate(() => document.fonts.ready)
  await pg.evaluate(() => document.getAnimations().forEach((a) => a.pause()))
  const frames = Math.round(reel.seconds * FPS)
  for (let f = 0; f < frames; f++) {
    const ms = (f / FPS) * 1000
    await pg.evaluate((t) => document.getAnimations().forEach((a) => { a.currentTime = t }), ms)
    await pg.screenshot({ path: path.join(work, `f${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 })
  }
  const mp4 = path.join(outRoot, `${name}.mp4`)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(work, 'f%04d.jpg'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '18', '-movflags', '+faststart', mp4])
  rmSync(work, { recursive: true, force: true })
  captions += `## ${name} · ${reel.seconds}s\n\n` + Object.entries(reel.caption).map(([k, v]) => `**${k}**\n\n${v}\n`).join('\n') + '\n---\n\n'
  console.log('rendered', name, frames, 'frames ->', mp4)
}
writeFileSync(path.join(outRoot, 'CAPTIONS.md'), captions)
await browser.close()
