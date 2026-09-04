import { AuthScreen } from '@/components/auth/AuthScreen'
import { KeySetup } from '@/components/onboarding/KeySetup'
import { Studio } from '@/components/studio/Studio'
import { currentUser, signupsAllowed } from '@/lib/auth'
import { ensureBooted } from '@/lib/boot'
import { hasApiKey } from '@/lib/kie/client'

// Reads the session cookie, so this can never be statically cached.
export const dynamic = 'force-dynamic'

/**
 * Entry gate.
 *
 * Three states, resolved on the server so no protected markup is ever sent to
 * a visitor who should not see it:
 *   1. no account   -> sign up / sign in
 *   2. no API key   -> key setup
 *   3. ready        -> the studio
 */
export default async function Page() {
  // Covers the case where a page is loaded before any API route is hit.
  void ensureBooted()

  const user = await currentUser()
  if (!user) return <AuthScreen signupsAllowed={await signupsAllowed()} />

  if (!(await hasApiKey())) return <KeySetup email={user.email} />

  return <Studio />
}
