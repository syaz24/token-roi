'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Boxes,
  ChevronDown,
  Coins,
  Cpu,
  Database,
  LayoutDashboard,
  Lightbulb,
  Menu,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  TrendingUp,
  Waypoints,
  X,
} from 'lucide-react';
import { Badge, Button, cn, Select } from './ui';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: Boxes },
  { href: '/sessions', label: 'Sessions', icon: Waypoints },
  { href: '/insights', label: 'Insights', icon: Lightbulb },
  { href: '/models', label: 'Models', icon: Cpu },
  { href: '/costs', label: 'Costs', icon: Coins },
  { href: '/roi', label: 'ROI', icon: TrendingUp },
  { href: '/sources', label: 'Data Sources', icon: Database },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
];

/** Product mark. Served from /public, so nothing is fetched off-machine. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <Image
      src="/favicon-96x96.png"
      alt=""
      width={size}
      height={size}
      priority
      className="rounded-[5px]"
    />
  );
}

export interface ShellProject {
  id: string;
  name: string;
}

export function TopBar({
  projects,
  dataset,
  sampleActive,
}: {
  projects: ShellProject[];
  dataset: string;
  sampleActive: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [busy, setBusy] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [q, setQ] = React.useState(sp.get('q') ?? '');

  const setParam = React.useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(sp.toString());
      if (value == null || value === '') next.delete(key);
      else next.set(key, value);
      router.push(`${pathname}?${next.toString()}`);
    },
    [pathname, router, sp],
  );

  const range = sp.get('range') ?? '30d';
  const basis = sp.get('basis') ?? 'api_equivalent';
  const project = sp.get('project') ?? '';

  async function refresh() {
    setBusy(true);
    try {
      await fetch('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/sessions?q=${encodeURIComponent(q)}`);
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-hair bg-[rgba(10,10,14,0.86)] backdrop-blur-md">
        <div className="flex h-12 items-center gap-3 px-3 sm:px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <Logo />
            <span className="hidden text-[12.5px] font-semibold tracking-tight text-ink sm:inline">
              Project Token ROI
            </span>
          </Link>

          {sampleActive && (
            <Badge tone="warn" className="shrink-0">
              SAMPLE DATA
            </Badge>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <form onSubmit={submitSearch} className="relative hidden md:block">
              <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search sessions, models, prompts…"
                className="h-7 w-56 rounded-md border border-hair bg-black/30 pl-6 pr-2 text-[11px] text-ink placeholder:text-ink3 focus:border-hairStrong focus:outline-none lg:w-64"
              />
            </form>

            <Select
              value={project}
              onChange={(e) => setParam('project', e.target.value || null)}
              title="Global project filter"
              className="hidden max-w-[150px] sm:block"
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>

            <Select value={range} onChange={(e) => setParam('range', e.target.value)} title="Date range">
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="90d">90 days</option>
              <option value="180d">180 days</option>
              <option value="365d">1 year</option>
              <option value="all">All time</option>
            </Select>

            <Select
              value={basis}
              onChange={(e) => setParam('basis', e.target.value)}
              title="Cost basis used by every ROI figure"
              className="hidden lg:block"
            >
              <option value="api_equivalent">API Equivalent</option>
              <option value="allocated_cash">Allocated Cash</option>
              <option value="blended">Blended</option>
            </Select>

            <Button onClick={refresh} disabled={busy} title="Scan sources and re-index">
              <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{busy ? 'Indexing…' : 'Refresh'}</span>
            </Button>

            <Link href="/settings" className="hidden sm:block">
              <Button variant="ghost" title="Settings">
                <SettingsIcon size={12} />
              </Button>
            </Link>

            <Button variant="ghost" className="lg:hidden" onClick={() => setMenuOpen((v) => !v)}>
              {menuOpen ? <X size={13} /> : <Menu size={13} />}
            </Button>
          </div>
        </div>

        <NavRow open={menuOpen} onNavigate={() => setMenuOpen(false)} basis={basis} range={range} project={project} />
      </header>
    </>
  );
}

function NavRow({
  open,
  onNavigate,
  basis,
  range,
  project,
}: {
  open: boolean;
  onNavigate: () => void;
  basis: string;
  range: string;
  project: string;
}) {
  const pathname = usePathname();
  const qs = new URLSearchParams();
  if (basis !== 'api_equivalent') qs.set('basis', basis);
  if (range !== '30d') qs.set('range', range);
  if (project) qs.set('project', project);
  const suffix = qs.toString() ? `?${qs}` : '';

  return (
    <nav
      className={cn(
        'border-t border-hair px-2 lg:px-3',
        open ? 'block' : 'hidden lg:block',
      )}
    >
      <ul className="flex flex-wrap items-center gap-0.5 py-1 lg:flex-nowrap lg:gap-1">
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={`${item.href}${suffix}`}
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-medium transition-colors',
                  active ? 'bg-white/[0.07] text-ink' : 'text-ink3 hover:bg-white/[0.04] hover:text-ink2',
                )}
              >
                <Icon size={12.5} className={active ? 'text-roi' : ''} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  right,
}: {
  title: string;
  description?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-0.5 max-w-2xl text-[11.5px] leading-relaxed text-ink3">{description}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-1.5">{right}</div>}
    </div>
  );
}
