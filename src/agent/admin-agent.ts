import { query, tool, createSdkMcpServer, type CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { z } from 'zod'
import { ALLOWED_ADMIN_MUTATIONS } from '../policy.js'
import type { ShopifyAdminClient } from '../shopify/admin.js'

export const adminPlanMutationSchema = z.object({
  op: z.enum(ALLOWED_ADMIN_MUTATIONS),
  target: z.string(),
  input: z.record(z.unknown()),
})

export const adminAgentResultSchema = z.object({
  mutations: z.array(adminPlanMutationSchema),
  affectedCount: z.number(),
  sample: z.array(z.string()),
  risks: z.array(z.string()),
})

export type AdminAgentResult = z.infer<typeof adminAgentResultSchema>

const adminAgentOutputJsonSchema = {
  type: 'object',
  properties: {
    mutations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: [...ALLOWED_ADMIN_MUTATIONS] },
          target: { type: 'string' },
          input: { type: 'object' },
        },
        required: ['op', 'target', 'input'],
      },
    },
    affectedCount: { type: 'number' },
    sample: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['mutations', 'affectedCount', 'sample', 'risks'],
  additionalProperties: false,
}

const MCP_SERVER_NAME = 'storeloop-admin-read'

function makeReadOnlyTools(adminClient: ShopifyAdminClient) {
  return [
    tool('listProducts', 'List products matching a Shopify search query (e.g. "tag:Holiday")', {
      query: z.string(),
      limit: z.number().optional(),
    }, async ({ query: q, limit }) => {
      const products = await adminClient.listProducts(q, limit ?? 50)
      return { content: [{ type: 'text', text: JSON.stringify(products) }] }
    }),
    tool('getCollections', 'List existing collections', { limit: z.number().optional() }, async ({ limit }) => {
      const collections = await adminClient.getCollections(limit ?? 50)
      return { content: [{ type: 'text', text: JSON.stringify(collections) }] }
    }),
    tool('getRedirects', 'List existing URL redirects', { limit: z.number().optional() }, async ({ limit }) => {
      const redirects = await adminClient.getRedirects(limit ?? 50)
      return { content: [{ type: 'text', text: JSON.stringify(redirects) }] }
    }),
  ]
}

/**
 * The admin agent has no Bash tool and no write access outside runs/<taskId>/ (invariant 8):
 * only the read-only MCP tools and a Write scoped to that one directory are allowed.
 */
export function makeAdminCanUseTool(runsDir: string): CanUseTool {
  return async (toolName, input) => {
    if (toolName.startsWith(`mcp__${MCP_SERVER_NAME}__`)) {
      return { behavior: 'allow', updatedInput: input }
    }
    if (toolName === 'Write') {
      const filePath = typeof input.file_path === 'string' ? input.file_path : ''
      const root = resolve(runsDir)
      const candidate = isAbsolute(filePath) ? filePath : resolve(root, filePath)
      if (relative(root, candidate).startsWith('..')) {
        return { behavior: 'deny', message: `Writes are only allowed under ${runsDir}` }
      }
      return { behavior: 'allow', updatedInput: input }
    }
    return { behavior: 'deny', message: `Tool ${toolName} is not available to the admin agent.` }
  }
}

export interface RunAdminAgentInput {
  taskTitle: string
  taskDescription: string
  priorComments: string[]
  runsDir: string
  model: string
  adminClient: ShopifyAdminClient
}

function buildPrompt(input: RunAdminAgentInput): string {
  const comments =
    input.priorComments.length > 0
      ? input.priorComments.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : '(none — this is the first round)'
  return [`Task: ${input.taskTitle}`, '', input.taskDescription || '(no description)', '', 'Prior ClickUp comments:', comments].join(
    '\n',
  )
}

/** Runs the admin agent to completion and returns its validated plan (never executed by the agent). */
export async function runAdminAgent(input: RunAdminAgentInput): Promise<AdminAgentResult> {
  const systemPrompt = readFileSync('prompts/admin-agent.md', 'utf8')
  const readOnlyServer = createSdkMcpServer({ name: MCP_SERVER_NAME, tools: makeReadOnlyTools(input.adminClient) })

  const stream = query({
    prompt: buildPrompt(input),
    options: {
      cwd: input.runsDir,
      model: input.model,
      systemPrompt,
      allowedTools: ['Write'],
      canUseTool: makeAdminCanUseTool(input.runsDir),
      permissionMode: 'default',
      mcpServers: { [MCP_SERVER_NAME]: readOnlyServer },
      outputFormat: { type: 'json_schema', schema: adminAgentOutputJsonSchema },
    },
  })

  for await (const message of stream) {
    if (message.type === 'result') {
      if (message.subtype !== 'success') {
        throw new Error(`admin agent run did not succeed: ${message.subtype}`)
      }
      return adminAgentResultSchema.parse(message.structured_output)
    }
  }
  throw new Error('admin agent stream ended without a result message')
}
