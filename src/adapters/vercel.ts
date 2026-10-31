import type { PlatformAdapter } from './types.js'

class NotImplemented extends Error {
  constructor(adapter: string) {
    super(`${adapter} is not implemented — see the comment on this class for the mapping`)
  }
}

/**
 * Vercel's native preview concept: plan() commits code changes to a branch (`task/<id>`, same
 * convention as the theme workspace); preview() returns the automatic Deploy Preview URL Vercel
 * builds for that branch/PR — no separate "unpublished copy" step needed, the deploy preview IS
 * the preview; apply() merges the branch to production (or promotes the preview deployment) after
 * approval; rollback() redeploys the previous production deployment via Vercel's instant rollback.
 */
export class VercelAdapter implements PlatformAdapter {
  readonly id = 'vercel'
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
