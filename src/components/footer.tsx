import { Heart } from 'lucide-react';

/**
 * The two links here are plain anchors. Nothing is requested from either domain
 * while the app is running — a network call only ever happens if you click one.
 */
export function Footer() {
  return (
    <footer className="mx-auto mt-6 w-full max-w-[1800px] px-3 pb-5 sm:px-4">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-hair pt-4 text-[11px] text-ink3">
        <span className="inline-flex items-center gap-1.5">
          Made with
          <Heart size={10} className="text-neg" fill="currentColor" aria-label="love" />
          by
          <a
            href="https://www.threads.com/@remisiersyazwan"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink2 underline decoration-hair underline-offset-2 transition-colors hover:text-ink hover:decoration-hairStrong"
          >
            @RemisierSyazwan
          </a>
        </span>

        <span aria-hidden className="text-ink3/50">
          |
        </span>

        <a
          href="https://github.com/syaz24/token-roi"
          target="_blank"
          rel="noopener noreferrer"
          className="text-ink2 underline decoration-hair underline-offset-2 transition-colors hover:text-ink hover:decoration-hairStrong"
        >
          Open source
        </a>
      </div>
    </footer>
  );
}
