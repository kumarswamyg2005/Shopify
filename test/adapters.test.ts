import { describe, it, expect } from 'vitest'
import { StoryblokAdapter } from '../src/adapters/storyblok.js'
import { SanityAdapter } from '../src/adapters/sanity.js'
import { CraftAdapter } from '../src/adapters/craft.js'
import { VercelAdapter } from '../src/adapters/vercel.js'
import { NetlifyAdapter } from '../src/adapters/netlify.js'
import type { PlatformAdapter } from '../src/adapters/types.js'

const stubs: Array<new () => PlatformAdapter> = [StoryblokAdapter, SanityAdapter, CraftAdapter, VercelAdapter, NetlifyAdapter]

describe('platform adapter stubs', () => {
  it.each(stubs)('%s throws NotImplemented on every method, never silently no-ops', (Adapter) => {
    const adapter = new Adapter()
    expect(() => adapter.plan({} as never)).toThrow(/not implemented/)
    expect(() => adapter.preview({} as never)).toThrow(/not implemented/)
    expect(() => adapter.apply({} as never, {} as never)).toThrow(/not implemented/)
    expect(() => adapter.rollback({} as never)).toThrow(/not implemented/)
  })
})
