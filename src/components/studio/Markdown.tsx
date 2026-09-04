'use client'

import { Fragment, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Markdown, rendered as React elements.
 *
 * Language models answer in markdown whether or not you ask them to, so
 * showing the raw text means showing `**bold**` and `### heading` to the
 * reader. This turns the subset they actually emit into real elements.
 *
 * No HTML is ever produced from the model's text. Everything below builds
 * React nodes, so a model that writes `<script>` writes those characters and
 * nothing else. That is the reason this is hand-written rather than a
 * markdown-to-HTML library behind a sanitiser: there is no HTML to sanitise.
 */

interface MarkdownProps {
  children: string
  className?: string
}

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn('space-y-3 text-[14px] leading-[1.7] text-ink-muted', className)}>
      {renderBlocks(children)}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 * Blocks
 * ──────────────────────────────────────────────────────────────────────────*/

const HEADING = /^(#{1,6})\s+(.*)$/
const FENCE = /^\s*```(\S*)\s*$/
const RULE = /^\s*(?:[-*_]\s*){3,}$/
const QUOTE = /^\s*>\s?(.*)$/
const BULLET = /^(\s*)[-*+]\s+(.*)$/
const NUMBERED = /^(\s*)(\d+)[.)]\s+(.*)$/
const TABLE_DIVIDER = /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/

/** Heading sizes, tightening as they get deeper. */
const HEADING_CLASS = [
  'text-[19px] font-semibold text-ink',
  'text-[17px] font-semibold text-ink',
  'text-[15px] font-semibold text-ink',
  'text-[14px] font-semibold text-ink',
  'text-[13px] font-semibold text-ink',
  'text-[13px] font-medium text-ink-muted',
]

function renderBlocks(source: string): ReactNode[] {
  // Normalised first: a stray \r turns every regex below into a near miss.
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i++
      continue
    }

    // Fenced code. Taken first, because everything inside it is literal.
    const fence = FENCE.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      // Skips the closing fence, and tolerates a block that never closes.
      i++

      out.push(
        <CodeBlock key={key++} language={fence[1]} code={body.join('\n')} />,
      )
      continue
    }

    if (RULE.test(line)) {
      out.push(<hr key={key++} className="border-line" />)
      i++
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      const level = heading[1].length
      const Tag = `h${Math.min(level + 1, 6)}` as 'h2'
      out.push(
        <Tag key={key++} className={cn('pt-1', HEADING_CLASS[level - 1])}>
          {renderInline(heading[2])}
        </Tag>,
      )
      i++
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(QUOTE.exec(lines[i])![1])
        i++
      }
      out.push(
        <blockquote
          key={key++}
          className="border-l-2 border-line-bright pl-3 text-ink-faint"
        >
          {renderBlocks(body.join('\n'))}
        </blockquote>,
      )
      continue
    }

    // A table needs its divider on the second line, which is what tells it
    // apart from a paragraph that happens to contain pipes.
    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const rows: string[] = [line]
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(lines[i])
        i++
      }
      out.push(<Table key={key++} rows={rows} />)
      continue
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      const block: string[] = []
      while (
        i < lines.length &&
        (BULLET.test(lines[i]) || NUMBERED.test(lines[i]) || isContinuation(lines[i]))
      ) {
        block.push(lines[i])
        i++
      }
      out.push(<Fragment key={key++}>{renderList(block)}</Fragment>)
      continue
    }

    // Paragraph: everything up to the next blank line or block opener.
    const paragraph: string[] = []
    while (i < lines.length && lines[i].trim() && !opensBlock(lines[i])) {
      paragraph.push(lines[i])
      i++
    }

    out.push(
      <p key={key++} className="whitespace-pre-wrap">
        {renderInline(paragraph.join('\n'))}
      </p>,
    )
  }

  return out
}

/** True when a line starts something that is not a paragraph. */
function opensBlock(line: string): boolean {
  return (
    HEADING.test(line) ||
    FENCE.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line)
  )
}

/** An indented line under a list item belongs to that item, not a new block. */
function isContinuation(line: string): boolean {
  return /^\s{2,}\S/.test(line) && !opensBlock(line.trimStart())
}

/* ────────────────────────────────────────────────────────────────────────────
 * Lists
 * ──────────────────────────────────────────────────────────────────────────*/

interface ListItem {
  indent: number
  ordered: boolean
  text: string
  children: string[]
}

/**
 * Build one list, nesting by indentation.
 *
 * Models indent sub-points by two or four spaces with no consistency between
 * them, so the depth is taken from whatever the first item used rather than
 * from a fixed step.
 */
function renderList(lines: string[]): ReactNode {
  const items: ListItem[] = []

  for (const line of lines) {
    const bullet = BULLET.exec(line)
    const numbered = NUMBERED.exec(line)

    if (bullet) {
      items.push({
        indent: bullet[1].length,
        ordered: false,
        text: bullet[2],
        children: [],
      })
    } else if (numbered) {
      items.push({
        indent: numbered[1].length,
        ordered: true,
        text: numbered[3],
        children: [],
      })
    } else if (items.length) {
      // A wrapped line, or a nested block, under the item above it.
      items[items.length - 1].children.push(line.replace(/^\s{0,4}/, ''))
    }
  }

  if (!items.length) return null

  const base = Math.min(...items.map((item) => item.indent))
  return buildLevel(items, base)
}

function buildLevel(items: ListItem[], indent: number): ReactNode {
  const ordered = items[0]?.ordered ?? false

  const nodes: ReactNode[] = []
  let i = 0

  while (i < items.length) {
    const item = items[i]
    i++

    // Everything more indented than this item belongs inside it.
    const nested: ListItem[] = []
    while (i < items.length && items[i].indent > indent) {
      nested.push(items[i])
      i++
    }

    nodes.push(
      <li key={nodes.length} className="pl-1">
        {renderInline(item.text)}
        {item.children.length > 0 && (
          <div className="mt-1 space-y-2">{renderBlocks(item.children.join('\n'))}</div>
        )}
        {nested.length > 0 && (
          <div className="mt-1">{buildLevel(nested, nested[0].indent)}</div>
        )}
      </li>,
    )
  }

  const className = cn(
    'space-y-1.5 pl-5',
    ordered ? 'list-decimal' : 'list-disc',
    'marker:text-ink-faint',
  )

  return ordered ? (
    <ol className={className}>{nodes}</ol>
  ) : (
    <ul className={className}>{nodes}</ul>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 * Tables and code
 * ──────────────────────────────────────────────────────────────────────────*/

function splitRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())
}

function Table({ rows }: { rows: string[] }) {
  const [head, ...body] = rows

  return (
    // Wide tables scroll inside their own box rather than stretching the
    // panel they sit in.
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line bg-raised">
            {splitRow(head).map((cell, i) => (
              <th key={i} className="px-3 py-2 text-left font-medium text-ink">
                {renderInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="border-b border-line last:border-0">
              {splitRow(row).map((cell, c) => (
                <td key={c} className="px-3 py-2 align-top">
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-void">
      {language && (
        <div className="border-b border-line px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          {language}
        </div>
      )}
      <pre className="overflow-x-auto p-3">
        <code className="font-mono text-[12.5px] leading-relaxed text-ink-muted">
          {code}
        </code>
      </pre>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 * Inline
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Code spans come first and are not reprocessed, so `**` inside backticks
 * stays as written. The rest are tried in order of how greedy they are.
 */
const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(~~[^~\n]+~~)|(\*[^*\n]+\*|(?<![A-Za-z0-9])_[^_\n]+_(?![A-Za-z0-9]))|(\[[^\]\n]*\]\([^)\s]+\))/g

/** Only schemes that are safe to put behind a click. */
function safeHref(url: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : null
}

export function renderInline(text: string): ReactNode {
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0

  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0
    if (start > last) nodes.push(text.slice(last, start))

    const [full, code, strong, strike, emphasis, link] = match

    if (code) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-overlay px-1 py-0.5 font-mono text-[12.5px] text-ink"
        >
          {code.slice(1, -1)}
        </code>,
      )
    } else if (strong) {
      nodes.push(
        <strong key={key++} className="font-semibold text-ink">
          {renderInline(strong.slice(2, -2))}
        </strong>,
      )
    } else if (strike) {
      nodes.push(
        <s key={key++} className="text-ink-faint">
          {renderInline(strike.slice(2, -2))}
        </s>,
      )
    } else if (emphasis) {
      nodes.push(
        <em key={key++} className="italic">
          {renderInline(emphasis.slice(1, -1))}
        </em>,
      )
    } else if (link) {
      const split = /^\[([^\]]*)\]\(([^)\s]+)\)$/.exec(link)
      const href = split ? safeHref(split[2]) : null

      // A link the model invented with a scheme we will not follow is shown
      // as its own text rather than silently dropped.
      nodes.push(
        href ? (
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent underline underline-offset-2 hover:text-accent-dim"
          >
            {renderInline(split![1] || href)}
          </a>
        ) : (
          <Fragment key={key++}>{link}</Fragment>
        ),
      )
    }

    last = start + full.length
  }

  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/* ────────────────────────────────────────────────────────────────────────────
 * Previews
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * The same text with its markers taken out.
 *
 * A gallery thumbnail is nine lines tall. Rendering headings and bullets at
 * that size is noise, but leaving `###` and `**` in is worse, so the syntax
 * is stripped and the words are kept.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/^\s*(\d+)[.)]\s+/gm, '$1. ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)\s]+\)/g, '$1')
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
