/**
 * Markdown rendering.
 *
 * Models answer in markdown whether or not you ask them to, and the renderer
 * builds React elements rather than HTML, so nothing here can inject markup.
 * These checks cover the structure it produces and the one thing that would
 * be a security problem if it were wrong: which link schemes are followed.
 *
 *   bun --preload ./scripts/preload.ts scripts/test-markdown.mts
 */

import assert from 'node:assert/strict'
import type { ReactElement, ReactNode } from 'react'

import { Markdown, renderInline, stripMarkdown } from '../src/components/studio/Markdown'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

interface Node {
  type?: unknown
  props?: { children?: ReactNode; [key: string]: unknown }
}

/**
 * Walk the element tree, since there is no DOM here.
 *
 * Function components are called rather than skipped: the renderer produces
 * `<CodeBlock>` and `<Table>` elements, and their real tags only exist once
 * those have run.
 */
function walk(node: ReactNode, visit: (element: Node) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (!node || typeof node !== 'object') return

  const element = node as Node

  if (typeof element.type === 'function') {
    const fn = element.type as (props: unknown) => ReactNode
    walk(fn(element.props ?? {}), visit)
    return
  }

  visit(element)
  if (element.props?.children) walk(element.props.children, visit)
}

/** Every tag name in the tree, in order. */
function tags(node: ReactNode): string[] {
  const found: string[] = []
  walk(node, (element) => {
    if (typeof element.type === 'string') found.push(element.type)
  })
  return found
}

/** All the text, with the markup taken away. */
function text(node: ReactNode): string {
  let out = ''
  const collect = (n: ReactNode) => {
    if (typeof n === 'string') {
      out += n
      return
    }
    if (Array.isArray(n)) {
      for (const child of n) collect(child)
      return
    }
    if (n && typeof n === 'object') {
      const element = n as Node
      if (typeof element.type === 'function') {
        const fn = element.type as (props: unknown) => ReactNode
        collect(fn(element.props ?? {}))
        return
      }
      collect(element.props?.children ?? null)
    }
  }
  collect(node)
  return out
}

/** Render a document the way the component does, without React's runtime. */
function render(source: string): ReactNode {
  const element = Markdown({ children: source }) as ReactElement
  return (element.props as { children: ReactNode }).children
}

console.log('\nblocks')

check('headings become heading elements, not text', () => {
  const out = render('### 1. La SGI\n\nSome body text.')
  // `###` in the output is exactly the bug this exists to fix.
  assert.equal(text(out).includes('###'), false)
  assert.ok(tags(out).includes('h4'))
  assert.ok(text(out).includes('1. La SGI'))
})

check('every heading level maps to a tag', () => {
  for (let level = 1; level <= 6; level++) {
    const out = render(`${'#'.repeat(level)} Title`)
    const tag = tags(out)[0]
    assert.ok(/^h[2-6]$/.test(tag), `level ${level} produced <${tag}>`)
    assert.equal(text(out), 'Title')
  }
})

check('bold and italic become elements', () => {
  const out = render('The terms **SGI** and *SGO* differ.')
  assert.equal(text(out).includes('**'), false)
  assert.ok(tags(out).includes('strong'))
  assert.ok(tags(out).includes('em'))
  assert.ok(text(out).includes('SGI'))
})

check('bold inside a bullet is rendered, not printed', () => {
  // The exact shape a model produced: a bullet whose label is bold and ends
  // with a colon before the sentence.
  const out = render('*   **Son rôle principal :** Elle agit comme un courtier.')
  assert.equal(text(out).includes('**'), false)
  assert.ok(tags(out).includes('ul'))
  assert.ok(tags(out).includes('li'))
  assert.ok(tags(out).includes('strong'))
  assert.ok(text(out).includes('Son rôle principal'))
})

check('a bullet list groups into one ul', () => {
  const out = render('- one\n- two\n- three')
  assert.equal(tags(out).filter((t) => t === 'ul').length, 1)
  assert.equal(tags(out).filter((t) => t === 'li').length, 3)
})

