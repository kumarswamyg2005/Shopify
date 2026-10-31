import { existsSync, readFileSync } from 'node:fs'
import { env } from '../src/env.js'
import { ClickUpClient } from '../src/clickup/client.js'
import { ShopifyAdminClient } from '../src/shopify/admin.js'
import { listThemes, deleteUnpublishedTheme } from '../src/shopify/theme.js'
import { loadClientConfig } from '../src/clients/config.js'

const client = loadClientConfig('clients/storeloop-demo.yaml')
const cliConfig = { store: client.shopifyStore, themeToken: env.SHOPIFY_CLI_THEME_TOKEN }
const clickUp = new ClickUpClient({ apiToken: env.CLICKUP_API_TOKEN, teamId: env.CLICKUP_WORKSPACE_ID })
const admin = new ShopifyAdminClient({ store: client.shopifyStore, apiVersion: env.SHOPIFY_API_VERSION, adminApiToken: env.SHOPIFY_ADMIN_API_TOKEN })

console.log('Deleting SL-* unpublished themes...')
const themes = await listThemes(cliConfig)
for (const theme of themes.filter((t) => t.name.startsWith('SL-'))) {
  await deleteUnpublishedTheme(cliConfig, theme.id)
  console.log(`  deleted ${theme.name} (${theme.id})`)
}

console.log('Removing the "Holiday Gift" tag and "Holiday Gifts" collection...')
const tagged = await admin.listProducts('tag:"Holiday Gift"', 250)
for (const product of tagged) {
  await admin.tagsRemove(product.id, ['Holiday Gift'])
  console.log(`  untagged ${product.title}`)
}
const collection = await admin.findCollectionByTitle('Holiday Gifts')
if (collection) {
  await admin.collectionDelete(collection.id)
  console.log('  deleted collection "Holiday Gifts"')
}

if (existsSync('data/demo-tasks.json')) {
  console.log('Resetting demo ClickUp tasks to "agent queue"...')
  const { themeTaskId, adminTaskId } = JSON.parse(readFileSync('data/demo-tasks.json', 'utf8')) as {
    themeTaskId: string
    adminTaskId: string
  }
  for (const taskId of [themeTaskId, adminTaskId]) {
    await clickUp.setStatus(taskId, 'agent queue')
    console.log(`  reset task ${taskId}`)
  }
} else {
  console.log('No data/demo-tasks.json found — run `npm run seed-tasks` first if you need demo tasks reset.')
}

console.log('Done.')
