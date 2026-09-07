/**
 * Refresh the snapshot of Kie's model schemas.
 *
 *   bun scripts/fetch-kie-schemas.mts
 *
 * Every model page on docs.kie.ai embeds an OpenAPI document describing what
 * `input` that model accepts. This walks the sitemap, parses each one, and
 * writes `scripts/kie/schemas.json`.
 *
 * The snapshot exists so `test-schemas.mts` can check the catalog against
 * Kie's own definitions without a network call, which is what CI needs and
 * what stops the catalog drifting from reality between releases.
 *
 * Re-run it when Kie ships models. The test will tell you when that has
 * happened, by failing on a slug it has never seen.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const SITEMAP = 'https://docs.kie.ai/sitemap.xml'
const OUT = new URL('./kie/schemas.json', import.meta.url).pathname

/** Concurrent fetches. Their docs site is not the thing being tested. */
const CONCURRENCY = 8

interface FieldSpec {
  type?: string
  enum?: (string | number)[]
  default?: unknown
  minimum?: number
  maximum?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  description?: string
  items?: { type?: string }
}

interface ModelSpec {
  doc: string
  path: string
  title: string
  required: string[]
  fields: Record<string, FieldSpec>
}

async function sitemapUrls(): Promise<string[]> {
  const xml = await (await fetch(SITEMAP)).text()
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  // The /cn/ tree is the same documents in Chinese.
  return urls.filter((u) => u.includes('/market/') && !u.includes('/cn/'))
}

/**
 * Pull the YAML block out of a doc page.
 *
 * Their pages are markdown with the OpenAPI document in a fenced block, which
 * is a far better contract than scraping the rendered HTML.
 */
function yamlBlock(markdown: string): string | null {
  const match = /```yaml\n([\s\S]*?)\n```/.exec(markdown)
  return match ? match[1] : null
}

async function main(): Promise<void> {
  const { parse } = await import('yaml').catch(() => {
    throw new Error(
      'This script needs the `yaml` package: bun add -d yaml',
    )
  })

  const urls = await sitemapUrls()
  console.log(`${urls.length} market pages`)

  const models: Record<string, ModelSpec> = {}
  let done = 0

  const worker = async (queue: string[]) => {
    for (;;) {
      const url = queue.pop()
      if (!url) return

      try {
        const markdown = await (await fetch(`${url}.md`)).text()
        const yaml = yamlBlock(markdown)
        if (!yaml) continue

        const spec = parse(yaml) as {
          paths?: Record<string, Record<string, unknown>>
        }
        const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? ''

        for (const [path, ops] of Object.entries(spec.paths ?? {})) {
          const post = ops?.post as
            | {
                requestBody?: {
                  content?: { 'application/json'?: { schema?: unknown } }
                }
              }
            | undefined

          const schema = post?.requestBody?.content?.['application/json']
            ?.schema as
            | { properties?: Record<string, Record<string, unknown>> }
            | undefined

          const props = schema?.properties
          if (!props) continue

          const model = props.model as
            | { default?: string; enum?: string[] }
            | undefined
          const input = props.input as
            | { properties?: Record<string, FieldSpec>; required?: string[] }
            | undefined

          const fields = input?.properties
          if (!fields) continue

          const slugs = new Set<string>()
          if (typeof model?.default === 'string') slugs.add(model.default)
          for (const value of model?.enum ?? []) {
            if (typeof value === 'string') slugs.add(value)
          }

          // Kie's schema carries a stray space on at least one field name
          // ("image_urls "), in both the property key and the required list.
          // Comparing against a name with whitespace in it helps nobody.
          const trimmed: Record<string, FieldSpec> = {}
          for (const [name, value] of Object.entries(fields)) {
            trimmed[name.trim()] = value
          }

          for (const slug of slugs) {
            models[slug] = {
              doc: url.replace('https://docs.kie.ai/', ''),
              path,
              title,
              required: [...(input?.required ?? [])].map((n) => n.trim()).sort(),
              fields: trimmed,
            }
          }
        }
      } catch (err) {
        console.warn(`  skipped ${url}: ${(err as Error).message}`)
      } finally {
        done++
        if (done % 25 === 0) console.log(`  ${done}/${urls.length}`)
      }
    }
  }

  const queue = [...urls]
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)))

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, `${JSON.stringify(models, null, 1)}\n`)

  console.log(`\n${Object.keys(models).length} model schemas written to ${OUT}`)
}

void main()
