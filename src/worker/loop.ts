import { claimNextQueuedJob } from '../db.js'
import { processJob, type WorkerDeps } from './process-job.js'
import { logger } from '../logger.js'

const POLL_INTERVAL_MS = 3000

/** Single-worker polling loop (ADR-0001: one SQLite-backed queue, one process). */
export function startWorker(deps: WorkerDeps, themeToken: string): () => void {
  let stopped = false
  let running = false

  const tick = async () => {
    if (stopped || running) return
    running = true
    try {
      const job = claimNextQueuedJob(deps.db)
      if (job) {
        logger.info({ jobId: job.id, kind: job.kind, taskId: job.clickupTaskId }, 'processing job')
        await processJob(deps, job, themeToken)
      }
    } catch (err) {
      logger.error({ err: String(err) }, 'worker tick failed')
    } finally {
      running = false
    }
  }

  const interval = setInterval(tick, POLL_INTERVAL_MS)
  return () => {
    stopped = true
    clearInterval(interval)
  }
}
