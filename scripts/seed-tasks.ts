import { writeFileSync } from 'node:fs'
import { env } from '../src/env.js'
import { ClickUpClient } from '../src/clickup/client.js'
import { loadClientConfig } from '../src/clients/config.js'

const clickUp = new ClickUpClient({ apiToken: env.CLICKUP_API_TOKEN, teamId: env.CLICKUP_WORKSPACE_ID })
const client = loadClientConfig('clients/storeloop-demo.yaml')

const theme = await clickUp.createTask(
  client.clickupListId,
  'Holiday announcement bar',
  "Complimentary gift wrapping through Dec 24 with a countdown to Dec 1. Match brand type.",
  ['theme'],
)

const admin = await clickUp.createTask(
  client.clickupListId,
  'Tag holiday gifts and create collection',
  "Tag every product under $100 'Holiday Gift' and create a 'Holiday Gifts' collection from that tag.",
  ['admin'],
)

writeFileSync('data/demo-tasks.json', JSON.stringify({ themeTaskId: theme.id, adminTaskId: admin.id }, null, 2))

console.log('Seeded demo tasks:')
console.log(`  theme: ${theme.id}`)
console.log(`  admin: ${admin.id}`)
console.log('Move either to "agent queue" in ClickUp to kick off a run.')
