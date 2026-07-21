import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { TopBar } from '@/components/shell';
import { Footer } from '@/components/footer';
import { FirstRunNotice } from '@/components/first-run-notice';
import { autoScanOnBoot, isFirstRun } from '@/lib/scan/auto';
import { bootstrap } from '@/lib/bootstrap';
import { getAllSettings } from '@/lib/settings';
import { raw } from '@/db/client';

export const metadata: Metadata = {
  title: 'Project Token ROI',
  description: 'Local-first AI development investment and ROI analytics.',
  applicationName: 'Project Token ROI',
  manifest: '/site.webmanifest',
  // favicon.svg is deliberately NOT referenced: it is a ~2 MB traced raster,
  // which is far too heavy for a tab icon. The .ico and PNGs cover every target.
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-96x96.png', type: 'image/png', sizes: '96x96' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = { themeColor: '#08080C', width: 'device-width', initialScale: 1 };
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  bootstrap();
  // Index verified local sources so the app is useful on first load rather
  // than requiring a manual scan. Awaited only when the database is empty.
  await autoScanOnBoot();

  const settings = getAllSettings();
  const showFirstRunNotice = isFirstRun();
  const dataset = settings.dataset ?? 'real';
  const projects = raw()
    .prepare(`SELECT id, name FROM projects WHERE dataset = ? AND archived = 0 ORDER BY name`)
    .all(dataset) as Array<{ id: string; name: string }>;

  const wallpaper = settings['appearance.wallpaper'] ?? 'default';
  const custom = wallpaper !== 'default' && wallpaper !== 'none' ? wallpaper : null;

  return (
    <html lang="en" className="dark">
      <body
        className={[
          'min-h-screen antialiased',
          settings['appearance.compact'] === 'true' ? 'compact' : '',
          settings['appearance.reduceMotion'] === 'true' ? 'reduce-motion' : '',
        ].join(' ')}
        style={
          {
            '--wallpaper-opacity': settings['appearance.wallpaperOpacity'] ?? '0.35',
            '--panel-opacity': settings['appearance.panelOpacity'] ?? '0.94',
            ...(custom ? { '--wallpaper-image': `url("${custom.replace(/"/g, '')}")` } : {}),
          } as React.CSSProperties
        }
      >
        <div
          className={
            wallpaper === 'none'
              ? 'app-backdrop'
              : custom
                ? 'app-backdrop'
                : 'app-backdrop app-backdrop--default'
          }
        />
        <div className="app-veil" />

        <Suspense fallback={<div className="h-12 border-b border-hair" />}>
          <TopBar projects={projects} dataset={dataset} sampleActive={dataset === 'sample'} />
        </Suspense>

        {showFirstRunNotice && <FirstRunNotice />}

        <main className="mx-auto w-full max-w-[1800px] px-3 py-3 sm:px-4 sm:py-4">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
