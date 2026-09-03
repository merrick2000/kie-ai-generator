/**
 * Server logging.
 *
 * Two audiences, one call site. In development a line has to be readable at a
 * glance; in production it has to be parseable by whatever collects Docker
 * output. The same call therefore renders as aligned text locally and as
 * one-line JSON when NODE_ENV is production.
 *
 * Redaction is not optional here. This app handles Kie API keys, passwords
 * and session tokens, and a log file is exactly where they must never appear,
 * so every value is filtered by key name before it is written.
 */

import 'server-only'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** LOG_LEVEL, defaulting to debug in development and info in production. */
function threshold(): number {
  const configured = process.env.LOG_LEVEL?.trim().toLowerCase() as LogLevel | undefined
  if (configured && configured in LEVELS) return LEVELS[configured]
  return process.env.NODE_ENV === 'production' ? LEVELS.info : LEVELS.debug
}

const isProduction = () => process.env.NODE_ENV === 'production'

/**
 * Keys whose values are never written, matched case-insensitively as a
 * substring so `apiKey`, `kie_api_key` and `authorization` are all caught.
 */
const SECRET_KEYS = [
  'password',
  'apikey',
  'token',
  'secret',
  'authorization',
  'cookie',
  'credential',
  'signature',
  'hash',
]

function isSecret(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z]/g, '')
  return SECRET_KEYS.some((secret) => normalised.includes(secret))
}

/** Longest string written for one field, so a 20k prompt cannot flood a log. */
const MAX_STRING = 300

export type LogContext = Record<string, unknown>

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value

  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      // A stack is useful locally and mostly noise in production.
      ...(isProduction() ? {} : { stack: value.stack?.split('\n').slice(0, 4) }),
    }
  }

  // Deeply nested objects are almost always a mistake to log in full.
  if (depth >= 3) return '[nested]'

  if (Array.isArray(value)) {
    return value.length > 10
      ? [...value.slice(0, 10).map((v) => redact(v, depth + 1)), `+${value.length - 10} more`]
      : value.map((v) => redact(v, depth + 1))
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      // A boolean cannot carry a secret, and redacting one destroys the field
      // that was worth logging: `hasSignature=[redacted]` says nothing.
      const secret = isSecret(key) && typeof nested !== 'boolean'
      out[key] = secret ? '[redacted]' : redact(nested, depth + 1)
    }
    return out
  }

  return String(value)
}

const ESC = '\x1b['
const RESET = `${ESC}0m`
const BOLD = `${ESC}1m`
const DIM = `${ESC}2m`
const GREY = `${ESC}90m`

const LEVEL_COLOUR: Record<LogLevel, string> = {
  debug: `${ESC}90m`,
  info: `${ESC}32m`,
  warn: `${ESC}33m`,
  error: `${ESC}31m`,
}

/** Scope gets its own hue so one subsystem can be picked out at a glance. */
const SCOPE_COLOUR: Record<string, string> = {
  http: `${ESC}36m`,
  auth: `${ESC}35m`,
  kie: `${ESC}34m`,
  generate: `${ESC}94m`,
  webhook: `${ESC}95m`,
  db: `${ESC}96m`,
  health: `${ESC}92m`,
  pricing: `${ESC}93m`,
}

/**
 * Whether to emit ANSI colour.
 *
 * Checking `isTTY` alone is wrong in practice: the moment output goes through
 * a file, `docker logs`, or a process manager, it is no longer a TTY and the
 * colour disappears exactly where it was wanted. The standard NO_COLOR and
 * FORCE_COLOR variables take precedence, and production defaults to off
 * because it emits JSON.
 */
function useColour(): boolean {
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR) return process.env.FORCE_COLOR !== '0'
  if (isProduction()) return false
  // Development defaults to colour even without a TTY, since the output is
  // almost always being read by a person.
  return true
}

const paint = (colour: string, text: string): string =>
  useColour() ? `${colour}${text}${RESET}` : text

/** Colour an HTTP status by class, the way an access log does. */
function paintStatus(status: number): string {
  const text = String(status)
  if (!useColour()) return text
  if (status >= 500) return `${ESC}97;41m ${text} ${RESET}`
  if (status >= 400) return `${ESC}30;43m ${text} ${RESET}`
  if (status >= 300) return `${ESC}36m${text}${RESET}`
  return `${ESC}30;42m ${text} ${RESET}`
}

const METHOD_WIDTH = 6
const SCOPE_WIDTH = 9
const LEVEL_WIDTH = 5

/**
 * Separate an error's stack from the fields printed on the main line.
 *
 * The message stays inline, since that is what identifies the failure; the
 * frames go underneath where they can be skimmed or ignored.
 */
