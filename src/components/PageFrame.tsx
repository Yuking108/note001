'use client';

import { useEffect, useRef, useState } from 'react';

const MIN_HEIGHT = 240;
const MAX_HEIGHT = 40000;

/**
 * 本文を iframe で隔離して表示する。
 *
 * sandbox の構成:
 *   allow-scripts                     図解やインタラクティブな説明を動かす
 *   allow-popups + to-escape-sandbox  外部リンクを別タブで開ける（本文から離脱させない）
 *   allow-same-origin は付けない      アプリの DOM・ストレージ・Cookie に触れさせない
 *   allow-forms / allow-modals も無し フォーム送信と alert を封じる
 *
 * allow-same-origin が無いためオリジンは opaque になる。
 * 高さ通知の検証は origin ではなく event.source で行う。
 */
export function PageFrame({ src, title }: { src: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(MIN_HEIGHT * 3);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (frame === null || event.source !== frame.contentWindow) return;

      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null) return;
      const message = data as { type?: unknown; height?: unknown };
      if (message.type !== 'note001:height') return;

      const reported = Number(message.height);
      if (!Number.isFinite(reported)) return;
      setHeight(Math.min(Math.max(Math.ceil(reported), MIN_HEIGHT), MAX_HEIGHT));
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <iframe
      ref={frameRef}
      src={src}
      title={title}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      style={{ height: `${height}px` }}
      className="block w-full border-0 bg-bg-elevated"
    />
  );
}
