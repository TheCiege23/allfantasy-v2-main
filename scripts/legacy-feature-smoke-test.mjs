#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';

const checks = [
  { name: 'Legacy mock draft page renders', method: 'GET', path: '/af-legacy', expected: [200] },
  {
    name: 'Mock draft simulate endpoint responds without server error',
    method: 'POST',
    path: '/api/mock-draft/simulate',
    body: { teamCount: 12, rounds: 4, format: 'dynasty' },
    expected: [200, 400, 401, 403],
  },
  {
    name: 'Mock draft predict-board endpoint responds without server error',
    method: 'POST',
    path: '/api/mock-draft/predict-board',
    body: { picks: [], settings: { format: 'dynasty', teams: 12 } },
    expected: [200, 400, 401, 403],
  },
  {
    name: 'Legacy Chimmy AI endpoint responds without server error',
    method: 'POST',
    path: '/api/chat/chimmy',
    body: { message: 'Smoke test', privateMode: true, targetUsername: 'smoke-test' },
    expected: [200, 400, 401, 403],
  },
  {
    name: 'Waiver AI endpoint responds without server error',
    method: 'POST',
    path: '/api/waiver-ai/grok',
    body: { leagueId: 'smoke-test', roster: [], freeAgents: [] },
    expected: [200, 400, 401, 403],
  },
  {
    name: 'Bracket leagues endpoint responds without server error',
    method: 'GET',
    path: '/api/bracket/leagues',
    expected: [200, 400, 401, 403],
  },
  {
    name: 'Bracket pick-assist endpoint responds without server error',
    method: 'POST',
    path: '/api/bracket/ai/pick-assist',
    body: { tournamentId: 'smoke-test', matchup: { a: 'Team A', b: 'Team B' } },
    expected: [200, 400, 401, 403],
  },
  {
    name: 'Bracket join-league endpoint responds without server error',
    method: 'POST',
    path: '/api/bracket/leagues/join',
    body: { inviteCode: 'SMOKE' },
    expected: [200, 400, 401, 403],
  },
  {
    name: 'Bracket create-entry endpoint responds without server error',
    method: 'POST',
    path: '/api/bracket/entries',
    body: { leagueId: 'smoke-test', picks: {} },
    expected: [200, 400, 401, 403],
  },
];

async function runCheck(check) {
  const url = `${baseUrl}${check.path}`;
  const init = {
    method: check.method,
    headers: { 'content-type': 'application/json' },
  };

  if (check.body) {
    init.body = JSON.stringify(check.body);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timeout);
    const ok = check.expected.includes(response.status);
    const isServerError = response.status >= 500;

    return {
      ...check,
      status: response.status,
      ok: ok && !isServerError,
      serverError: isServerError,
    };
  } catch (error) {
    return {
      ...check,
      status: 'NETWORK_ERROR',
      ok: false,
      serverError: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

console.log(`Running legacy smoke checks against ${baseUrl}\n`);

const results = [];
for (const check of checks) {
  const result = await runCheck(check);
  results.push(result);

  const icon = result.ok ? '✅' : result.serverError ? '❌' : '⚠️';
  const extra = result.error ? ` (${result.error})` : '';
  console.log(`${icon} ${result.name}: ${result.status}${extra}`);
}

const failures = results.filter((result) => result.serverError || !result.ok);
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) need attention.`);
  process.exit(1);
}

console.log('\nAll smoke checks passed.');
