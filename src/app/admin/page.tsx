import { notFound } from 'next/navigation'

import { AdminDashboard } from '@/components/admin/AdminDashboard'
import { isAdmin } from '@/lib/admin'
import { currentUser } from '@/lib/auth'
import { ensureBooted } from '@/lib/boot'

// Reads the session cookie, so it can never be statically cached.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Admin, Highfield',
  // The page is for one person and has nothing to gain from being indexed.
  robots: { index: false, follow: false },
}

/**
 * The admin surface.
 *
 * `notFound()` rather than a redirect or a refusal, for anyone who is not the
 * admin: someone who is signed in but not the owner has no business learning
 * that this route exists, and every other answer tells them it does. The API
 * routes behind it refuse the same way, so guessing the endpoints directly
 * gets no further than guessing the page.
 */
export default async function AdminPage() {
  void ensureBooted()

  const user = await currentUser()
  if (!user) notFound()
  if (!(await isAdmin(user))) notFound()

  return <AdminDashboard email={user.email} />
}
