/** Shared date formatting so the list and the article page never disagree. */
export function formatArticleDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
