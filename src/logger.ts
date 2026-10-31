import pino from 'pino'
import { mkdirSync } from 'node:fs'
import { env } from './env.js'

mkdirSync('logs', { recursive: true })

export const logger = pino(
  { level: env.NODE_ENV === 'test' ? 'silent' : 'info' },
  pino.destination({ dest: 'logs/storeloop.log', mkdir: true, sync: false }),
)
