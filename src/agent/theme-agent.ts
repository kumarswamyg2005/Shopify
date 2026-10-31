import { query, type CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { checkCommand } from '../policy.js'

export const themeAgentResultSchema = z.object({
  summary: z.string(),
  filesChanged: z.array(z.string()),
  assumptions: z.array(z.string()),
  questionsForHuman: z.array(z.string()),
})

export type ThemeAgentResult = z.infer<typeof themeAgentResultSchema>

const themeAgentOutputJsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    assumptions: { type: 'array', items: { type: 'string' } },
    questionsForHuman: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'filesChanged', 'assumptions', 'questionsForHuman'],
  additionalProperties: false,
}

const BASE_ALLOWED_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash']
const DEV_MCP_SERVER_NAME = 'shopify-dev-mcp'

export interface DeniedCommand {
  toolName: string
  input: Record<string, unknown>
  reason: string
}

/**
 * The agent's Bash tool is wrapped by this guard (invariant 3): deny commands matching the
 * fixed denylist in src/policy.ts or that touch a path outside the workspace, independent of
 * whatever the system prompt says. Everything else in the explicit tool list — and any Shopify
 * Dev MCP tool — is allowed; anything else is denied by default (defense in depth).
 */
export function makeCanUseTool(workspaceRoot: string, onDenied: (denied: DeniedCommand) => void): CanUseTool {
  return async (toolName, input) => {
    if (toolName === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      const result = checkCommand(command, workspaceRoot)
      if (!result.allowed) {
        onDenied({ toolName, input, reason: result.reason ?? 'denied' })
        return { behavior: 'deny', message: `Blocked by StoreLoop policy: ${result.reason}` }
      }
      return { behavior: 'allow', updatedInput: input }
    }
    if (BASE_ALLOWED_TOOLS.includes(toolName) || toolName.startsWith(`mcp__${DEV_MCP_SERVER_NAME}__`)) {
      return { behavior: 'allow', updatedInput: input }
    }
    onDenied({ toolName, input, reason: 'not in the theme agent allow-list' })
    return { behavior: 'deny', message: `Tool ${toolName} is not available to the theme agent.` }
  }
}

export interface RunThemeAgentInput {
  taskTitle: string
  taskDescription: string
  priorComments: string[]
  brandFilePath: string
  workspaceDir: string
  model: string
  onDenied?: (denied: DeniedCommand) => void
}

function buildPrompt(input: RunThemeAgentInput): string {
  const comments =
    input.priorComments.length > 0
      ? input.priorComments.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : '(none — this is the first round)'
  return [
    `Task: ${input.taskTitle}`,
    '',
    input.taskDescription || '(no description)',
    '',
    `Brand file to read first: ${input.brandFilePath}`,
    '',
    'Prior ClickUp comments on this task, oldest first:',
    comments,
  ].join('\n')
}

/** Runs the theme agent to completion and returns its validated JSON result. */
export async function runThemeAgent(input: RunThemeAgentInput): Promise<ThemeAgentResult> {
  const systemPrompt = readFileSync('prompts/theme-agent.md', 'utf8')
  const canUseTool = makeCanUseTool(input.workspaceDir, input.onDenied ?? (() => {}))

  const stream = query({
    prompt: buildPrompt(input),
    options: {
      cwd: input.workspaceDir,
      model: input.model,
      systemPrompt,
      allowedTools: [...BASE_ALLOWED_TOOLS],
      canUseTool,
      permissionMode: 'default',
      mcpServers: {
        [DEV_MCP_SERVER_NAME]: { command: 'npx', args: ['-y', '@shopify/dev-mcp@latest'] },
      },
      outputFormat: { type: 'json_schema', schema: themeAgentOutputJsonSchema },
    },
  })

  for await (const message of stream) {
    if (message.type === 'result') {
      if (message.subtype !== 'success') {
        throw new Error(`theme agent run did not succeed: ${message.subtype}`)
      }
      return themeAgentResultSchema.parse(message.structured_output)
    }
  }
  throw new Error('theme agent stream ended without a result message')
}
