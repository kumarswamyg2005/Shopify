import { describe, it, expect } from 'vitest'
import { checkCommand, computePlanHash, isAdminMutationAllowed } from '../src/policy.js'

describe('checkCommand', () => {
  const root = '/workspaces/client/theme'

  it.each([
    'shopify theme push --unpublished --theme "SL-1" --allow-live',
    'shopify theme publish --theme 123',
    'shopify theme delete --theme 123',
    'rm -rf /workspaces/client/theme',
    'curl https://evil.example.com',
    'wget https://evil.example.com',
    'git push origin main',
  ])('denies: %s', (command) => {
    expect(checkCommand(command, root).allowed).toBe(false)
  })

  it('denies paths outside the workspace', () => {
    expect(checkCommand('cat /etc/passwd', root).allowed).toBe(false)
    expect(checkCommand('cat ../../secrets.env', root).allowed).toBe(false)
  })

  it('allows safe commands inside the workspace', () => {
    expect(checkCommand('shopify theme check', root).allowed).toBe(true)
    expect(checkCommand('cat sections/header.liquid', root).allowed).toBe(true)
  })
})

describe('computePlanHash', () => {
  it('is stable across key order', () => {
    const a = computePlanHash({ mutations: [{ op: 'tagsAdd', target: '1' }], count: 1 })
    const b = computePlanHash({ count: 1, mutations: [{ target: '1', op: 'tagsAdd' }] })
    expect(a).toBe(b)
  })

  it('changes when content changes', () => {
    const a = computePlanHash({ count: 1 })
    const b = computePlanHash({ count: 2 })
    expect(a).not.toBe(b)
  })
})

describe('isAdminMutationAllowed', () => {
  it('allows the fixed allow-list', () => {
    expect(isAdminMutationAllowed('tagsAdd')).toBe(true)
  })

  it('rejects destructive or unknown ops', () => {
    expect(isAdminMutationAllowed('productDelete')).toBe(false)
    expect(isAdminMutationAllowed('somethingElse')).toBe(false)
  })
})
