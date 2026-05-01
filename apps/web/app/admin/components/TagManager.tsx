'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchAllTags,
  createTag,
  updateTag,
  type Tag,
  type SiweSession,
} from '../../lib/api';

type Props = { session: SiweSession };

export function TagManager({ session }: Props) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [view, setView] = useState<'active' | 'inactive'>('active');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTags(await fetchAllTags(session.token));
    } catch {
      // silent
    }
  }, [session.token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activeTags = tags.filter((t) => t.active);
  const inactiveTags = tags.filter((t) => !t.active);
  const displayed = view === 'active' ? activeTags : inactiveTags;

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createTag(session.token, newName.trim());
      setTags((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (tag: Tag) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateTag(session.token, tag.slug, { active: !tag.active });
      setTags((prev) => prev.map((t) => (t.slug === updated.slug ? updated : t)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Create tag */}
      <div className="rounded-xl bg-white p-5 ring-1 ring-inset ring-base-100 shadow-sm">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-base-500">
          Create tag
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Tag name"
            className="flex-1 rounded-md border border-base-100 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-base-500/40"
          />
          <button
            type="button"
            disabled={busy || !newName.trim()}
            onClick={handleCreate}
            className="rounded-md bg-base-500 px-4 py-2 text-sm font-medium text-white hover:bg-base-600 disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      {/* View toggle */}
      <div className="flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setView('active')}
          className={`rounded-md px-3 py-1.5 font-medium ring-1 ring-inset ${
            view === 'active'
              ? 'bg-base-500 text-white ring-base-500'
              : 'bg-white text-base-700 ring-base-100 hover:bg-base-50'
          }`}
        >
          Active ({activeTags.length})
        </button>
        <button
          type="button"
          onClick={() => setView('inactive')}
          className={`rounded-md px-3 py-1.5 font-medium ring-1 ring-inset ${
            view === 'inactive'
              ? 'bg-base-500 text-white ring-base-500'
              : 'bg-white text-base-700 ring-base-100 hover:bg-base-50'
          }`}
        >
          Inactive ({inactiveTags.length})
        </button>
      </div>

      {/* Tag list */}
      {displayed.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center ring-1 ring-inset ring-base-100 shadow-sm">
          <p className="text-sm text-base-500">
            {view === 'active' ? 'No active tags.' : 'No inactive tags.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((tag) => (
            <div
              key={tag.slug}
              className="flex items-center justify-between rounded-xl bg-white px-5 py-3 ring-1 ring-inset ring-base-100 shadow-sm"
            >
              <div>
                <span className="text-sm font-medium text-base-900">{tag.name}</span>
                <span className="ml-2 text-xs text-base-400">/{tag.slug}</span>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleToggle(tag)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ring-1 ring-inset ${
                  tag.active
                    ? 'text-red-600 ring-red-200 hover:bg-red-50'
                    : 'text-emerald-600 ring-emerald-200 hover:bg-emerald-50'
                }`}
              >
                {tag.active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
