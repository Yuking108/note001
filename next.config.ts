import type { NextConfig } from 'next';

/**
 * 本文は `/pages/<slug>/` で参照する（`lib/content.ts` の pageHtmlUrl）。
 *
 * trailingSlash: true の静的出力では、ホスト側が `index.html` を URL から取り除く。
 * 実際 Vercel では `/pages/<slug>/index.html` が 404 で、`/pages/<slug>/` だけが通る。
 * 一方 `next dev` は public/ をパス完全一致で配信するため、ディレクトリ形式が当たらない。
 *
 * この rewrite は **dev を本番の URL 形に合わせるためだけのもの**。
 * 書き出し時はキーごと付けない（export では rewrite が適用されず、付いているだけで警告が出る）。
 * 静的出力側は、ホストが同じ解決をしてくれる。
 */
const devOnlyRewrites =
  process.env.NODE_ENV === 'development'
    ? {
        rewrites: async () => [
          { source: '/pages/:slug', destination: '/pages/:slug/index.html' },
        ],
      }
    : {};

const nextConfig: NextConfig = {
  // 完全静的出力。サーバー機能（Server Actions / API Routes / 画像最適化）は使わない。
  // 生成物は out/ 配下の素の静的ファイル群になる。
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  typedRoutes: false,
  ...devOnlyRewrites,
};

export default nextConfig;
