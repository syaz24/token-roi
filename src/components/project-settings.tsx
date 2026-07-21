'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, Panel, Select } from './ui';
import { deleteProject, rescanGit, updateProject } from '@/app/actions';

export function ProjectSettingsForm({ project, className }: { project: any; className?: string }) {
  const router = useRouter();
  const [msg, setMsg] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  let tags: string[] = [];
  try {
    tags = JSON.parse(project.tags ?? '[]');
  } catch {
    tags = [];
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      setMsg(await updateProject(project.id, new FormData(e.currentTarget)));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
        <Panel title="Project Settings">
          <form onSubmit={save} className="space-y-2.5">
            <Field label="Name">
              <Input name="name" defaultValue={project.name} required />
            </Field>
            <Field label="Folder path" hint="Registered path cannot be edited; remove and re-add to change it.">
              <Input value={project.path} disabled readOnly className="mono opacity-60" />
            </Field>
            <Field label="Detected Git root">
              <Input value={project.git_root ?? 'none detected'} disabled readOnly className="mono opacity-60" />
            </Field>
            <Field label="Remote URL">
              <Input value={project.remote_url ?? 'none detected'} disabled readOnly className="mono opacity-60" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Category">
                <Input name="category" defaultValue={project.category ?? ''} />
              </Field>
              <Field label="Status">
                <Select name="status" defaultValue={project.status} className="w-full">
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="shipped">Shipped</option>
                  <option value="archived">Archived</option>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Date started">
                <Input name="startedAt" type="date" defaultValue={(project.started_at ?? '').slice(0, 10)} />
              </Field>
              <Field label="Currency">
                <Select name="currency" defaultValue={project.currency} className="w-full">
                  <option value="USD">USD</option>
                  <option value="MYR">MYR</option>
                </Select>
              </Field>
            </div>
            <Field label="Value method">
              <Select name="valueMethod" defaultValue={project.value_method} className="w-full">
                <option value="manual">Manual entries</option>
                <option value="revenue">Realised revenue</option>
                <option value="savings">Cost savings</option>
                <option value="hours">Hours saved</option>
              </Select>
            </Field>
            <Field label="Tags" hint="Comma separated">
              <Input name="tags" defaultValue={tags.join(', ')} />
            </Field>
            <Field label="Description">
              <Input name="description" defaultValue={project.description ?? ''} />
            </Field>
            <label className="flex items-center gap-1.5 text-[11px] text-ink2">
              <input type="checkbox" name="archived" defaultChecked={!!project.archived} className="h-3 w-3 accent-[#A78BFA]" />
              Archived
            </label>
            <Button type="submit" variant="primary" disabled={busy} className="w-full">
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
            {msg && <p className={`text-[10.5px] ${msg.ok ? 'text-pos' : 'text-neg'}`}>{msg.message}</p>}
          </form>
        </Panel>

        <div className="space-y-2.5">
          <Panel title="Git Metadata">
            <p className="mb-2 text-[11px] leading-relaxed text-ink3">
              Indexes commit counts, active days, line churn and contributors. Source code contents are never read into
              the database.
            </p>
            <Button
              onClick={async () => {
                setBusy(true);
                try {
                  setMsg(await rescanGit(project.id));
                  router.refresh();
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              Rescan Git metadata
            </Button>
          </Panel>

          <Panel title="Danger Zone">
            <p className="mb-2 text-[11px] leading-relaxed text-ink3">
              Removing a project keeps its indexed token events — they simply become unassigned. Value entries and
              mapping rules for this project are deleted.
            </p>
            {confirmDelete ? (
              <div className="flex gap-1.5">
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await deleteProject(project.id);
                      router.push('/projects');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Confirm removal
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Remove project
              </Button>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
