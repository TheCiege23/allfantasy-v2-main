#!/usr/bin/env node
/**
 * Route-budget report - how close the production build is to Vercel's 2048-route
 * ceiling, and which shipped routes nothing in this repo calls.
 *
 * Reads routeDirsToDisable / filesToKeep straight out of vercel-next-build.cjs,
 * so it reflects what that script actually ships rather than what is on disk.
 *
 * NOTE the counts here are a static approximation. The authoritative route count
 * lives on the Vercel deployment object; Next can emit more routes than there are
 * route.ts files.
 *
 * The "uncalled" list is a REVIEW QUEUE, not a delete list. A route is an HTTP
 * entry point: no reference in this repo does not mean no caller. Mobile clients,
 * the browser extension, webhooks, cron and bookmarks are all invisible here.
 * Confirm against production request logs before removing anything.
 *
 *   node scripts/route-budget-report.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const src = fs.readFileSync(path.join(ROOT, 'scripts/vercel-next-build.cjs'), 'utf8');

// Pull the two config literals out of the build script and evaluate them in isolation.
const grab = (name, open, close) => {
  const i = src.indexOf(name);
  const s = src.indexOf(open, i);
  let depth = 0, j = s;
  for (; j < src.length; j++) {
    if (src[j] === open) depth++;
    else if (src[j] === close) { depth--; if (!depth) break; }
  }
  return src.slice(s, j + 1);
};

const norm = (p) => p.split(String.fromCharCode(92)).join('/');
const fakePath = { join: (...a) => a.join('/') };
const evalWith = (code) => new Function('path', `return ${code}`)(fakePath);

const disableDirs = evalWith(grab('const routeDirsToDisable', '[', ']')).map(norm);
const keepRaw = grab('const filesToKeep', '[', ']');
const keeps = new Set(
  evalWith(keepRaw)
    .map((p) => norm(String(p)).replace(/\.replace\(.*$/, ''))
);

const tracked = execFileSync('git', ['ls-files', '-z'], { maxBuffer: 1 << 30 })
  .toString().split('\0').filter(Boolean).map(norm);

const routes = tracked.filter((f) => /^app\/.*\/route\.(ts|tsx|js)$/.test(f));
const pages = tracked.filter((f) => /^app\/.*\/page\.tsx$/.test(f));

const isDisabled = (f) => disableDirs.some((d) => f === d || f.startsWith(d + '/'));
const shipped = (f) => !isDisabled(f) || keeps.has(f);

const shippedRoutes = routes.filter(shipped);
const shippedPages = pages.filter(shipped);
const disabledRoutes = routes.filter((f) => !shipped(f));

console.log(`route.ts on disk        ${routes.length}`);
console.log(`page.tsx on disk        ${pages.length}`);
console.log(`disable-list dirs       ${disableDirs.length}`);
console.log(`explicit keeps          ${keeps.size}`);
console.log('');
console.log(`SHIPPED routes          ${shippedRoutes.length}`);
console.log(`SHIPPED pages           ${shippedPages.length}`);
console.log(`SHIPPED total           ${shippedRoutes.length + shippedPages.length}  (ceiling 2048)`);
console.log(`already excluded        ${disabledRoutes.length} routes cost no budget`);

// ---- which shipped routes does nothing in the repo call?
const corpus = tracked.filter((f) =>
  /\.(ts|tsx|js|jsx|mjs|cjs|json|yml|yaml)$/.test(f) &&
  !/^(\.next|node_modules|docs|artifacts)/.test(f)
);
let BIG = '';
for (const f of corpus) {
  try { BIG += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n'; } catch { }
}

const urlOf = (rt) => norm(rt).slice('app'.length).replace(/\/route\.(ts|tsx|js)$/, '').replace(/\/\([^)]*\)/g, '');
const EXTERNAL = /webhook|stripe|\/cron\/|callback|oauth|nextauth|health|inbound|resend|sentry|revalidate/i;

const uncalled = [], externalish = [];
for (const rt of shippedRoutes) {
  const u = urlOf(rt);
  const prefix = u.split('/[')[0];
  if (prefix.length < 8) continue;
  const hits = BIG.split(prefix).length - 1;
  if (hits > 1) continue;
  (EXTERNAL.test(u) ? externalish : uncalled).push(rt);
}

console.log('');
console.log(`SHIPPED + uncalled anywhere in repo   ${uncalled.length}   <- budget reclaimable`);
console.log(`  ...of which look externally called  ${externalish.length}   <- excluded, never delete blind`);
fs.writeFileSync('route-candidates.txt', uncalled.join('\n'));
fs.writeFileSync('route-external.txt', externalish.join('\n'));
