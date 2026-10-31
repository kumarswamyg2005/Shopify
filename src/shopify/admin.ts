export class ShopifyAdminError extends Error {
  constructor(
    message: string,
    public readonly userErrors?: Array<{ field?: string[] | null; message: string }>,
  ) {
    super(message)
  }
}

export interface AdminClientOptions {
  store: string
  apiVersion: string
  adminApiToken: string
  fetchImpl?: typeof fetch
  maxRetries?: number
}

interface GraphQlResponse<T> {
  data?: T
  errors?: Array<{ message: string; extensions?: { code?: string } }>
  extensions?: { cost?: { throttleStatus?: { currentlyAvailable: number; restoreRate: number } } }
}

/**
 * Admin GraphQL API client. Owns the only code path that holds SHOPIFY_ADMIN_API_TOKEN
 * (invariant 1) — the agent never sees this client or its token.
 */
export class ShopifyAdminClient {
  private readonly endpoint: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch
  private readonly maxRetries: number

  constructor(opts: AdminClientOptions) {
    this.endpoint = `https://${opts.store}/admin/api/${opts.apiVersion}/graphql.json`
    this.token = opts.adminApiToken
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.maxRetries = opts.maxRetries ?? 5
  }

  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': this.token },
        body: JSON.stringify({ query, variables }),
      })
      const body = (await res.json()) as GraphQlResponse<T>
      const throttled = body.errors?.some((e) => e.extensions?.code === 'THROTTLED')
      if (throttled && attempt < this.maxRetries) {
        const available = body.extensions?.cost?.throttleStatus?.currentlyAvailable ?? 0
        const restoreRate = body.extensions?.cost?.throttleStatus?.restoreRate ?? 50
        const waitMs = available > 50 ? 0 : Math.ceil(((50 - available) / restoreRate) * 1000)
        await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 2 ** attempt * 250)))
        continue
      }
      if (body.errors && body.errors.length > 0) {
        throw new ShopifyAdminError(body.errors.map((e) => e.message).join('; '))
      }
      if (!body.data) throw new ShopifyAdminError('empty response from Shopify Admin API')
      return body.data
    }
    throw new ShopifyAdminError(`rate limited after ${this.maxRetries} retries`)
  }

  // --- reads (used by the admin agent's in-process MCP tools) ---

  async listProducts(query: string, limit = 50): Promise<Array<{ id: string; title: string; tags: string[] }>> {
    const data = await this.graphql<{ products: { nodes: Array<{ id: string; title: string; tags: string[] }> } }>(
      `query($q: String!, $n: Int!) { products(first: $n, query: $q) { nodes { id title tags } } }`,
      { q: query, n: limit },
    )
    return data.products.nodes
  }

  async listProductsUnderPrice(maxPrice: number, limit = 100): Promise<Array<{ id: string; title: string; price: number }>> {
    const data = await this.graphql<{ products: { nodes: Array<{ id: string; title: string; priceRangeV2: { maxVariantPrice: { amount: string } } }> } }>(
      `query($n: Int!) { products(first: $n) { nodes { id title priceRangeV2 { maxVariantPrice { amount } } } } }`,
      { n: limit },
    )
    return data.products.nodes
      .map((p) => ({ id: p.id, title: p.title, price: Number(p.priceRangeV2.maxVariantPrice.amount) }))
      .filter((p) => p.price < maxPrice)
  }

  async getCollections(limit = 50): Promise<Array<{ id: string; title: string; handle: string }>> {
    const data = await this.graphql<{ collections: { nodes: Array<{ id: string; title: string; handle: string }> } }>(
      `query($n: Int!) { collections(first: $n) { nodes { id title handle } } }`,
      { n: limit },
    )
    return data.collections.nodes
  }

  async getRedirects(limit = 50): Promise<Array<{ id: string; path: string; target: string }>> {
    const data = await this.graphql<{ urlRedirects: { nodes: Array<{ id: string; path: string; target: string }> } }>(
      `query($n: Int!) { urlRedirects(first: $n) { nodes { id path target } } }`,
      { n: limit },
    )
    return data.urlRedirects.nodes
  }

  // --- allow-listed writes (orchestrator-only, invariant 1 and 2) ---

  async tagsAdd(productId: string, tags: string[]): Promise<void> {
    await this.runMutation(
      `mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`,
      { id: productId, tags },
      'tagsAdd',
    )
  }

  async tagsRemove(productId: string, tags: string[]): Promise<void> {
    await this.runMutation(
      `mutation($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { field message } } }`,
      { id: productId, tags },
      'tagsRemove',
    )
  }

  async collectionCreateFromTag(title: string, tag: string): Promise<{ id: string }> {
    const data = await this.runMutation<{ collectionCreate: { collection: { id: string } | null; userErrors: Array<{ field?: string[] | null; message: string }> } }>(
      `mutation($input: CollectionInput!) { collectionCreate(input: $input) { collection { id } userErrors { field message } } }`,
      { input: { title, ruleSet: { appliedDisjunctively: false, rules: [{ column: 'TAG', relation: 'EQUALS', condition: tag }] } } },
      'collectionCreate',
    )
    if (!data.collectionCreate.collection) throw new ShopifyAdminError('collectionCreate returned no collection')
    return data.collectionCreate.collection
  }

  async urlRedirectCreate(path: string, target: string): Promise<{ id: string }> {
    const data = await this.runMutation<{ urlRedirectCreate: { urlRedirect: { id: string } | null; userErrors: Array<{ field?: string[] | null; message: string }> } }>(
      `mutation($redirect: UrlRedirectInput!) { urlRedirectCreate(urlRedirect: $redirect) { urlRedirect { id } userErrors { field message } } }`,
      { redirect: { path, target } },
      'urlRedirectCreate',
    )
    if (!data.urlRedirectCreate.urlRedirect) throw new ShopifyAdminError('urlRedirectCreate returned no redirect')
    return data.urlRedirectCreate.urlRedirect
  }

  // --- operator-only (scripts/demo-reset.ts only — never exposed to the agent or its allow-list) ---

  async findCollectionByTitle(title: string): Promise<{ id: string } | null> {
    const collections = await this.getCollections(250)
    return collections.find((c) => c.title === title) ?? null
  }

  async collectionDelete(id: string): Promise<void> {
    await this.runMutation(
      `mutation($id: ID!) { collectionDelete(input: { id: $id }) { deletedCollectionId userErrors { field message } } }`,
      { id },
      'collectionDelete',
    )
  }

  async productCreate(input: { title: string; descriptionHtml: string; productType: string; tags: string[]; price: string; imageUrl: string }): Promise<{ id: string }> {
    const data = await this.runMutation<{ productCreate: { product: { id: string; variants: { nodes: Array<{ id: string }> } } | null } }>(
      `mutation($product: ProductCreateInput!, $media: [CreateMediaInput!]) { productCreate(product: $product, media: $media) { product { id variants(first: 1) { nodes { id } } } userErrors { field message } } }`,
      {
        product: { title: input.title, descriptionHtml: input.descriptionHtml, productType: input.productType, tags: input.tags, status: 'ACTIVE' },
        media: [{ originalSource: input.imageUrl, mediaContentType: 'IMAGE', alt: input.title }],
      },
      'productCreate',
    )
    const product = data.productCreate.product
    if (!product) throw new ShopifyAdminError('productCreate returned no product')
    const variantId = product.variants.nodes[0]?.id
    if (variantId) {
      await this.runMutation(
        `mutation($pid: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $pid, variants: $v) { userErrors { field message } } }`,
        { pid: product.id, v: [{ id: variantId, price: input.price }] },
        'productVariantsBulkUpdate',
      )
    }
    return { id: product.id }
  }

  async metafieldsSet(input: { ownerId: string; namespace: string; key: string; type: string; value: string }): Promise<void> {
    await this.runMutation(
      `mutation($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { userErrors { field message } } }`,
      { metafields: [input] },
      'metafieldsSet',
    )
  }

  private async runMutation<T = { userErrors: Array<{ field?: string[] | null; message: string }> }>(
    mutation: string,
    variables: Record<string, unknown>,
    field: string,
  ): Promise<T> {
    const data = await this.graphql<Record<string, { userErrors: Array<{ field?: string[] | null; message: string }> }>>(
      mutation,
      variables,
    )
    const userErrors = data[field]?.userErrors ?? []
    if (userErrors.length > 0) {
      throw new ShopifyAdminError(userErrors.map((e) => e.message).join('; '), userErrors)
    }
    return data as T
  }
}
