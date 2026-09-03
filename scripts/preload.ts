/**
 * Test preload.
 *
 * `server-only` throws when imported outside a React Server Component, which
 * is what keeps the database and Kie client out of the browser bundle. Tests
 * exercise those modules directly, so the guard is stubbed here rather than
 * removed from the source.
 */

import { plugin } from 'bun'

plugin({
  name: 'stub-server-only',
  setup(build) {
    build.module('server-only', () => ({ exports: {}, loader: 'object' }))
  },
})