function splitStack(context?: LogContext): { fields?: LogContext; stack: string[] } {
  if (!context) return { fields: context, stack: [] }

  const error = context.error
  if (!error || typeof error !== 'object') return { fields: context, stack: [] }

  const { stack, message, name } = error as { stack?: unknown; message?: string; name?: string }
  if (!Array.isArray(stack)) return { fields: context, stack: [] }

  return {
    fields: {
      ...context,
      // Collapsed to the one line that names the failure.
      error: [name, message].filter(Boolean).join(': ') || 'Error',
    },
    // The first frame repeats the message, which is already on the line above.
    stack: stack.slice(1).map(String),
  }
}

/**
 * Render one line.
 *
 * Columns are fixed width so the eye can scan straight down a busy console:
 *
 *   date time  LEVEL  scope     message                     key=value
 */
function write(level: LogLevel, scope: string, message: string, context?: LogContext): void {
  if (LEVELS[level] < threshold()) return

  const safe = context ? (redact(context) as LogContext) : undefined
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout

  if (isProduction()) {
    // One line of JSON, so a collector can index the fields.
    stream.write(
      `${JSON.stringify(
        { ts: new Date().toISOString(), level, scope, msg: message, ...safe },
        // JSON.stringify already drops undefined values in objects; this
        // replacer keeps that behaviour explicit alongside the text path.
        (_key, value) => (value === undefined ? undefined : value),
      )}\n`,
    )
    return
  }

  // Full date, not just the time: a server log read the next morning needs it.
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 23)

  // A stack crammed into the key=value tail as JSON is unreadable, so it is
  // lifted out and printed underneath instead.
  const { fields, stack } = splitStack(safe)

  const parts = [
    paint(GREY, stamp),
    paint(LEVEL_COLOUR[level], level.toUpperCase().padEnd(LEVEL_WIDTH)),
    paint(SCOPE_COLOUR[scope] ?? GREY, scope.padEnd(SCOPE_WIDTH)),
    formatMessage(scope, message, fields),
  ]

  stream.write(`${parts.join(' ')}\n`)

  if (stack.length) {
    const indent = ' '.repeat(stamp.length + LEVEL_WIDTH + 2)
    for (const frame of stack) {
      stream.write(`${indent}${paint(GREY, frame.trim())}\n`)
    }
  }
}

/**
 * Requests read as an access log; everything else as a message plus fields.
 *
 * An HTTP line buried its method, status and path among the trailing
 * key=value pairs, which is where they are least visible and most wanted.
 */
function formatMessage(
  scope: string,
  message: string,
  context?: LogContext,
): string {
  if (scope !== 'http' || !context?.method || !context?.path) {
    const tail = context && Object.keys(context).length ? ` ${formatContext(context)}` : ''
    return `${message}${tail}`
  }

  const { method, path, status, ms, ...rest } = context
  const columns = [
    paint(BOLD, String(method).padEnd(METHOD_WIDTH)),
    typeof status === 'number' ? paintStatus(status) : '',
    String(path),
  ]

  if (typeof ms === 'number') {
    // Slow requests are the ones worth spotting, so the duration is
    // highlighted rather than dimmed once it gets long.
    const rendered = `${ms}ms`
    columns.push(ms >= 1000 ? paint(LEVEL_COLOUR.warn, rendered) : paint(DIM, rendered))
  }

  const extra = Object.keys(rest).length ? ` ${formatContext(rest)}` : ''
  return `${columns.filter(Boolean).join(' ')}${extra}`
}

/** `key=value` pairs, quoting only what needs it. */
function formatContext(context: LogContext): string {
  return Object.entries(context)
    // A field that was never set is noise. `null` is kept, since it says the
    // value was looked for and found absent, which is often the diagnosis.
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      const rendered =
        typeof value === 'string'
          ? /[\s"]/.test(value)
            ? JSON.stringify(value)
            : value
          : typeof value === 'object' && value !== null
            ? JSON.stringify(value)
            : String(value)
      return `${paint(GREY, `${key}=`)}${rendered}`
    })
    .join(' ')
}

export interface Logger {
  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, context?: LogContext): void
  /** A logger that carries extra fields on every line it writes. */
  child(context: LogContext): Logger
}

/**
 * A logger for one area of the app.
 *
 * The scope is what makes a log greppable: `auth`, `kie`, `webhook`.
 */
export function createLogger(scope: string, base: LogContext = {}): Logger {
  const merge = (context?: LogContext) =>
    Object.keys(base).length ? { ...base, ...context } : context

  return {
    debug: (message, context) => write('debug', scope, message, merge(context)),
    info: (message, context) => write('info', scope, message, merge(context)),
    warn: (message, context) => write('warn', scope, message, merge(context)),
    error: (message, context) => write('error', scope, message, merge(context)),
    child: (context) => createLogger(scope, { ...base, ...context }),
  }
}

/** Milliseconds since a start mark, for duration fields. */
export function since(startedAt: number): number {
  return Date.now() - startedAt
}

/** Exported for tests, which assert that secrets never reach a log line. */
export const __internal = { redact, isSecret }
