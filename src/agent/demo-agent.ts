import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RunThemeAgentInput, ThemeAgentResult } from './theme-agent.js'
import type { RunAdminAgentInput, AdminAgentResult } from './admin-agent.js'

/*
 * Rule-based stand-ins for the two Claude agents (STORELOOP_AGENT=demo, the default). They make
 * real edits and real Shopify reads — only the "thinking" is deterministic, so the whole loop
 * runs with zero LLM cost. They return the same result types as the Claude agents, so the
 * orchestrator, policy gates, and ClickUp comments are exercised identically.
 */

const HEADER_GROUP = 'sections/header-group.json'

function firstSentence(text: string, fallback: string): string {
  const sentence = text.split(/(?<=[.!?])\s/)[0]?.trim().replace(/\.$/, '')
  return sentence || fallback
}

export async function runDemoThemeAgent(input: RunThemeAgentInput): Promise<ThemeAgentResult> {
  const path = join(input.workspaceDir, HEADER_GROUP)
  let file = readFileSync(path, 'utf8')
  const assumptions: string[] = ['Demo agent: rule-based edit of the announcement bar, no LLM involved.']

  const text = firstSentence(input.taskDescription, input.taskTitle)
  file = file.replace(/"text": "[^"]*"/, () => `"text": ${JSON.stringify(text)}`)

  // Latest human comment drives a revision round.
  const revision = input.priorComments.at(-1)?.toLowerCase() ?? ''
  if (/upper ?case|caps/.test(revision)) file = file.replace(/"case": "[^"]*"/, '"case": "uppercase"')
  if (/bigger|larger/.test(revision)) file = file.replace(/"font_size": "[^"]*"/, '"font_size": "0.875rem"')
  if (/slower/.test(revision)) file = file.replace(/"speed": \d+/, '"speed": 3')
  if (/faster/.test(revision)) file = file.replace(/"speed": \d+/, '"speed": 8')
  if (revision) assumptions.push(`Applied revision: "${input.priorComments.at(-1)}"`)

  writeFileSync(path, file)
  return {
    summary: `Set the announcement bar to "${text}"${revision ? ' and applied the requested revision' : ''}.`,
    filesChanged: [HEADER_GROUP],
    assumptions,
    questionsForHuman: [],
  }
}

export async function runDemoAdminAgent(input: RunAdminAgentInput): Promise<AdminAgentResult> {
  const text = `${input.taskTitle}. ${input.taskDescription}`
  const maxPrice = Number(/under \$(\d+)/i.exec(text)?.[1] ?? 100)
  const quoted = [...input.taskDescription.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]!)
  const tag = quoted[0] ?? 'Holiday Gift'
  const collectionTitle = quoted[1] ?? `${tag}s`

  const products = await input.adminClient.listProductsUnderPrice(maxPrice)
  const existing = await input.adminClient.getCollections(250)
  const risks: string[] = []
  if (products.length === 0) risks.push(`No products priced under $${maxPrice} were found; the plan only creates the collection.`)
  if (existing.some((c) => c.title === collectionTitle)) risks.push(`A collection named "${collectionTitle}" already exists.`)

  return {
    mutations: [
      ...products.map((p) => ({ op: 'tagsAdd' as const, target: p.id, input: { tags: [tag] } })),
      { op: 'collectionCreate' as const, target: collectionTitle, input: { tag } },
    ],
    affectedCount: products.length,
    sample: products.slice(0, 5).map((p) => `${p.title} ($${p.price.toFixed(2)})`),
    risks,
  }
}
