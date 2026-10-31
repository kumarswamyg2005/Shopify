import type { PlatformAdapter } from './types.js'

class NotImplemented extends Error {
  constructor(adapter: string) {
    super(`${adapter} is not implemented — see the comment on this class for the mapping`)
  }
}

/**
 * Netlify's native preview concept: plan() commits to a branch, same as Vercel; preview() returns
 * the Deploy Preview URL Netlify builds automatically for that branch/PR; apply() merges to the
 * production branch (or promotes the deploy via the Netlify API) after approval; rollback() uses
 * Netlify's one-click "publish an earlier deploy" to restore the previous production build.
 */
export class NetlifyAdapter implements PlatformAdapter {
  readonly id = 'netlify'
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
