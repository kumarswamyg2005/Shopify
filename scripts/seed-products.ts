import { readFileSync, writeFileSync } from 'node:fs'
import { env } from '../src/env.js'
import { ShopifyAdminClient } from '../src/shopify/admin.js'
import { loadClientConfig } from '../src/clients/config.js'

interface SeedProduct {
  title: string
  description: string
  productType: string
  price: string
  tags: string[]
  image: string
}

const products = JSON.parse(readFileSync('seed/products.json', 'utf8')) as SeedProduct[]

if (!env.SHOPIFY_ADMIN_API_TOKEN) {
  // No token: emit a CSV for Shopify admin → Products → Import instead.
  const q = (v: string) => `"${v.replaceAll('"', '""')}"`
  const rows = products.map((p) =>
    [
      p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      p.title, `<p>${p.description}</p>`, 'StoreLoop Demo', p.productType, p.tags.join(', '), 'TRUE',
      'Title', 'Default Title', p.price, '', 'shopify', p.image, 'TRUE', 'active',
    ].map((v) => q(String(v))).join(','),
  )
  const header = 'Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Variant Price,Variant SKU,Variant Inventory Tracker,Image Src,Variant Requires Shipping,Status'
  writeFileSync('data/products.csv', [header, ...rows].join('\n'))
  console.log('No SHOPIFY_ADMIN_API_TOKEN set. Wrote data/products.csv — import it at Shopify admin → Products → Import.')
  process.exit(0)
}

const client = loadClientConfig('clients/storeloop-demo.yaml')
const admin = new ShopifyAdminClient({ store: client.shopifyStore, apiVersion: env.SHOPIFY_API_VERSION, adminApiToken: env.SHOPIFY_ADMIN_API_TOKEN })
const existing = new Set((await admin.listProducts('', 250)).map((p) => p.title))

for (const p of products) {
  if (existing.has(p.title)) {
    console.log(`skip  ${p.title} (already exists)`)
    continue
  }
  await admin.productCreate({ title: p.title, descriptionHtml: `<p>${p.description}</p>`, productType: p.productType, tags: p.tags, price: p.price, imageUrl: p.image })
  console.log(`added ${p.title} ($${p.price})`)
}
