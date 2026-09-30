const BACKGROUND_SYNC_BASE_URL =
  process.env.BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_URL ||
  "http://localhost:3000";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

interface SyncTask {
  name: string;
  url: string;
  method: 'GET' | 'POST';
  intervalMs: number;
  body?: Record<string, string>;
  requiresAuth: boolean;
  lastRun: number;
  running: boolean;
  phase: 'fast' | 'medium' | 'heavy';
  priority: number;
  consecutiveFailures: number;
  lastError: string | null;
}

const syncTasks: SyncTask[] = [
  {
    name: 'Live Scores',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/sports/live-scores?refresh=true`,
    method: 'GET',
    intervalMs: 2 * 60 * 1000,
    requiresAuth: false,
    lastRun: 0,
    running: false,
    phase: 'fast',
    priority: 1,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'News',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/sports/news?refresh=true`,
    method: 'GET',
    intervalMs: 30 * 60 * 1000,
    requiresAuth: false,
    lastRun: 0,
    running: false,
    phase: 'fast',
    priority: 2,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'Injuries',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/sports/injuries?refresh=true`,
    method: 'GET',
    intervalMs: 6 * 60 * 60 * 1000,
    requiresAuth: false,
    lastRun: 0,
    running: false,
    phase: 'fast',
    priority: 3,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'ClearSports Games Sync',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/admin/clearsports/import`,
    method: 'POST',
    intervalMs: 5 * 60 * 1000,
    body: { syncType: 'games' },
    requiresAuth: true,
    lastRun: 0,
    running: false,
    phase: 'fast',
    priority: 3,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'ClearSports Injuries Sync',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/admin/clearsports/import`,
    method: 'POST',
    intervalMs: 5 * 60 * 1000,
    body: { syncType: 'injuries' },
    requiresAuth: true,
    lastRun: 0,
    running: false,
    phase: 'fast',
    priority: 4,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'ClearSports News Sync',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/admin/clearsports/import`,
    method: 'POST',
    intervalMs: 5 * 60 * 1000,
    body: { syncType: 'news' },
    requiresAuth: true,
    lastRun: 0,
    running: false,
    phase: 'fast',
    priority: 5,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'Trending Players Sync',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/sports/trending?refresh=true`,
    method: 'GET',
    intervalMs: 2 * 60 * 60 * 1000,
    requiresAuth: false,
    lastRun: 0,
    running: false,
    phase: 'medium',
    priority: 4,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'Depth Charts Sync',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/sports/depth-charts?refresh=true`,
    method: 'GET',
    intervalMs: 12 * 60 * 60 * 1000,
    requiresAuth: false,
    lastRun: 0,
    running: false,
    phase: 'medium',
    priority: 5,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'Team Stats Sync',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/sports/team-stats?refresh=true`,
    method: 'GET',
    intervalMs: 24 * 60 * 60 * 1000,
    requiresAuth: false,
    lastRun: 0,
    running: false,
    phase: 'medium',
    priority: 6,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'ESPN Rosters Sync',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/sports/espn-rosters`,
    method: 'GET',
    intervalMs: 24 * 60 * 60 * 1000,
    requiresAuth: false,
    lastRun: 0,
    running: false,
    phase: 'medium',
    priority: 7,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'ClearSports Teams Sync',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/admin/clearsports/import`,
    method: 'POST',
    intervalMs: 6 * 60 * 60 * 1000,
    body: { syncType: 'teams' },
    requiresAuth: true,
    lastRun: 0,
    running: false,
    phase: 'medium',
    priority: 8,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'ClearSports Players Sync',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/admin/clearsports/import`,
    method: 'POST',
    intervalMs: 6 * 60 * 60 * 1000,
    body: { syncType: 'players' },
    requiresAuth: true,
    lastRun: 0,
    running: false,
    phase: 'medium',
    priority: 9,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'ClearSports Stats Sync',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/admin/clearsports/import`,
    method: 'POST',
    intervalMs: 60 * 60 * 1000,
    body: { syncType: 'stats' },
    requiresAuth: true,
    lastRun: 0,
    running: false,
    phase: 'medium',
    priority: 10,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'ClearSports Odds Sync',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/admin/clearsports/import`,
    method: 'POST',
    intervalMs: 30 * 60 * 1000,
    body: { syncType: 'odds' },
    requiresAuth: true,
    lastRun: 0,
    running: false,
    phase: 'medium',
    priority: 11,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'Full Data Sync (Teams + Schedule)',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/sports/sync`,
    method: 'POST',
    intervalMs: 24 * 60 * 60 * 1000,
    body: { type: 'all', source: 'all' },
    requiresAuth: true,
    lastRun: 0,
    running: false,
    phase: 'heavy',
    priority: 12,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'ClearSports Full Import',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/admin/clearsports/import`,
    method: 'POST',
    intervalMs: 24 * 60 * 60 * 1000,
    body: { syncType: 'all' },
    requiresAuth: true,
    lastRun: 0,
    running: false,
    phase: 'heavy',
    priority: 13,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'NCAA Bracket Auto-Import',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/bracket/workers/auto-import`,
    method: 'POST',
    intervalMs: 30 * 60 * 1000,
    body: {},
    // The worker route is now gated (requireCronAuth accepts ADMIN_PASSWORD).
    requiresAuth: true,
    lastRun: 0,
    running: false,
    phase: 'fast',
    priority: 2,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'Devy Player Sync',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/admin/devy-sync`,
    method: 'POST',
    intervalMs: 24 * 60 * 60 * 1000,
    body: {},
    requiresAuth: true,
    lastRun: 0,
    running: false,
    phase: 'heavy',
    priority: 14,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'Weekly Auto-Recalibration',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/admin/recalibration`,
    method: 'POST',
    intervalMs: 7 * 24 * 60 * 60 * 1000,
    body: { season: '2025' },
    requiresAuth: true,
    lastRun: 0,
    running: false,
    phase: 'heavy',
    priority: 15,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'Weekly Weight Re-Learning',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/admin/weekly-weights`,
    method: 'POST',
    intervalMs: 7 * 24 * 60 * 60 * 1000,
    body: {},
    requiresAuth: true,
    lastRun: 0,
    running: false,
    phase: 'heavy',
    priority: 16,
    consecutiveFailures: 0,
    lastError: null,
  },
  {
    name: 'Weekly Backtest + Param Learning',
    url: `${BACKGROUND_SYNC_BASE_URL}/api/admin/weekly-backtest`,
    method: 'POST',
    intervalMs: 7 * 24 * 60 * 60 * 1000,
    body: { season: '2025' },
    requiresAuth: true,
    lastRun: 0,
    running: false,
    phase: 'heavy',
    priority: 17,
    consecutiveFailures: 0,
    lastError: null,
  },
];

