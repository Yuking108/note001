import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'note001',
  description: '個人用の知識ベース',
  // 非公開前提。将来うっかり公開しても検索インデックスに載らないようにする。
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-dvh">
        <header className="sticky top-0 z-20 border-b border-border-base bg-bg/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4">
            <Link
              href="/"
              className="font-mono text-sm font-semibold tracking-tight text-fg hover:text-accent"
            >
              note001
            </Link>
            <span className="text-xs text-fg-faint">知識ベース</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
