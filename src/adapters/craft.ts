import type { PlatformAdapter } from './types.js'

class NotImplemented extends Error {
  constructor(adapter: string) {
    super(`${adapter} is not implemented — see the comment on this class for the mapping`)
  }
}

/**
 * Craft CMS's native preview concept: plan() saves an entry draft via the GraphQL/Element API;
 * preview() returns the entry's preview target URL (Craft's built-in draft preview, resolved
 * through the site's preview targets config) — the same "look at it before it's real" moment as
 * an unpublished Shopify theme; apply() applies the draft to the canonical entry after approval;
 * rollback() uses Craft's entry revisions to restore the prior canonical version.
 */
export class CraftAdapter implements PlatformAdapter {
  readonly id = 'craft'
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
