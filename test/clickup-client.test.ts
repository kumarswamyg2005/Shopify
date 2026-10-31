import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ClickUpClient } from '../src/clickup/client.js'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ClickUpClient throttling', () => {
  it('backs off on 429 and succeeds once the rate limit clears', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'task_1', name: 'x', text_content: '', status: { status: 'open' }, tags: [] }))
    const client = new ClickUpClient({ apiToken: 't', teamId: 'team_1', fetchImpl, maxRetries: 5 })

    const call = client.getTask('task_1')
    await vi.advanceTimersByTimeAsync(30_000)
    const task = await call

    expect(task.id).toBe('task_1')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('gives up after maxRetries consecutive 429s', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => jsonResponse(429, {}))
    const client = new ClickUpClient({ apiToken: 't', teamId: 'team_1', fetchImpl, maxRetries: 2 })

    const call = client.getTask('task_1')
    const assertion = expect(call).rejects.toThrow(/rate limited/)
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion

    expect(fetchImpl).toHaveBeenCalledTimes(3) // initial + 2 retries
  })
})

describe('ClickUpClient.createComment', () => {
  it('retries up to 3 times on failure before giving up', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse(500, { err: 'boom' }))
      .mockImplementationOnce(() => jsonResponse(500, { err: 'boom' }))
      .mockImplementationOnce(() => jsonResponse(200, { id: 'comment_1' }))
    const client = new ClickUpClient({ apiToken: 't', teamId: 'team_1', fetchImpl })

    const call = client.createComment('task_1', '[StoreLoop] hi')
    await vi.advanceTimersByTimeAsync(30_000)
    const result = await call

    expect(result.id).toBe('comment_1')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('throws after 3 failed attempts', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => jsonResponse(500, { err: 'boom' }))
    const client = new ClickUpClient({ apiToken: 't', teamId: 'team_1', fetchImpl })

    const call = client.createComment('task_1', 'x')
    const assertion = expect(call).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion

    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})

describe('ClickUpClient.createTimeEntry', () => {
  it('sends the expected payload shape tagged "agent"', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }))
    const client = new ClickUpClient({ apiToken: 't', teamId: 'team_1', fetchImpl })
    await client.createTimeEntry('task_1', 252000)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.clickup.com/api/v2/team/team_1/time_entries')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ tid: 'task_1', duration: 252000, tags: [{ name: 'agent' }] })
    expect(typeof body.start).toBe('number')
  })
})
