import { startSimulationWorker, stopSimulationWorker } from "../lib/workers/simulation-worker"
import { startNotificationWorker, stopNotificationWorker } from "../lib/workers/notification-worker"
import { startAiWorker, stopAiWorker } from "../lib/workers/ai-worker"
import { startDevyWorker, stopDevyWorker } from "../lib/workers/devy-worker"
import { startIntegrityWorker, stopIntegrityWorker } from "../lib/workers/integrity-worker"
import { startAutoCoachStatusWorker, stopAutoCoachStatusWorker } from "../lib/workers/autocoach-status-worker"
import { startLeagueEngineWorker, stopLeagueEngineWorker } from "../lib/workers/league-engine-worker"

console.log(
  "[Worker] Starting background job workers (simulations, notifications, ai, devy, integrity, autocoach-status, league-engine)...",
)

startSimulationWorker()
startNotificationWorker()
startAiWorker()
startDevyWorker()
startIntegrityWorker()
startAutoCoachStatusWorker()
startLeagueEngineWorker()

async function shutdown() {
  console.log("[Worker] Shutting down...")
  await Promise.all([
    stopSimulationWorker(),
    stopNotificationWorker(),
    stopAiWorker(),
    stopDevyWorker(),
    stopIntegrityWorker(),
    stopAutoCoachStatusWorker(),
    stopLeagueEngineWorker(),
  ])
  process.exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
