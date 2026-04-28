'use client';

import { useMemo, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExt from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
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
import { deriveArticleId, newNonce } from '../../lib/permit';
import { sanitizeHtml } from '../../lib/sanitize';
import {
  publishArticle,
  uploadCover,
  type ArticleSignature,
  type SiweSession,
} from '../../lib/api';

type Props = {
  session: SiweSession;
  onPublished: () => void;
};

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

  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [priceEth, setPriceEth] = useState('0.001');
  const [maxSupply, setMaxSupply] = useState('0');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [selectedChains, setSelectedChains] = useState<Set<number>>(initialSelected);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      LinkExt.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: 'Article body…' }),
    ],
    content: '',
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'min-h-[300px] rounded-md border border-base-100 bg-white p-4 text-sm focus:outline-none focus:ring-2 focus:ring-base-500/40',
      },
    },
  });

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
      setStatus(`Cover uploaded.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async () => {
    if (!editor || !address) return;
    if (!slug || !title) {
      setError('slug and title are required');
      return;
    }
    if (selectedChains.size === 0) {
      setError('select at least one chain');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const nonce = newNonce();
      const articleId = deriveArticleId({
        author: address,
        slug,
        nonce,
      });
      const contentURI = `${API_URL}/file/articles/${articleId}/body.html`;
      const sanitizedBody = sanitizeHtml(editor.getHTML());

      const price = parseEther(priceEth || '0');
      const max = BigInt(maxSupply || '0');
      const deadline = 0n;

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

      if (signatures.length === 0) {
        throw new Error('no signatures collected');
      }

      setStatus('Publishing…');
      const tagList = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 5);

      await publishArticle(session.token, {
        slug,
        title,
        description,
        body: sanitizedBody,
        tags: tagList,
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

      setStatus('Published.');
      // Reset form
      setSlug('');
      setTitle('');
      setDescription('');
      setTags('');
      setPriceEth('0.001');
      setMaxSupply('0');
      setCoverFile(null);
      setCoverUrl(null);
      editor.commands.clearContent();
      onPublished();
    } catch (e) {
      const msg =
        e instanceof Error
          ? // viem-style errors expose shortMessage
            ((e as Error & { shortMessage?: string }).shortMessage ?? e.message)
          : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Section title="Metadata">
        <Field label="Slug">
          <input
            type="text"
            value={slug}
            onChange={(e) =>
              setSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9-]+/g, '-')
                  .replace(/^-+|-+$/g, ''),
              )
            }
            placeholder="my-first-post"
            className={inputCls}
          />
        </Field>
        <Field label="Title">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="My first post"
            className={inputCls}
          />
        </Field>
        <Field label="Description">
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A short summary shown on the index."
            className={inputCls}
          />
        </Field>
        <Field label="Tags (comma-separated, max 5)">
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="web3, base, ink"
            className={inputCls}
          />
        </Field>
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

      <Section title="Mint settings">
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
        <p className="mt-1 text-xs text-base-500">
          Author (revenue receiver):{' '}
          <span className="font-mono">{address ?? '—'}</span>
        </p>
      </Section>

      <Section title="Body">
        <EditorContent editor={editor} />
        <Toolbar editor={editor} />
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
            onClick={handlePublish}
            className="rounded-md bg-base-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-base-600 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Sign & publish'}
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
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

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;
  const btn = (active: boolean) =>
    `rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${
      active ? 'bg-base-500 text-white ring-base-500' : 'bg-white text-base-700 ring-base-100'
    }`;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      <button
        type="button"
        className={btn(editor.isActive('bold'))}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        B
      </button>
      <button
        type="button"
        className={btn(editor.isActive('italic'))}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        I
      </button>
      <button
        type="button"
        className={btn(editor.isActive('strike'))}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        S
      </button>
      <button
        type="button"
        className={btn(editor.isActive('heading', { level: 2 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </button>
      <button
        type="button"
        className={btn(editor.isActive('heading', { level: 3 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </button>
      <button
        type="button"
        className={btn(editor.isActive('bulletList'))}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        ul
      </button>
      <button
        type="button"
        className={btn(editor.isActive('orderedList'))}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        ol
      </button>
      <button
        type="button"
        className={btn(editor.isActive('blockquote'))}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        ❝
      </button>
      <button
        type="button"
        className={btn(editor.isActive('codeBlock'))}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        {'</>'}
      </button>
      <button
        type="button"
        className={btn(false)}
        onClick={() => {
          const url = window.prompt('URL');
          if (!url) return;
          editor.chain().focus().setLink({ href: url, target: '_blank' }).run();
        }}
      >
        link
      </button>
    </div>
  );
}
