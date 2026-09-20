import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 完全静的出力。サーバー機能（Server Actions / API Routes / 画像最適化）は使わない。
  // 生成物は out/ 配下の素の静的ファイル群になる。
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  typedRoutes: false,
};

export default nextConfig;
