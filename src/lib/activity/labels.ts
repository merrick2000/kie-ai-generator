/**
 * Plain wording for an event kind.
 *
 * Deliberately free of `server-only`: the admin table names the last action a
 * user took and the feed names every one of them, so both halves need this and
 * one of them runs in the browser.
 */

export function labelFor(kind: string): string {
  switch (kind) {
    case 'signup':
      return 'created the account'
    case 'signup_blocked':
      return 'tried to sign up with a taken email'
    case 'signin':
      return 'signed in'
    case 'signin_failed':
      return 'failed to sign in'
    case 'signout':
      return 'signed out'
    case 'password_changed':
      return 'changed their password'
    case 'api_key_set':
      return 'set a Kie key'
    case 'api_key_cleared':
      return 'removed their Kie key'
    case 'project_created':
      return 'created a project'
    case 'project_deleted':
      return 'deleted a project'
    case 'history_imported':
      return 'imported history'
    case 'history_cleared':
      return 'cleared history'
    default:
      return kind.replace(/_/g, ' ')
  }
}

/** Kinds that deserve to stand out in the feed rather than blend into it. */
export function toneFor(kind: string): 'normal' | 'good' | 'warn' {
  switch (kind) {
    case 'signup':
      return 'good'
    case 'signin_failed':
    case 'signup_blocked':
    case 'history_cleared':
    case 'project_deleted':
      return 'warn'
    default:
      return 'normal'
  }
}
