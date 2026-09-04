/**
 * Project accent colours.
 *
 * A separate module because the server validates against this list and the
 * browser paints with it, and the store that does the validating is
 * server-only. Hex rather than Tailwind class names: the classes would have
 * to be spelled out somewhere for the compiler to keep them, and a swatch is
 * the one place a raw value is clearer than a token.
 */

export const PROJECT_COLORS = [
  'amber',
  'blue',
  'emerald',
  'violet',
  'rose',
  'cyan',
  'slate',
] as const

export type ProjectColor = (typeof PROJECT_COLORS)[number]

export const PROJECT_COLOR_HEX: Record<ProjectColor, string> = {
  amber: '#f0b429',
  blue: '#5b8def',
  emerald: '#34d399',
  violet: '#a78bfa',
  rose: '#fb7185',
  cyan: '#22d3ee',
  slate: '#94a3b8',
}

/** The dot beside a project's name. Falls back to the neutral tone. */
export function colorOf(color: string | null | undefined): string {
  return PROJECT_COLOR_HEX[(color ?? 'slate') as ProjectColor] ?? PROJECT_COLOR_HEX.slate
}
