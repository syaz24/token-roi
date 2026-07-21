'use client';

/**
 * Page transition.
 *
 * `template.tsx` (unlike `layout.tsx`) remounts on every navigation, so the
 * enter animation replays for each page without any router plumbing.
 *
 * This is a CSS animation rather than a JS one on purpose: the resting state is
 * fully visible and the keyframes only animate INTO it, so if animation is
 * disabled, throttled, or the tab is backgrounded, content still renders
 * normally instead of being stuck invisible. It also picks up the app's
 * "Reduce motion" setting for free.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
