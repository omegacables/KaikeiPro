"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// ── ドラムロール式の選択パネル ─────────────────────────────────────
// 入力欄の下に開き、年・月・日などの列を縦に回して選ぶ。
// 列の上でホイールを回す（またはスワイプする）と1段ずつ動き、中央の帯に来た値が
// そのまま選ばれる。項目のクリックでも選べる。

const ITEM_H = 36; // 1段の高さ(px)
const VISIBLE = 5; // 見える段数（奇数。中央が選択中）
const PAD = Math.floor(VISIBLE / 2) * ITEM_H; // 先頭・末尾も中央に来られるようにする余白
const WHEEL_STEP_PX = 40; // トラックパッドの細かい量はためて1段にする

export type DrumColumn = {
  key: string;
  label: string; // 列の見出し（年・月・日）
  items: { value: number; label: string }[];
  selected: number;
  onSelect: (value: number) => void;
};

function DrumColumnView({ col }: { col: DrumColumn }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acc = useRef(0);
  // 自分で動かしている間（スクロールのアニメーション中）は、途中の位置で値を確定しない
  const targetIdx = useRef<number | null>(null);
  const colRef = useRef(col);
  colRef.current = col;

  const selectedIdx = Math.max(0, col.items.findIndex((i) => i.value === col.selected));
  const selectedIdxRef = useRef(selectedIdx);
  selectedIdxRef.current = selectedIdx;
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToIdx = useCallback((idx: number, smooth: boolean) => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: idx * ITEM_H, behavior: smooth ? "smooth" : "auto" });
    if (!smooth) return;
    // アニメーションが途中で止まった・起きなかった（同じ位置・非表示のタブ等）ときでも、
    // 少し後には必ず選択中の値の位置にそろえる。そろえないと以後の外からの変更に追従しない
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => {
      targetIdx.current = null;
      const want = selectedIdxRef.current;
      if (Math.abs(el.scrollTop - want * ITEM_H) > 1) el.scrollTo({ top: want * ITEM_H, behavior: "auto" });
    }, 450);
  }, []);

  // 値が外から変わったら（打ち込み・他の列の変更で日が丸められた等）その位置へ回す
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (targetIdx.current !== null) return; // 自分で回している途中
    if (Math.round(el.scrollTop / ITEM_H) !== selectedIdx) scrollToIdx(selectedIdx, false);
  }, [selectedIdx, scrollToIdx]);

  const commit = useCallback((idx: number) => {
    const { items, selected, onSelect } = colRef.current;
    const i = Math.min(items.length - 1, Math.max(0, idx));
    if (items[i] && items[i].value !== selected) onSelect(items[i].value);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // ホイールは1段ずつ動かす（ブラウザ任せだと1回で3段ほど飛ぶ）。
    // React の onWheel は passive で止められないため直接登録する
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      acc.current += e.deltaY * unit;
      const steps = Math.trunc(acc.current / WHEEL_STEP_PX);
      if (steps === 0) return;
      acc.current -= steps * WHEEL_STEP_PX;
      const base = targetIdx.current ?? Math.round(el.scrollTop / ITEM_H);
      const next = Math.min(colRef.current.items.length - 1, Math.max(0, base + Math.sign(steps)));
      targetIdx.current = next;
      scrollToIdx(next, true);
      // 回すたびにすぐ値を反映する（止めるのを待たない）
      commit(next);
    };
    // スワイプ・スクロールバー操作など、ホイール以外で止まったときに確定する
    const onScroll = () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        const idx = Math.round(el.scrollTop / ITEM_H);
        targetIdx.current = null;
        if (Math.abs(el.scrollTop - idx * ITEM_H) > 1) scrollToIdx(idx, true);
        commit(idx);
      }, 120);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", onScroll);
      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
    };
  }, [commit, scrollToIdx]);

  return (
    <div className="flex flex-col items-stretch min-w-[4.5rem] flex-1">
      <div className="text-center text-[13px] font-bold text-foreground py-1 border-b border-border">{col.label}</div>
      <div className="relative">
      {/* 中央の帯（ここに来た値が選択中） */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 z-0 bg-primary/15 border-y border-primary/50"
        style={{ top: PAD, height: ITEM_H }}
      />
      <div
        ref={ref}
        role="listbox"
        aria-label={col.label}
        className="relative overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-y snap-mandatory"
        style={{ height: ITEM_H * VISIBLE }}
      >
        <div style={{ height: PAD }} />
        {col.items.map((it, i) => {
          const active = i === selectedIdx;
          return (
            <div
              key={it.value}
              role="option"
              aria-selected={active}
              onClick={() => {
                targetIdx.current = i;
                scrollToIdx(i, true);
                commit(i);
              }}
              className={
                "snap-center flex items-center justify-center cursor-pointer select-none tabular-nums text-[17px] " +
                (active ? "font-bold text-primary" : "text-foreground hover:bg-muted/40")
              }
              style={{ height: ITEM_H }}
            >
              {it.label}
            </div>
          );
        })}
        <div style={{ height: PAD }} />
      </div>
      </div>
    </div>
  );
}

/**
 * 入力欄 anchorRef の下（入り切らなければ上）に開くドラムロールのパネル。
 * 表やモーダルの枠で切れないよう body 直下に描く。
 * パネル内の押下では入力欄のフォーカスを外さない（閉じる判定を入力欄の blur で行えるように）。
 */
export function DrumPicker({
  anchorRef,
  open,
  onClose,
  columns,
  footer,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  columns: DrumColumn[];
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);

  const place = useCallback(() => {
    const a = anchorRef.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const h = panelRef.current?.offsetHeight ?? ITEM_H * VISIBLE + 80;
    const w = panelRef.current?.offsetWidth ?? 240;
    const below = window.innerHeight - r.bottom;
    const top = below < h + 8 && r.top > h + 8 ? r.top - h - 4 : r.bottom + 4;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    setPos({ top, left, minWidth: r.width });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    // 1回目の描画で実際の大きさが分かるので置き直す
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      // パネル内の列のスクロールでは動かさない
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      place();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    window.addEventListener("resize", place);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, place, onClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-[1000] rounded-xl border border-border bg-card shadow-xl overflow-hidden"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, minWidth: Math.max(pos?.minWidth ?? 0, columns.length * 76) }}
    >
      <div className="flex divide-x divide-border">
        {columns.map((c) => (
          <DrumColumnView key={c.key} col={c} />
        ))}
      </div>
      {footer && <div className="flex items-center justify-end gap-1 border-t border-border px-2 py-1.5">{footer}</div>}
    </div>,
    document.body
  );
}

/** パネル下部のボタン */
export function DrumFooterButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1 rounded-lg text-[15px] text-foreground hover:bg-muted/50 cursor-pointer"
    >
      {children}
    </button>
  );
}
