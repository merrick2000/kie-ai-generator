/**
 * Database abstraction.
 *
 * Postgres only. An earlier build also supported SQLite, which was dropped
 * because carrying two dialects made every query the intersection of both for
 * no operational gain: any deployment worth running needs Postgres anyway.
 *
 * SQL is written with `?` placeholders and rewritten to `$1, $2, …` by the
 * client. That keeps parameters positional without hand-renumbering them
 * whenever a clause moves.
 */

export type SqlValue = string | number | boolean | null

export interface DatabaseClient {
  /** Rows from a SELECT. */
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>
  /** First row, or null. */
  get<T>(sql: string, params?: SqlValue[]): Promise<T | null>
  /** INSERT / UPDATE / DELETE. */
  run(sql: string, params?: SqlValue[]): Promise<void>
  /**
   * Run a unit of work atomically. Statements inside share one connection, so
   * a read-then-write cannot interleave with another request.
   */
  transaction<T>(fn: (tx: DatabaseClient) => Promise<T>): Promise<T>
  close(): Promise<void>
}
