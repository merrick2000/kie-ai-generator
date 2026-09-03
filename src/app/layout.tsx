import type { Metadata, Viewport } from 'next'
import { Toaster } from 'sonner'

import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'Highfield, an AI generation studio',
  description:
    'A complete studio for image, video and audio generation across 45 models, powered by the Kie.ai API.',
}

export const viewport: Viewport = {
  themeColor: '#07070a',
  width: 'device-width',
  initialScale: 1,
  // The composer and viewer are full-height panes; let them own the viewport.
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      {/*
        No height or overflow constraint here: this layout is shared by the
        studio, which fills the viewport and scrolls internally, and by the
        blog, which is a normal document that has to scroll. Pinning the body
        to the viewport froze every article page.
      */}
      <body className="antialiased">
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'var(--color-overlay)',
              border: '1px solid var(--color-line-bright)',
              color: 'var(--color-ink)',
            },
          }}
        />
      </body>
    </html>
  )
}
