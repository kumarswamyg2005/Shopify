import type { PlatformAdapter } from './types.js'

class NotImplemented extends Error {
  constructor(adapter: string) {
    super(`${adapter} is not implemented — see the comment on this class for the mapping`)
  }
}

/**
 * Storyblok's native preview concept: plan() creates a draft Story version via the Management
 * API; preview() returns the Visual Editor preview URL for that draft (space + story id + a
 * preview token), which already renders unpublished content exactly like StoreLoop's unpublished
 * theme preview does; apply() calls the publish-story endpoint only after ClickUp approval;
 * rollback() restores the previous published version from Storyblok's built-in version history.
 */
export class StoryblokAdapter implements PlatformAdapter {
  readonly id = 'storyblok'
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
