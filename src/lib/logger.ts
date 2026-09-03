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
      out[key] = isSecret(key) ? '[redacted]' : redact(nested, depth + 1)
    }
    return out
  }

  return String(value)
}

const ESC = '\x1b['
const RESET = `${ESC}0m`
const BOLD = `${ESC}1m`
const DIM = `${ESC}90m`

const COLOURS: Record<LogLevel, string> = {
  debug: `${ESC}90m`,
  info: `${ESC}36m`,
  warn: `${ESC}33m`,
  error: `${ESC}31m`,
}

/** Colour is pointless when the output is a file or a log collector. */
const useColour = () => !isProduction() && process.stdout.isTTY === true

function write(level: LogLevel, scope: string, message: string, context?: LogContext): void {
  if (LEVELS[level] < threshold()) return

  const safe = context ? (redact(context) as LogContext) : undefined
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout

  if (isProduction()) {
    // One line of JSON, so a collector can index the fields.
    stream.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        level,
        scope,
        msg: message,
        ...safe,
      })}\n`,
    )
    return
  }

  const time = new Date().toISOString().slice(11, 23)
  const tail = safe && Object.keys(safe).length ? ` ${formatContext(safe)}` : ''

  if (!useColour()) {
    stream.write(`${level.toUpperCase().padEnd(5)} ${time} [${scope}] ${message}${tail}\n`)
    return
  }

  stream.write(
    `${COLOURS[level]}${level.toUpperCase().padEnd(5)}${RESET} ` +
      `${DIM}${time}${RESET} ${BOLD}${scope}${RESET} ${message}${tail}\n`,
  )
}

/** `key=value` pairs, quoting only what needs it. */
function formatContext(context: LogContext): string {
  const colour = useColour()

  return Object.entries(context)
    .map(([key, value]) => {
      const rendered =
        typeof value === 'string'
          ? /[\s"]/.test(value)
            ? JSON.stringify(value)
            : value
          : typeof value === 'object' && value !== null
            ? JSON.stringify(value)
            : String(value)
      return colour ? `${DIM}${key}=${RESET}${rendered}` : `${key}=${rendered}`
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
