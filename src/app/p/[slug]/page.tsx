import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PageFrame } from '@/components/PageFrame';
import { allPages, findPage, labelUrl, pageHtmlUrl, relatedPages } from '@/lib/content';

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return allPages.map((page) => ({ slug: page.id }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const page = findPage(slug);
  return { title: page === undefined ? 'note001' : `${page.title} — note001` };
}

export default async function PageDetail({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const page = findPage(slug);
  if (page === undefined) notFound();

  // 関連はアプリ側で出す。本文は allow-same-origin なしの iframe なので、
  // 本文中に書いた <a> では親を遷移させられない
  const related = relatedPages(page.id);

  return (
    <article className="mx-auto max-w-[1100px] px-4 py-6">
      <header className="mb-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-accent"
        >
          ← 一覧へ
        </Link>

        <h1 className="mt-3 text-xl font-semibold leading-snug text-fg">{page.title}</h1>

        {page.summary !== '' ? (
          <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-fg-muted">{page.summary}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {/* メインラベルは「このページの置き場」。枠線で他と区別する */}
          <Link
            href={labelUrl(page.mainLabel)}
            title={`メインラベル: ${page.mainLabel}`}
            className="rounded-full border border-border-strong px-2 py-0.5 font-mono text-[11px] text-fg hover:border-accent hover:text-accent"
          >
            {page.mainLabel}
          </Link>

          {page.subLabels.map((label) => (
            <Link
              key={label}
              href={labelUrl(label)}
              className="rounded-full bg-bg-subtle px-2 py-0.5 font-mono text-[11px] text-fg-muted hover:text-accent"
            >
              {label}
            </Link>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border-base pt-3 font-mono text-[11px] text-fg-faint">
          <span>作成 {page.createdAt}</span>
          <span>更新 {page.updatedAt}</span>
          <span className="text-fg-faint/70">{page.id}</span>
          <a
            href={pageHtmlUrl(page.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-fg-muted underline decoration-dotted hover:text-accent"
          >
            単独で開く ↗
          </a>
        </div>
      </header>

      {/* 本文は自由な見た目を持つので、どこからが本文かを枠で示す */}
      <div className="overflow-hidden rounded-lg border border-border-base">
        <PageFrame src={pageHtmlUrl(page.id)} title={page.title} />
      </div>

      {related.length > 0 ? (
        <nav className="mt-6">
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-fg-faint">
            関連ノート
          </h2>
          <ul className="space-y-2">
            {related.map((linked) => (
              <li key={linked.id}>
                <Link
                  href={`/p/${linked.id}/`}
                  className="group block rounded-lg border border-border-base bg-bg-elevated p-3 transition-colors hover:border-border-strong"
                >
                  <span className="block text-sm font-semibold leading-snug text-fg group-hover:text-accent">
                    {linked.title}
                  </span>
                  {linked.summary !== '' ? (
                    <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-fg-muted">
                      {linked.summary}
                    </span>
                  ) : null}
                  <span className="mt-1.5 block font-mono text-[11px] text-fg-faint">
                    {linked.mainLabel}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </article>
  );
}
