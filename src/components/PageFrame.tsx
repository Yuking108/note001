'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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

  /**
   * 本文に「いま測って送り直せ」と頼む。
   * 本文側は高さが変わったときしか送らないので、リスナーを張る前に届いた1通を
   * 取りこぼすと iframe が初期値のまま固定され、中身側にスクロールバーが出る。
   */
  const requestHeight = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({ type: 'note001:measure' }, '*');
  }, []);

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

    // 読み込みの速い iframe はこの時点で既に送信を終えている。数回に分けて催促する
    // （1回目は本文の script がまだ走っていないことがある）。
    const timers = [0, 60, 240, 800, 2000].map((delay) => window.setTimeout(requestHeight, delay));

    return () => {
      window.removeEventListener('message', onMessage);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [requestHeight]);

  return (
    <iframe
      ref={frameRef}
      src={src}
      title={title}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      onLoad={requestHeight}
      style={{ height: `${height}px` }}
      className="block w-full border-0 bg-bg-elevated"
    />
  );
}