check('a numbered list is ordered', () => {
  const out = render('1. first\n2. second')
  assert.ok(tags(out).includes('ol'))
  assert.equal(tags(out).includes('ul'), false)
})

check('an indented bullet nests inside the one above', () => {
  const out = render('- parent\n  - child')
  const uls = tags(out).filter((t) => t === 'ul')
  assert.equal(uls.length, 2, 'the nested list should be its own ul')
})

check('a fenced block keeps its contents literal', () => {
  const out = render('```ts\nconst x = **not bold**\n```')
  assert.ok(tags(out).includes('pre'))
  assert.ok(tags(out).includes('code'))
  // Nothing inside a fence is markdown, so the stars survive.
  assert.ok(text(out).includes('**not bold**'))
})

check('an unclosed fence does not swallow the renderer', () => {
  const out = render('```\nstill open')
  assert.ok(tags(out).includes('pre'))
  assert.ok(text(out).includes('still open'))
})

check('a table needs its divider row', () => {
  const table = render('| a | b |\n|---|---|\n| 1 | 2 |')
  assert.ok(tags(table).includes('table'))
  assert.equal(tags(table).filter((t) => t === 'td').length, 2)

  // A sentence with pipes is a paragraph, not a table.
  const prose = render('Use a | b to pipe.')
  assert.equal(tags(prose).includes('table'), false)
})

check('blockquotes and rules render', () => {
  assert.ok(tags(render('> quoted')).includes('blockquote'))
  assert.ok(tags(render('---')).includes('hr'))
})

check('paragraphs are separated', () => {
  const out = render('First para.\n\nSecond para.')
  assert.equal(tags(out).filter((t) => t === 'p').length, 2)
})

console.log('\ninline')

check('inline code is not reprocessed', () => {
  const out = renderInline('use `**literal**` here')
  assert.ok(text(out).includes('**literal**'))
  assert.ok(tags(out).includes('code'))
})

check('an http link is followed', () => {
  const out = renderInline('see [the docs](https://docs.kie.ai)')
  const anchors: Node[] = []
  walk(out, (element) => {
    if (element.type === 'a') anchors.push(element)
  })

  assert.equal(anchors.length, 1)
  assert.equal(anchors[0].props?.href, 'https://docs.kie.ai')
  // A model's link is not to be trusted with the opener.
  assert.equal(anchors[0].props?.rel, 'noreferrer noopener')
})

check('a javascript: link is never an anchor', () => {
  const out = renderInline('[click](javascript:alert(1))')
  assert.equal(tags(out).includes('a'), false)
  // Shown as its own text rather than silently dropped.
  assert.ok(text(out).includes('javascript:alert(1)'))
})

check('data: and other schemes are refused too', () => {
  for (const url of ['data:text/html,<script>', 'vbscript:x', 'file:///etc/passwd']) {
    const out = renderInline(`[x](${url})`)
    assert.equal(tags(out).includes('a'), false, `${url} became a link`)
  }
})

check('markup in the text stays text', () => {
  // The whole reason this renders elements instead of HTML: there is no path
  // from a model's output to markup.
  const out = render('<script>alert(1)</script>')
  assert.equal(tags(out).includes('script'), false)
  assert.ok(text(out).includes('<script>alert(1)</script>'))
})

check('underscores inside a word are not emphasis', () => {
  const out = renderInline('the model_id_field name')
  assert.equal(tags(out).includes('em'), false)
  assert.equal(text(out), 'the model_id_field name')
})

console.log('\npreviews')

check('a preview keeps the words and loses the syntax', () => {
  const preview = stripMarkdown('### Heading\n\n**Bold** and `code` and [a link](https://x.com)')

  for (const marker of ['###', '**', '`', '](']) {
    assert.equal(preview.includes(marker), false, `"${marker}" survived`)
  }
  assert.ok(preview.includes('Heading'))
  assert.ok(preview.includes('Bold'))
  assert.ok(preview.includes('a link'))
})

check('a preview turns bullets into something readable', () => {
  const preview = stripMarkdown('- one\n- two')
  assert.ok(preview.startsWith('· one'))
})

console.log(`\n${passed} checks passed`)
