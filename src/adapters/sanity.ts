import type { PlatformAdapter } from './types.js'

class NotImplemented extends Error {
  constructor(adapter: string) {
    super(`${adapter} is not implemented — see the comment on this class for the mapping`)
  }
}

/**
 * Sanity's native preview concept: plan() writes a draft document (the `drafts.` id prefix keeps
 * it invisible to published queries); preview() returns a Presentation-tool preview URL scoped to
 * that draft, which StoreLoop would open the same way it opens a Shopify unpublished-theme
 * preview; apply() publishes the draft (promotes `drafts.<id>` to `<id>`) only after approval;
 * rollback() uses Sanity's document history API to revert to the prior published revision.
 */
export class SanityAdapter implements PlatformAdapter {
  readonly id = 'sanity'
  plan(): never {
    throw new NotImplemented(this.id)
  }
  preview(): never {
    throw new NotImplemented(this.id)
  }
  apply(): never {
    throw new NotImplemented(this.id)
  }
  rollback(): never {
    throw new NotImplemented(this.id)
  }
}
