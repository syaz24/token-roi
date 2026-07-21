'use client';

import * as React from 'react';
import Link from 'next/link';
import { Check, ChevronDown, Info } from 'lucide-react';

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Panel({
  title,
  subtitle,
  right,
  children,
  className,
  dotted = true,
  bodyClassName,
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  dotted?: boolean;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('panel', dotted && 'panel-dotted', 'flex min-w-0 flex-col', className)}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-hair px-3.5 py-2.5">
          <div className="min-w-0">
            {title && <h2 className="label-xs truncate">{title}</h2>}
            {subtitle && <p className="mt-0.5 truncate text-[11px] text-ink3">{subtitle}</p>}
          </div>
          {right && <div className="flex shrink-0 items-center gap-1.5">{right}</div>}
        </header>
      )}
      <div className={cn('relative min-w-0 flex-1 p-3.5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Tip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <Info size={11} className="text-ink3 transition-colors group-hover:text-ink2" />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-60 max-w-[70vw] -translate-x-1/2 rounded-lg border border-hairStrong bg-[rgba(12,12,16,0.98)] p-2.5 text-[11px] leading-relaxed text-ink2 opacity-0 shadow-2xl transition-opacity group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'pos' | 'neg' | 'warn' | 'info' | 'roi';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'border-hair text-ink3',
    pos: 'border-pos/30 text-pos bg-pos/10',
    neg: 'border-neg/30 text-neg bg-neg/10',
    warn: 'border-warn/30 text-warn bg-warn/10',
    info: 'border-info/30 text-info bg-info/10',
    roi: 'border-roi/30 text-roi bg-roi/10',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="text-[11px] text-ink3">no prior period</span>;
  }
  const good = invert ? value < 0 : value > 0;
  const flat = Math.abs(value) < 0.05;
  return (
    <span
      className={cn(
        'num text-[11px] font-medium',
        flat ? 'text-ink3' : good ? 'text-pos' : 'text-neg',
      )}
    >
      {flat ? '±0.0%' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`}
    </span>
  );
}

/** Compact inline sparkline. Pure SVG, no chart library needed. */
export function Sparkline({
  data,
  className,
  stroke = 'rgba(244,244,245,0.55)',
}: {
  data: number[];
  className?: string;
  stroke?: string;
}) {
  if (!data.length) return <div className={cn('h-6', className)} />;
  const w = 100;
  const h = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = data.length === 1 ? w : (i / (data.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 3) - 1.5;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const id = React.useId();
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn('h-6 w-full', className)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill={`url(#${id})`} />
      <polyline points={pts.join(' ')} fill="none" stroke={stroke} strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function MetricCard({
  label,
  value,
  delta,
  invertDelta,
  spark,
  tone,
  tooltip,
  footnote,
  warning,
  exact,
  href,
}: {
  label: string;
  value: string;
  delta?: number | null;
  invertDelta?: boolean;
  spark?: number[];
  tone?: 'pos' | 'neg' | 'roi' | 'info' | 'neutral';
  tooltip?: string;
  footnote?: string;
  warning?: string;
  /** Full precision, thousand-separated. Shown on hover when the headline is
   *  abbreviated (e.g. "5.7B"), so the exact figure is always reachable. */
  exact?: string;
  /** Makes the whole card a link to the page that explains this number. */
  href?: string;
}) {
  const toneClass =
    tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : tone === 'roi' ? 'text-roi' : 'text-ink';

  const card = (
    <div
      className={cn(
        'panel panel-dotted panel-hover flex min-w-0 flex-col justify-between gap-2 p-3',
        href && 'cursor-pointer transition-transform duration-150 hover:-translate-y-px',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="label-xs flex items-center gap-1 truncate">
          {label}
          {tooltip && <Tip text={tooltip} />}
        </span>
        {delta !== undefined && <Delta value={delta ?? null} invert={invertDelta} />}
      </div>
      {/* leading-none clipped descenders (a "g" read as "q") because `truncate`
          sets overflow:hidden. Give the line box room, and step the size down
          for long text values such as model identifiers so they still fit. */}
      <div
        className={cn('metric truncate pb-0.5 leading-[1.22]', metricSize(value), toneClass)}
        title={exact ?? value}
      >
        {value}
      </div>
      {exact && exact !== value && (
        <span className="num truncate text-[10px] text-ink3">{exact}</span>
      )}
      {spark && spark.length > 1 ? (
        <Sparkline
          data={spark}
          stroke={tone === 'pos' ? 'var(--pos)' : tone === 'neg' ? 'var(--neg)' : tone === 'roi' ? 'var(--roi)' : 'rgba(244,244,245,0.5)'}
        />
      ) : (
        <div className="h-6" />
      )}
      {warning ? (
        <p className="truncate text-[10px] text-warn" title={warning}>
          {warning}
        </p>
      ) : footnote ? (
        <p className="truncate text-[10px] text-ink3">{footnote}</p>
      ) : (
        <div className="h-3.5" />
      )}
    </div>
  );

  if (!href) return card;
  return (
    <Link href={href} className="block min-w-0 focus-visible:rounded-[10px]" aria-label={`${label} — open details`}>
      {card}
    </Link>
  );
}

/** Numbers stay large; long identifiers step down so they are not truncated. */
function metricSize(value: string): string {
  const n = value.length;
  if (n <= 9) return 'text-[26px]';
  if (n <= 13) return 'text-[21px]';
  if (n <= 18) return 'text-[17px]';
  return 'text-[15px]';
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="text-[13px] text-ink2">{title}</p>
      {hint && <p className="max-w-md text-[11px] leading-relaxed text-ink3">{hint}</p>}
      {action}
    </div>
  );
}

export function Button({
  children,
  variant = 'default',
  size = 'sm',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'xs';
}) {
  const variants: Record<string, string> = {
    default: 'border-hair bg-white/[0.03] text-ink2 hover:border-hairStrong hover:text-ink',
    primary: 'border-roi/40 bg-roi/15 text-roi hover:bg-roi/25',
    ghost: 'border-transparent text-ink3 hover:text-ink hover:bg-white/[0.04]',
    danger: 'border-neg/30 bg-neg/10 text-neg hover:bg-neg/20',
  };
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        size === 'xs' ? 'h-6 px-2 text-[10px]' : 'h-7 px-2.5 text-[11px]',
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'h-7 w-full rounded-md border border-hair bg-black/30 px-2 text-[11px] text-ink placeholder:text-ink3 focus:border-hairStrong focus:outline-none',
        props.className,
      )}
    />
  );
}

interface Opt {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Read <option> children so this stays a drop-in replacement for <select>. */
function readOptions(children: React.ReactNode): Opt[] {
  const out: Opt[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === 'option') {
      const p = child.props as React.OptionHTMLAttributes<HTMLOptionElement> & { children?: React.ReactNode };
      const label = typeof p.children === 'string' ? p.children : String(p.children ?? '');
      out.push({ value: String(p.value ?? label), label, disabled: p.disabled });
    } else if ((child.props as any)?.children) {
      out.push(...readOptions((child.props as any).children));
    }
  });
  return out;
}

/**
 * Custom listbox replacing the native <select>.
 *
 * A native select's popup is drawn by the OS: its options cannot be themed and
 * it cannot be animated, which left the dark UI with unreadable grey-on-grey
 * menus. This renders the list ourselves so it matches the panel treatment and
 * can fade in.
 *
 * API-compatible with the previous <select> wrapper — supports `name` (via a
 * hidden input so FormData still works), controlled `value` + `onChange`, and
 * uncontrolled `defaultValue`. `onChange` receives an object shaped like a
 * change event, so existing `e.target.value` call sites are unchanged.
 */
export function Select({
  name,
  value,
  defaultValue,
  onChange,
  children,
  className,
  disabled,
  title,
  id,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: { target: { value: string; name: string } }) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
  id?: string;
}) {
  const options = React.useMemo(() => readOptions(children), [children]);
  const controlled = value !== undefined;
  const [internal, setInternal] = React.useState(defaultValue ?? options[0]?.value ?? '');
  const current = controlled ? value! : internal;

  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [dropUp, setDropUp] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const typeahead = React.useRef({ buffer: '', at: 0 });

  const selected = options.find((o) => o.value === current);
  const labelId = React.useId();

  const commit = React.useCallback(
    (v: string) => {
      if (!controlled) setInternal(v);
      onChange?.({ target: { value: v, name: name ?? '' } });
      setOpen(false);
    },
    [controlled, name, onChange],
  );

  // Open flush against the trigger, flipping upward near the viewport bottom.
  const openList = React.useCallback(() => {
    if (disabled) return;
    const r = rootRef.current?.getBoundingClientRect();
    if (r) setDropUp(window.innerHeight - r.bottom < 240 && r.top > 240);
    setActive(Math.max(0, options.findIndex((o) => o.value === current)));
    setOpen(true);
  }, [current, disabled, options]);

  React.useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };

    // A scroll would detach the list from its trigger, so we close on it — but
    // ONLY once the trigger has actually moved. Opening a control often comes
    // right after a scroll-into-view (or trailing momentum scroll), and those
    // stray events would otherwise slam the menu shut the instant it opened.
    const openTop = rootRef.current?.getBoundingClientRect().top ?? 0;
    const onScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return; // scrolling the list itself
      const now = rootRef.current?.getBoundingClientRect().top ?? 0;
      if (Math.abs(now - openTop) > 4) setOpen(false);
    };
    const onResize = () => setOpen(false);

    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('scroll', onScroll, true);
      // This was previously never removed, leaking a listener on every open.
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  React.useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    const step = (dir: number) => {
      e.preventDefault();
      if (!open) return openList();
      let i = active;
      for (let n = 0; n < options.length; n++) {
        i = (i + dir + options.length) % options.length;
        if (!options[i]?.disabled) break;
      }
      setActive(i);
    };

    switch (e.key) {
      case 'ArrowDown':
        return step(1);
      case 'ArrowUp':
        return step(-1);
      case 'Home':
        e.preventDefault();
        return setActive(0);
      case 'End':
        e.preventDefault();
        return setActive(options.length - 1);
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!open) return openList();
        if (options[active] && !options[active].disabled) commit(options[active].value);
        return;
      case 'Escape':
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        return;
      case 'Tab':
        setOpen(false);
        return;
      default:
        // Type-ahead: jump to the first option starting with what you typed.
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const now = Date.now();
          const t = typeahead.current;
          t.buffer = now - t.at > 700 ? e.key : t.buffer + e.key;
          t.at = now;
          const idx = options.findIndex(
            (o) => !o.disabled && o.label.toLowerCase().startsWith(t.buffer.toLowerCase()),
          );
          if (idx >= 0) {
            setActive(idx);
            if (!open) commit(options[idx].value);
          }
        }
    }
  }

  return (
    // inline-block so it shrink-wraps in flex toolbars exactly like the native
    // <select> did, while `w-full` from callers still overrides it.
    <div ref={rootRef} className={cn('relative inline-block min-w-[90px] align-middle', className)}>
      {name && <input type="hidden" name={name} value={current} />}

      <button
        type="button"
        id={id}
        title={title}
        // Stable hook for tests and for targeting a control whose visible
        // label changes as the selection changes.
        data-select={name ?? undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelId}
        className={cn(
          'flex h-7 w-full items-center justify-between gap-1.5 rounded-md border bg-black/40 px-2 text-[11px] transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-40',
          open ? 'border-hairStrong text-ink' : 'border-hair text-ink2 hover:border-hairStrong hover:text-ink',
        )}
      >
        <span id={labelId} className="truncate">
          {selected?.label ?? ''}
        </span>
        <ChevronDown
          size={11}
          className={cn('shrink-0 text-ink3 transition-transform duration-150', open && 'rotate-180')}
        />
      </button>

      {open && (
          <ul
            ref={listRef}
            role="listbox"
            className={cn(
              'select-menu absolute z-[60] max-h-60 min-w-full overflow-y-auto rounded-md border border-hairStrong p-1',
              'bg-[rgba(20,20,26,0.98)] shadow-[0_20px_44px_-20px_rgba(0,0,0,0.95)] backdrop-blur-sm',
              dropUp ? 'select-menu--up bottom-full mb-1' : 'top-full mt-1',
            )}
          >
            {options.map((o, i) => {
              const isSelected = o.value === current;
              return (
                <li
                  key={`${o.value}-${i}`}
                  // Tiny cascade so the list reads as a sweep, capped so a long
                  // model list never feels sluggish.
                  style={{ animationDelay: `${Math.min(i, 8) * 14}ms` }}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-active={i === active}
                    disabled={o.disabled}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => commit(o.value)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 whitespace-nowrap rounded px-2 py-1 text-left text-[11px] transition-colors',
                      o.disabled && 'cursor-not-allowed opacity-35',
                      i === active && !o.disabled ? 'bg-white/[0.09] text-ink' : 'text-ink2',
                      isSelected && 'font-medium text-ink',
                    )}
                  >
                    <span className="truncate">{o.label}</span>
                    {isSelected && <Check size={10} className="shrink-0 text-roi" />}
                  </button>
                </li>
              );
            })}
            {!options.length && <li className="px-2 py-1 text-[11px] text-ink3">No options</li>}
          </ul>
        )}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label-xs">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-ink3">{hint}</span>}
    </label>
  );
}

/** Segmented horizontal bar used for cost-allocation breakdowns. */
export function SegmentBar({
  segments,
  className,
}: {
  segments: Array<{ value: number; color: string; label: string }>;
  className?: string;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return <div className={cn('h-1.5 rounded-full bg-white/5', className)} />;
  return (
    <div className={cn('flex h-1.5 w-full overflow-hidden rounded-full bg-white/5', className)}>
      {segments.map((s, i) => (
        <div
          key={i}
          title={`${s.label}: ${((s.value / total) * 100).toFixed(1)}%`}
          style={{ width: `${(Math.max(0, s.value) / total) * 100}%`, background: s.color }}
        />
      ))}
    </div>
  );
}

export const CHART_COLORS = {
  input: '#60A5FA',
  output: '#A78BFA',
  cacheRead: '#22D3EE',
  cacheWrite: '#FB923C',
  reasoning: '#34D399',
  cost: '#F4F4F5',
  value: '#34D399',
  neg: '#F87171',
};

export const SERIES_PALETTE = [
  '#A78BFA',
  '#22D3EE',
  '#34D399',
  '#FB923C',
  '#60A5FA',
  '#F472B6',
  '#FBBF24',
  '#94A3B8',
];
