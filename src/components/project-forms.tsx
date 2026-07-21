'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FolderSearch, XCircle } from 'lucide-react';
import { Button, Field, Input, Panel, Select } from './ui';
import { createProject, getHomeDir, resolveFolderName, validatePath } from '@/app/actions';

const RECENT_KEY = 'token-roi.recent-folders';

export function AddProjectForm({ homeDir }: { homeDir?: string }) {
  const router = useRouter();
  const [pathValue, setPathValue] = React.useState('');
  const [check, setCheck] = React.useState<{ ok: boolean; message: string; gitRoot: string | null } | null>(null);
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [recent, setRecent] = React.useState<string[]>([]);
  // The real home directory, so examples and picker results use your actual
  // username rather than a placeholder that can never resolve. Rendered on the
  // server so the correct example is present on first paint.
  const [home, setHome] = React.useState<string | null>(homeDir ?? null);

  React.useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'));
    } catch {
      setRecent([]);
    }
    if (!homeDir) getHomeDir().then(setHome).catch(() => setHome(null));
  }, [homeDir]);

  const example = home ? `${home}\\my-project` : 'C:\\Users\\<you>\\my-project';

  // Debounced validation so typing a long path doesn't hammer the server.
  React.useEffect(() => {
    if (!pathValue.trim()) {
      setCheck(null);
      return;
    }
    const t = setTimeout(async () => {
      const r = await validatePath(pathValue);
      setCheck({ ok: r.ok, message: r.message, gitRoot: r.gitRoot });
    }, 350);
    return () => clearTimeout(t);
  }, [pathValue]);

  /**
   * Native folder picker. Browsers cannot reveal a real absolute path, so we
   * use it only to capture the folder NAME and then ask the user to confirm
   * the absolute path. The path is never passed to a shell.
   */
  async function browse() {
    const anyWindow = window as any;
    if (anyWindow.showDirectoryPicker) {
      try {
        const handle = await anyWindow.showDirectoryPicker();
        await applyPickedFolder(handle.name);
        return;
      } catch {
        return; // user cancelled
      }
    }
    document.getElementById('dir-input')?.click();
  }

  /** Turn a picked folder NAME into a real path that exists on this machine. */
  async function applyPickedFolder(name: string) {
    const r = await resolveFolderName(name);
    setPathValue(r.path);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData(e.currentTarget);
      const r = await createProject(fd);
      setResult(r);
      if (r.ok) {
        const next = [pathValue, ...recent.filter((x) => x !== pathValue)].slice(0, 6);
        setRecent(next);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
        e.currentTarget.reset();
        setPathValue('');
        setCheck(null);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Add a Project" subtitle="Only folders you register here are analysed">
      <form onSubmit={onSubmit} className="space-y-2.5">
        <Field label="Project name">
          <Input name="name" required placeholder="Atlas Ledger" maxLength={120} />
        </Field>

        <Field label="Absolute folder path" hint={`Example: ${example}`}>
          <div className="flex gap-1.5">
            <Input
              name="path"
              required
              value={pathValue}
              onChange={(e) => setPathValue(e.target.value)}
              placeholder={example}
              spellCheck={false}
            />
            <Button type="button" onClick={browse} title="Browse for a folder">
              <FolderSearch size={11} />
            </Button>
          </div>
        </Field>

        <input
          id="dir-input"
          type="file"
          className="hidden"
          // @ts-expect-error non-standard but widely supported directory picker
          webkitdirectory=""
          onChange={(e) => {
            const file = e.target.files?.[0] as (File & { webkitRelativePath?: string }) | undefined;
            const folder = file?.webkitRelativePath?.split('/')[0];
            if (folder) void applyPickedFolder(folder);
          }}
        />

        {check && (
          <p className={`flex items-start gap-1.5 text-[10.5px] ${check.ok ? 'text-pos' : 'text-neg'}`}>
            {check.ok ? <CheckCircle2 size={11} className="mt-px shrink-0" /> : <XCircle size={11} className="mt-px shrink-0" />}
            <span>{check.message}</span>
          </p>
        )}

        {recent.length > 0 && (
          <div>
            <span className="label-xs">Recently used</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {recent.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setPathValue(r)}
                  className="mono max-w-full truncate rounded border border-hair px-1.5 py-0.5 text-[10px] text-ink3 hover:border-hairStrong hover:text-ink2"
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label="Category">
            <Input name="category" placeholder="SaaS, Client work…" />
          </Field>
          <Field label="Status">
            <Select name="status" defaultValue="active" className="w-full">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="shipped">Shipped</option>
              <option value="archived">Archived</option>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Date started">
            <Input name="startedAt" type="date" />
          </Field>
          <Field label="Currency">
            <Select name="currency" defaultValue="USD" className="w-full">
              <option value="USD">USD</option>
              <option value="MYR">MYR</option>
            </Select>
          </Field>
        </div>

        <Field label="Value method">
          <Select name="valueMethod" defaultValue="manual" className="w-full">
            <option value="manual">Manual entries</option>
            <option value="revenue">Realised revenue</option>
            <option value="savings">Cost savings</option>
            <option value="hours">Hours saved</option>
          </Select>
        </Field>

        <Field label="Tags" hint="Comma separated">
          <Input name="tags" placeholder="production, revenue" />
        </Field>

        <Field label="Description">
          <Input name="description" placeholder="Optional" maxLength={500} />
        </Field>

        <Button type="submit" variant="primary" disabled={busy || (check != null && !check.ok)} className="w-full">
          {busy ? 'Adding…' : 'Add project'}
        </Button>

        {result && (
          <p className={`text-[10.5px] ${result.ok ? 'text-pos' : 'text-neg'}`}>{result.message}</p>
        )}
      </form>
    </Panel>
  );
}
