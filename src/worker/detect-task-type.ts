const ADMIN_KEYWORDS = ['tag', 'collection', 'redirect', 'metafield', 'price']

/**
 * A ClickUp tag named exactly "theme" or "admin" wins. Otherwise, a simple keyword heuristic
 * over the title/description — good enough for a PoC where the real signal is the tag.
 */
export function detectTaskType(task: { name: string; text_content: string; tags: Array<{ name: string }> }): 'theme' | 'admin' {
  const tagNames = task.tags.map((t) => t.name.toLowerCase())
  if (tagNames.includes('admin')) return 'admin'
  if (tagNames.includes('theme')) return 'theme'

  const text = `${task.name} ${task.text_content}`.toLowerCase()
  return ADMIN_KEYWORDS.some((kw) => text.includes(kw)) ? 'admin' : 'theme'
}