const MAX_BACKOFF_MULTIPLIER = 8;

function getEffectiveInterval(task: SyncTask): number {
  if (task.consecutiveFailures === 0) return task.intervalMs;
  const multiplier = Math.min(MAX_BACKOFF_MULTIPLIER, Math.pow(2, task.consecutiveFailures - 1));
  return task.intervalMs * multiplier;
}

async function runTask(task: SyncTask): Promise<boolean> {
  if (task.running) {
    console.log(`[Sync] ${task.name}: SKIPPED (still running)`);
    return false;
  }
  task.running = true;
  task.lastRun = Date.now();
  const startTime = Date.now();
  try {
    const headers: Record<string, string> = {};
    if (task.requiresAuth && ADMIN_PASSWORD) {
      headers['Authorization'] = `Bearer ${ADMIN_PASSWORD}`;
    }

    const options: RequestInit = {
      method: task.method,
      headers,
    };

    if (task.method === 'POST' && task.body) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(task.body);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    options.signal = controller.signal;

    const response = await fetch(task.url, options);
    clearTimeout(timeout);
    const duration = Date.now() - startTime;

    if (response.ok) {
      const data = await response.json();
      const count = data.results ? JSON.stringify(data.results) : (data.count != null ? String(data.count) : 'ok');
      console.log(`[Sync] ${task.name}: SUCCESS (${duration}ms) - ${count}`);
      task.consecutiveFailures = 0;
      task.lastError = null;
      return true;
    } else {
      task.consecutiveFailures++;
      task.lastError = `HTTP ${response.status}`;
      console.error(`[Sync] ${task.name}: FAILED ${response.status} (${duration}ms) [failures: ${task.consecutiveFailures}]`);
      return false;
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    task.consecutiveFailures++;
    task.lastError = error instanceof Error ? error.message : String(error);
    console.error(`[Sync] ${task.name}: ERROR (${duration}ms) [failures: ${task.consecutiveFailures}] -`, task.lastError);
    return false;
  } finally {
    task.running = false;
  }
}

async function runTasksParallel(tasks: SyncTask[], concurrency: number): Promise<void> {
  const queue = [...tasks];
  const running: Promise<void>[] = [];

  while (queue.length > 0 || running.length > 0) {
    while (running.length < concurrency && queue.length > 0) {
      const task = queue.shift()!;
      const promise = runTask(task).then(() => {
        const idx = running.indexOf(promise);
        if (idx >= 0) running.splice(idx, 1);
      });
      running.push(promise);
    }

    if (running.length > 0) {
      await Promise.race(running);
    }
  }
}

async function checkAndRunTasks(): Promise<void> {
  const now = Date.now();
  const dueTasks = syncTasks.filter(
    (task) => !task.running && now - task.lastRun >= getEffectiveInterval(task)
  );

  if (dueTasks.length === 0) return;

  dueTasks.sort((a, b) => a.priority - b.priority);

  const fastTasks = dueTasks.filter((t) => t.phase === 'fast');
  const mediumTasks = dueTasks.filter((t) => t.phase === 'medium');
  const heavyTasks = dueTasks.filter((t) => t.phase === 'heavy');

  if (fastTasks.length > 0) await runTasksParallel(fastTasks, 3);
  if (mediumTasks.length > 0) await runTasksParallel(mediumTasks, 2);
  if (heavyTasks.length > 0) await runTasksParallel(heavyTasks, 1);
}

function formatInterval(ms: number): string {
  if (ms >= 3600000) return `${ms / 3600000}h`;
  if (ms >= 60000) return `${ms / 60000}m`;
  return `${ms / 1000}s`;
}

async function main(): Promise<void> {
  console.log('[BackgroundSync] Starting background sync service...');
  console.log(`[BackgroundSync] Base URL: ${BACKGROUND_SYNC_BASE_URL}`);
  console.log('[BackgroundSync] Schedule:');
  for (const task of syncTasks) {
    console.log(`  - ${task.name}: every ${formatInterval(task.intervalMs)} [${task.phase}]`);
  }
  console.log('');

  console.log('[BackgroundSync] Waiting 15s for server to be ready...');
  await new Promise((resolve) => setTimeout(resolve, 15000));

  console.log('[BackgroundSync] Phase 1: Fast syncs (parallel)...');
  const fastTasks = syncTasks.filter((t) => t.phase === 'fast');
  await runTasksParallel(fastTasks, 3);

  console.log('[BackgroundSync] Phase 2: Medium syncs (2 at a time)...');
  const mediumTasks = syncTasks.filter((t) => t.phase === 'medium');
  await runTasksParallel(mediumTasks, 2);

  console.log('[BackgroundSync] Phase 3: Heavy syncs (sequential)...');
  const heavyTasks = syncTasks.filter((t) => t.phase === 'heavy');
  for (const task of heavyTasks) {
    await runTask(task);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log('[BackgroundSync] Initial sync complete. Starting scheduled loop...\n');

  const TICK_INTERVAL = 30 * 1000;
  setInterval(async () => {
    try {
      await checkAndRunTasks();
    } catch (error) {
      console.error('[BackgroundSync] Tick error:', error);
    }
  }, TICK_INTERVAL);
}

main().catch((error) => {
  console.error('[BackgroundSync] Fatal error — restarting in 30s:', error);
  setTimeout(() => {
    main().catch(() => process.exit(1));
  }, 30000);
});
