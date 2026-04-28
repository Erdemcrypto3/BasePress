'use client';

import dynamic from 'next/dynamic';

// Reader pulls in wagmi hooks (MintCard) which crash Next's static prerender
// on indexedDB. Home page sidesteps this by loading the wallet provider via
// next/dynamic ssr:false; we do the same one level higher here so MintCard's
// wagmi hooks never evaluate on the server.
const ArticleReader = dynamic(
  () => import('./ArticleReader').then((m) => m.ArticleReader),
  { ssr: false },
);

export default function ArticleReaderPage() {
  return <ArticleReader />;
}
