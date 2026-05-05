'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExt from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import CharacterCount from '@tiptap/extension-character-count';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { parseEther, type Address } from 'viem';
import { useAccount, useSignTypedData, useSwitchChain } from '@basepress/wallet';
import { SUPPORTED_CHAINS } from '@basepress/chain';
import {
  getContractAddress,
  MINT_PERMIT_TYPES,
  PERMIT_DOMAIN_NAME,
  PERMIT_DOMAIN_VERSION,
  API_URL,
} from '../../lib/contract';
import { deriveArticleId } from '../../lib/permit';
import { sanitizeHtml } from '../../lib/sanitize';
import {
  publishArticle,
  uploadCover,
  saveDraft,
  listDrafts,
  deleteDraft,
  fetchActiveTags,
  type ArticleSignature,
  type SiweSession,
  type Draft,
  type Tag,
} from '../../lib/api';

const AUTOSAVE_DELAY_MS = 5_000;
const MAX_TAGS = 3;

type Props = {
  session: SiweSession;
  onPublished: () => void;
};

function newDraftId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export function WriteArticle({ session, onPublished }: Props) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();

  const supportedChains = useMemo(
    () => SUPPORTED_CHAINS.filter((c) => getContractAddress(c.id) !== null),
    [],
  );
  const initialSelected = useMemo(
    () => new Set(supportedChains.map((c) => c.id)),
    [supportedChains],
  );

  // --- Draft state ---
  const [draftId, setDraftId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showDraftList, setShowDraftList] = useState(true);
  const autoSaveRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const skipAutoSaveRef = useRef(false);

  // --- Tag registry ---
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  useEffect(() => {
    fetchActiveTags().then(setAvailableTags).catch(() => {});
  }, []);

  // --- Form state ---
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [priceEth, setPriceEth] = useState('0.001');
  const [maxSupply, setMaxSupply] = useState('0');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [selectedChains, setSelectedChains] = useState<Set<number>>(initialSelected);
  const [bodyHtml, setBodyHtml] = useState('');

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ horizontalRule: false }),
      LinkExt.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: 'Start writing your article…' }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      HorizontalRule,
      CharacterCount,
    ],
    content: '',
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose prose-base max-w-none min-h-[400px] rounded-md border border-base-100 bg-white p-5 text-sm focus:outline-none focus:ring-2 focus:ring-base-500/40',
        spellcheck: 'true',
        lang: 'en,tr',
      },
    },
    onUpdate({ editor: e }) {
      setBodyHtml(e.getHTML());
    },
  });

  // --- Load drafts on mount ---
  const refreshDrafts = useCallback(async () => {
    try {
      const list = await listDrafts(session.token);
      setDrafts(list);
      return list;
    } catch {
      return [];
    }
  }, [session.token]);

  useEffect(() => {
    refreshDrafts();
  }, [refreshDrafts]);

  // --- Load a draft into the editor ---
  const loadDraft = useCallback(
    (draft: Draft) => {
      skipAutoSaveRef.current = true;
      setDraftId(draft.draftId);
      setSlug(draft.slug || draft.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
      setTitle(draft.title);
      setDescription(draft.description);
      setTags(draft.tags);
      setPriceEth(draft.priceEth);
      setMaxSupply(draft.maxSupply);
      setCoverUrl(draft.coverImage ?? null);
      setCoverFile(null);
      setSelectedChains(
        draft.selectedChains.length > 0
          ? new Set(draft.selectedChains)
          : initialSelected,
      );
      editor?.commands.setContent(draft.body || '');
      setBodyHtml(draft.body || '');
      setShowDraftList(false);
      setSaveStatus('saved');
      setError(null);
      setStatus('');
      setTimeout(() => {
        skipAutoSaveRef.current = false;
      }, 100);
    },
    [editor, initialSelected],
  );

  // --- Start new draft ---
  const startNewDraft = useCallback(() => {
    skipAutoSaveRef.current = true;
    setDraftId(newDraftId());
    setSlug('');
    setTitle('');
    setDescription('');
    setTags([]);
    setPriceEth('0.001');
    setMaxSupply('0');
    setCoverFile(null);
    setCoverUrl(null);
    setSelectedChains(initialSelected);
    editor?.commands.clearContent();
    setBodyHtml('');
    setShowDraftList(false);
    setSaveStatus('idle');
    setError(null);
    setStatus('');
    setTimeout(() => {
      skipAutoSaveRef.current = false;
    }, 100);
  }, [editor, initialSelected]);

  // --- Discard draft ---
  const discardDraft = useCallback(async () => {
    if (!draftId) return;
    try {
      await deleteDraft(session.token, draftId);
    } catch {
      // already gone or network error — fine
    }
    setDraftId(null);
    setShowDraftList(true);
    setSaveStatus('idle');
    refreshDrafts();
  }, [draftId, session.token, refreshDrafts]);

  // --- Auto-save (5s debounce) ---
  const currentFormRef = useRef({
    slug,
    title,
    description,
    tags,
    priceEth,
    maxSupply,
    coverUrl,
    selectedChains,
    bodyHtml,
  });
  currentFormRef.current = {
    slug,
    title,
    description,
    tags,
    priceEth,
    maxSupply,
    coverUrl,
    selectedChains,
    bodyHtml,
  };

  useEffect(() => {
    if (!draftId || skipAutoSaveRef.current) return;
    clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(async () => {
      const f = currentFormRef.current;
      const hasContent = f.title || f.slug || f.bodyHtml;
      if (!hasContent) return;
      setSaveStatus('saving');
      try {
        await saveDraft(session.token, draftId, {
          slug: f.slug,
          title: f.title,
          description: f.description,
          tags: f.tags,
          priceEth: f.priceEth,
          maxSupply: f.maxSupply,
          coverImage: f.coverUrl ?? undefined,
          body: f.bodyHtml,
          selectedChains: Array.from(f.selectedChains),
        });
        setSaveStatus('saved');
        refreshDrafts();
      } catch {
        setSaveStatus('error');
      }
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(autoSaveRef.current);
  }, [
    draftId,
    slug,
    title,
    description,
    tags,
    priceEth,
    maxSupply,
    coverUrl,
    selectedChains,
    bodyHtml,
    session.token,
    refreshDrafts,
  ]);

  const toggleChain = (id: number) =>
    setSelectedChains((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const handleCoverUpload = async () => {
    if (!coverFile) return;
    try {
      setBusy(true);
      setStatus('Uploading cover…');
      setError(null);
      const r = await uploadCover(session.token, coverFile);
      setCoverUrl(r.url);
      setStatus('Cover uploaded.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // P001-PAI-0041: inline images must go through R2 upload (same as cover images)
  const handleInlineImageUpload = useCallback(
    async (file: File) => {
      if (!editor) return;
      try {
        setBusy(true);
        setStatus('Uploading inline image…');
        setError(null);
        const r = await uploadCover(session.token, file);
        // P001-PAI-0056: validate URL before inserting to prevent injection via template literal
        const safeUrl = new URL(r.url).toString();
        editor.chain().focus().insertContent(`<img src="${safeUrl}" alt="" />`).run();
        setStatus('Image inserted.');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [editor, session.token],
  );

  const handlePublish = async () => {
    if (!editor || !address) return;
    if (!title) {
      setError('title is required');
      return;
    }
    const finalSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!finalSlug) {
      setError('could not generate slug from title');
      return;
    }
    setSlug(finalSlug);
    if (selectedChains.size === 0) {
      setError('select at least one chain');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const articleId = deriveArticleId({ author: address, slug: finalSlug });
      const contentURI = `${API_URL}/file/articles/${articleId}/body.html`;
      const sanitizedBody = sanitizeHtml(editor.getHTML());

      const price = parseEther(priceEth || '0');
      const max = BigInt(maxSupply || '0');
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);

      const message = {
        articleId,
        contentURI,
        author: address as Address,
        price,
        maxSupply: max,
        deadline,
      } as const;

      const chainsToSign = supportedChains.filter((c) => selectedChains.has(c.id));
      const signatures: ArticleSignature[] = [];
      for (let i = 0; i < chainsToSign.length; i++) {
        const chain = chainsToSign[i];
        const verifyingContract = getContractAddress(chain.id);
        if (!verifyingContract) continue;

        setStatus(`(${i + 1}/${chainsToSign.length}) Switching to ${chain.name}…`);
        try {
          await switchChainAsync({ chainId: chain.id });
        } catch {
          // Some wallets (Rabby) sign typed data with chainId in domain even
          // if the active chain differs. If switch fails we continue.
        }
        setStatus(
          `(${i + 1}/${chainsToSign.length}) Sign permit for ${chain.name} in your wallet…`,
        );
        const sig = await signTypedDataAsync({
          domain: {
            name: PERMIT_DOMAIN_NAME,
            version: PERMIT_DOMAIN_VERSION,
            chainId: chain.id,
            verifyingContract,
          },
          types: MINT_PERMIT_TYPES,
          primaryType: 'MintPermit',
          message,
        });
        signatures.push({ chainId: chain.id, signature: sig as `0x${string}` });
      }

      if (signatures.length === 0) throw new Error('no signatures collected');

      setStatus('Publishing…');

      await publishArticle(session.token, {
        slug: finalSlug,
        title,
        description,
        body: sanitizedBody,
        tags,
        coverImage: coverUrl ?? undefined,
        permit: {
          articleId,
          contentURI,
          author: address as `0x${string}`,
          price: price.toString(),
          maxSupply: max.toString(),
          deadline: Number(deadline),
        },
        signatures,
      });

      if (draftId) {
        try {
          await deleteDraft(session.token, draftId);
        } catch {
          // non-critical
        }
      }

      setStatus('Published.');
      setDraftId(null);
      setShowDraftList(true);
      setSaveStatus('idle');
      setSlug('');
      setTitle('');
      setDescription('');
      setTags([]);
      setPriceEth('0.001');
      setMaxSupply('0');
      setCoverFile(null);
      setCoverUrl(null);
      editor.commands.clearContent();
      setBodyHtml('');
      refreshDrafts();
      onPublished();
    } catch (e) {
      const msg =
        e instanceof Error
          ? ((e as Error & { shortMessage?: string }).shortMessage ?? e.message)
          : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  // --- Draft list view ---
  if (showDraftList && !draftId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-base-900">Your drafts</h3>
          <button
            type="button"
            onClick={startNewDraft}
            className="rounded-md bg-base-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-base-600"
          >
            New draft
          </button>
        </div>
        {drafts.length === 0 ? (
          <div className="rounded-xl bg-white p-8 text-center ring-1 ring-inset ring-base-100 shadow-sm">
            <p className="text-sm text-base-500">No drafts yet.</p>
            <button
              type="button"
              onClick={startNewDraft}
              className="mt-3 rounded-md bg-base-500 px-4 py-2 text-sm font-medium text-white hover:bg-base-600"
            >
              Start writing
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {drafts.map((d) => (
              <button
                key={d.draftId}
                type="button"
                onClick={() => loadDraft(d)}
                className="flex w-full items-center justify-between rounded-xl bg-white px-5 py-4 text-left ring-1 ring-inset ring-base-100 shadow-sm hover:bg-base-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-base-900">
                    {d.title || d.slug || 'Untitled'}
                  </p>
                  {d.description && (
                    <p className="mt-0.5 truncate text-xs text-base-500">{d.description}</p>
                  )}
                </div>
                <span className="ml-4 shrink-0 text-xs text-base-400">
                  {new Date(d.updatedAt * 1000).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // --- Editor view ---
  return (
    <div className="space-y-5">
      {/* Auto-save notice */}
      <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-2.5 text-xs text-blue-700 ring-1 ring-inset ring-blue-200">
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 0-2 0v4a1 1 0 0 0 .293.707l2 2a1 1 0 0 0 1.414-1.414L11 9.586V6Z" clipRule="evenodd" />
        </svg>
        Your draft is saved automatically as you type. You can close this page and resume later.
      </div>

      {/* Draft bar */}
      <div className="flex items-center justify-between rounded-xl bg-base-50 px-4 py-2.5 ring-1 ring-inset ring-base-100">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setDraftId(null);
              setShowDraftList(true);
            }}
            className="text-xs font-medium text-base-600 hover:text-base-900"
          >
            All drafts
          </button>
          <span className="text-base-200">|</span>
          <span className="text-xs text-base-500">
            {title || slug || 'Untitled draft'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {saveStatus === 'saving' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              Saving…
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Saved
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              Save failed
            </span>
          )}
          <button
            type="button"
            onClick={discardDraft}
            className="text-xs font-medium text-red-500 hover:text-red-700"
          >
            Discard
          </button>
        </div>
      </div>

      <Section title="Metadata">
        <Field label="Title">
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, ''),
              );
            }}
            placeholder="My first post"
            className={inputCls}
          />
        </Field>
        {slug && (
          <div className="text-xs text-base-400">
            Slug: <span className="font-mono">{slug}</span>
          </div>
        )}
        <Field label="Description">
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A short summary shown on the index."
            className={inputCls}
          />
        </Field>
        <div>
          <span className="mb-1 block text-xs font-medium text-base-700">
            Tags (max {MAX_TAGS})
          </span>
          {availableTags.length === 0 ? (
            <p className="text-xs text-base-400">
              No tags defined yet. Create tags in the Tags tab first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availableTags.map((t) => {
                const selected = tags.includes(t.name);
                const disabled = !selected && tags.length >= MAX_TAGS;
                return (
                  <label
                    key={t.slug}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ring-1 ring-inset ${
                      selected
                        ? 'bg-base-50 ring-base-300 text-base-900'
                        : disabled
                        ? 'cursor-not-allowed bg-white text-base-300 ring-base-50'
                        : 'bg-white text-base-700 ring-base-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={disabled}
                      onChange={() => {
                        if (selected) {
                          setTags(tags.filter((n) => n !== t.name));
                        } else if (tags.length < MAX_TAGS) {
                          setTags([...tags, t.name]);
                        }
                      }}
                    />
                    {t.name}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </Section>

      <Section title="Cover image (optional)">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
            className="text-xs"
          />
          <button
            type="button"
            disabled={!coverFile || busy}
            onClick={handleCoverUpload}
            className="rounded-md bg-base-100 px-3 py-1.5 text-xs font-medium text-base-700 hover:bg-base-200 disabled:opacity-40"
          >
            Upload
          </button>
          {coverUrl && (
            <a
              href={coverUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-700 underline"
            >
              View uploaded cover
            </a>
          )}
        </div>
      </Section>

      <details className="rounded-xl bg-white ring-1 ring-inset ring-base-100 shadow-sm">
        <summary className="cursor-pointer select-none px-5 py-4 text-xs font-semibold uppercase tracking-wider text-base-500 hover:text-base-700">
          Pricing &amp; supply (defaults: {priceEth} ETH · {maxSupply === '0' ? 'unlimited' : maxSupply})
        </summary>
        <div className="border-t border-base-100 px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price (ETH)">
              <input
                type="text"
                inputMode="decimal"
                value={priceEth}
                onChange={(e) => setPriceEth(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Max supply (0 = unlimited)">
              <input
                type="text"
                inputMode="numeric"
                value={maxSupply}
                onChange={(e) => setMaxSupply(e.target.value.replace(/\D/g, ''))}
                className={inputCls}
              />
            </Field>
          </div>
          <p className="text-xs text-base-500">
            Readers pay this price to collect. Revenue goes to author:{' '}
            <span className="font-mono">{address ?? '—'}</span>
          </p>
        </div>
      </details>

      <Section title="Body">
        <Toolbar editor={editor} onInsertImage={handleInlineImageUpload} />
        <EditorContent editor={editor} />
        {editor && (
          <div className="mt-2 text-right text-xs text-base-400">
            {editor.storage.characterCount.characters()} characters ·{' '}
            {editor.storage.characterCount.words()} words
          </div>
        )}
      </Section>

      <Section title="Chains">
        <p className="mb-2 text-xs text-base-500">
          Sign one EIP-712 permit per chain. No gas — readers pay when they mint.
        </p>
        <div className="flex flex-wrap gap-2">
          {supportedChains.map((c) => (
            <label
              key={c.id}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ring-1 ring-inset ${
                selectedChains.has(c.id)
                  ? 'bg-base-50 ring-base-300 text-base-900'
                  : 'bg-white ring-base-100 text-base-700'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedChains.has(c.id)}
                onChange={() => toggleChain(c.id)}
              />
              {c.name}
            </label>
          ))}
        </div>
      </Section>

      <div className="flex flex-col gap-2 rounded-xl bg-white p-4 ring-1 ring-inset ring-base-100 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-xs text-base-500">{status || ' '}</div>
          <button
            type="button"
            disabled={busy}
            onClick={() => setShowConfirm(true)}
            className="rounded-md bg-base-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-base-600 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Sign & publish'}
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-base-900">Confirm publish</h3>
            <p className="mt-2 text-sm text-base-600">
              Once published, this article is <strong>permanent</strong>. You cannot edit or
              delete it. To publish a revised version you must use a new slug.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-base-600 ring-1 ring-inset ring-base-200 hover:bg-base-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirm(false);
                  handlePublish();
                }}
                className="rounded-md bg-base-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-base-600"
              >
                Publish permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-base-100 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-base-500/40';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-5 ring-1 ring-inset ring-base-100 shadow-sm">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-base-500">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-base-700">{label}</span>
      {children}
    </label>
  );
}

function Toolbar({ editor, onInsertImage }: { editor: ReturnType<typeof useEditor>; onInsertImage: (file: File) => void }) {
  // P001-PAI-0041: hidden file input ref for inline image upload (no external URLs)
  const imgInputRef = useRef<HTMLInputElement>(null);
  if (!editor) return null;
  const btn = (active: boolean) =>
    `rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
      active ? 'bg-base-500 text-white ring-base-500' : 'bg-white text-base-700 ring-base-100 hover:bg-base-50'
    }`;
  const sep = <span className="mx-0.5 w-px self-stretch bg-base-100" />;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1 rounded-lg border border-base-100 bg-base-50/50 p-1.5">
      {/* Undo / Redo */}
      <button type="button" className={btn(false)} onClick={() => editor.chain().focus().undo().run()} title="Undo">
        ↩
      </button>
      <button type="button" className={btn(false)} onClick={() => editor.chain().focus().redo().run()} title="Redo">
        ↪
      </button>

      {sep}

      {/* Text formatting */}
      <button type="button" className={btn(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
        <strong>B</strong>
      </button>
      <button type="button" className={btn(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
        <em>I</em>
      </button>
      <button type="button" className={btn(editor.isActive('underline'))} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
        <u>U</u>
      </button>
      <button type="button" className={btn(editor.isActive('strike'))} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
        <s>S</s>
      </button>
      <button type="button" className={btn(editor.isActive('highlight'))} onClick={() => editor.chain().focus().toggleHighlight().run()} title="Highlight">
        <span className="bg-yellow-200 px-0.5">H</span>
      </button>

      {sep}

      {/* Headings */}
      <button type="button" className={btn(editor.isActive('heading', { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
        H2
      </button>
      <button type="button" className={btn(editor.isActive('heading', { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">
        H3
      </button>

      {sep}

      {/* Lists */}
      <button type="button" className={btn(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
        •
      </button>
      <button type="button" className={btn(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
        1.
      </button>

      {sep}

      {/* Alignment */}
      <button type="button" className={btn(editor.isActive({ textAlign: 'left' }))} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="Align left">
        ≡
      </button>
      <button type="button" className={btn(editor.isActive({ textAlign: 'center' }))} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Align center">
        ≡
      </button>
      <button type="button" className={btn(editor.isActive({ textAlign: 'right' }))} onClick={() => editor.chain().focus().setTextAlign('right').run()} title="Align right">
        ≡
      </button>

      {sep}

      {/* Blocks */}
      <button type="button" className={btn(editor.isActive('blockquote'))} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">
        ❝
      </button>
      <button type="button" className={btn(editor.isActive('codeBlock'))} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Code block">
        {'</>'}
      </button>
      <button type="button" className={btn(false)} onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule">
        ―
      </button>

      {sep}

      {/* Link & Image */}
      <button
        type="button"
        className={btn(editor.isActive('link'))}
        onClick={() => {
          if (editor.isActive('link')) {
            editor.chain().focus().unsetLink().run();
            return;
          }
          const url = window.prompt('URL');
          if (!url) return;
          editor.chain().focus().setLink({ href: url, target: '_blank' }).run();
        }}
        title="Link"
      >
        🔗
      </button>
      {/* P001-PAI-0041: inline images uploaded to R2 via /file/cover instead of arbitrary external URLs */}
      <input
        ref={imgInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onInsertImage(f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className={btn(false)}
        onClick={() => imgInputRef.current?.click()}
        title="Insert image (upload)"
      >
        🖼
      </button>
    </div>
  );
}
