"use client";

/**
 * 証憑管理のカードに出す画像の小さな見本。
 * 画面に見えたカードの分だけ、少し待ってまとめてURLを取りに行く（一覧の全件を一度に読まない）。
 * URLは1時間有効なので、この画面を開いている間は覚えておく。
 */

import { useEffect, useRef, useState } from "react";
import { getReceiptThumbnailUrls } from "@/actions/receipt-storage";

const cache = new Map<string, string | null>();
let queue: { clientId: string; id: string; resolve: (url: string | null) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const batch = queue;
  queue = [];
  const byClient = new Map<string, typeof batch>();
  for (const q of batch) byClient.set(q.clientId, [...(byClient.get(q.clientId) ?? []), q]);
  for (const [clientId, items] of byClient) {
    getReceiptThumbnailUrls(clientId, items.map((i) => i.id))
      .then((urls) => {
        for (const i of items) {
          const url = urls[i.id] ?? null;
          cache.set(i.id, url);
          i.resolve(url);
        }
      })
      .catch(() => items.forEach((i) => i.resolve(null)));
  }
}

function loadThumbnail(clientId: string, id: string): Promise<string | null> {
  if (cache.has(id)) return Promise.resolve(cache.get(id) ?? null);
  return new Promise((resolve) => {
    queue.push({ clientId, id, resolve });
    if (!timer) timer = setTimeout(flush, 80);
  });
}

export function ReceiptThumbnail({ clientId, receiptId, alt }: { clientId: string; receiptId: string; alt: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(cache.get(receiptId) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (url || cache.has(receiptId)) return;
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        loadThumbnail(clientId, receiptId).then((u) => alive && setUrl(u));
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [clientId, receiptId, url]);

  return (
    <div ref={ref} className="absolute inset-0">
      {url && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} className="size-full object-cover" />
      )}
    </div>
  );
}
