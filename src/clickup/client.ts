import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

const BASE_URL = 'https://api.clickup.com/api/v2'

export class ClickUpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

export interface ClickUpClientOptions {
  apiToken: string
  teamId: string
  fetchImpl?: typeof fetch
  maxRetries?: number
}

export interface CreatedWebhook {
  id: string
  secret: string
}

/**
 * Thin typed wrapper around the ClickUp REST API v2. Retries on 429 with exponential backoff
 * (max 5 retries, then the caller should mark the job blocked).
 */
export class ClickUpClient {
  private readonly token: string
  private readonly teamId: string
  private readonly fetchImpl: typeof fetch
  private readonly maxRetries: number

  constructor(opts: ClickUpClientOptions) {
    this.token = opts.apiToken
    this.teamId = opts.teamId
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.maxRetries = opts.maxRetries ?? 5
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', this.token)
    if (!(init.body instanceof FormData) && init.body !== undefined) {
      headers.set('Content-Type', 'application/json')
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const res = await this.fetchImpl(`${BASE_URL}${path}`, { ...init, headers })
      if (res.status !== 429) return res
      if (attempt === this.maxRetries) {
        throw new ClickUpError(`rate limited after ${this.maxRetries} retries: ${path}`, 429)
      }
      const backoffMs = 2 ** attempt * 500
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
    throw new ClickUpError(`unreachable: ${path}`, 500)
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.request(path, init)
    if (!res.ok) {
      throw new ClickUpError(`ClickUp ${init?.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`, res.status)
    }
    return (await res.json()) as T
  }

  async getTask(
    taskId: string,
  ): Promise<{ id: string; name: string; text_content: string; status: { status: string }; tags: Array<{ name: string }> }> {
    return this.json(`/task/${taskId}`)
  }

  /** Human comments on a task, oldest first — StoreLoop's own `[StoreLoop]` comments are excluded. */
  async listComments(taskId: string): Promise<string[]> {
    const data = await this.json<{ comments: Array<{ comment_text: string; date: string }> }>(`/task/${taskId}/comment`)
    return data.comments
      .filter((c) => !c.comment_text.startsWith('[StoreLoop]'))
      .sort((a, b) => Number(a.date) - Number(b.date))
      .map((c) => c.comment_text.trim())
  }

  async getList(listId: string): Promise<{ id: string; space: { id: string } }> {
    return this.json(`/list/${listId}`)
  }

  async createTask(listId: string, name: string, description: string, tags: string[] = []): Promise<{ id: string }> {
    return this.json(`/list/${listId}/task`, {
      method: 'POST',
      body: JSON.stringify({ name, description, tags }),
    })
  }

  /** Retries up to 3 times on any failure — a lost ClickUp comment is the whole point of the loop. */
  async createComment(taskId: string, commentText: string): Promise<{ id: string }> {
    const attempts = 3
    let lastErr: unknown
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.json(`/task/${taskId}/comment`, {
          method: 'POST',
          body: JSON.stringify({ comment_text: commentText }),
        })
      } catch (err) {
        lastErr = err
        if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
      }
    }
    throw lastErr
  }

  async setStatus(taskId: string, status: string): Promise<void> {
    await this.json(`/task/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    })
  }

  async uploadAttachment(taskId: string, filePath: string): Promise<{ id: string; url: string }> {
    const buffer = await readFile(filePath)
    const form = new FormData()
    form.set('attachment', new Blob([buffer]), basename(filePath))
    return this.json(`/task/${taskId}/attachment`, { method: 'POST', body: form })
  }

  async createTimeEntry(taskId: string, durationMs: number, tag = 'agent'): Promise<void> {
    await this.json(`/team/${this.teamId}/time_entries`, {
      method: 'POST',
      body: JSON.stringify({
        tid: taskId,
        start: Date.now() - durationMs,
        duration: durationMs,
        tags: [{ name: tag }],
      }),
    })
  }

  async createWebhook(spaceId: string, endpointUrl: string): Promise<CreatedWebhook> {
    const result = await this.json<{ id: string; webhook: { secret: string } }>(`/team/${this.teamId}/webhook`, {
      method: 'POST',
      body: JSON.stringify({
        endpoint: endpointUrl,
        events: ['taskStatusUpdated', 'taskCommentPosted'],
        space_id: spaceId,
      }),
    })
    return { id: result.id, secret: result.webhook.secret }
  }
}
