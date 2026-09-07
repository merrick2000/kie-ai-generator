/**
 * Print the catalog as JSON, so it can be diffed against Kie's own schemas.
 *
 *   bun --preload ./scripts/preload.ts scripts/dump-catalog.mts
 */

import { MODELS } from '../src/lib/kie/catalog'

console.log(
  JSON.stringify(
    MODELS.map((m) => ({
      id: m.id,
      api: m.api,
      category: m.category,
      hidden: Boolean(m.hidden),
      chatModel: m.chat?.model,
      fields: m.fields.map((f) => ({ name: f.name, required: Boolean(f.required) })),
    })),
  ),
)
