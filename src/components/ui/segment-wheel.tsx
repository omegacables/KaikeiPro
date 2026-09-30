"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

// ── 入力欄の区画（年・月・日）をマウスホイールで動かす ─────────────────
// クリックせずに、欄の上でホイールを回すだけで日付・年月を変えられるようにする。
// ただし、ページを縦に流し読みしている途中で欄がカーソルの下に来ただけで
// 値が変わってしまうと、気づかないまま誤った日付で登録される（決算期を
// またぐと致命的）。そのため次の2つを満たすときだけホイールを受け付ける。
//   ・カーソルが欄の上に少し留まっている（WHEEL_DWELL_MS）
//   ・直前までページ（や一覧）がスクロールしていない（SCROLL_QUIET_MS）
// 入力欄にフォーカスがあるときは、この待ちなしですぐ受け付ける。
const WHEEL_DWELL_MS = 250;
const SCROLL_QUIET_MS = 400;
const WHEEL_STEP_PX = 40; // トラックパッドの細かい量はためて1段にする

let lastScrollAt = 0;
let scrollTrackerInstalled = false;
function installScrollTracker() {
  if (scrollTrackerInstalled || typeof document === "undefined") return;
  scrollTrackerInstalled = true;
  // scroll は泡立たないため capture で全スクロール領域（モーダル・表の中も）を拾う
  document.addEventListener(
    "scroll",
    () => {
      lastScrollAt = Date.now();
    },
    { capture: true, passive: true }
  );
}

/** 区画の文字位置。例: "2026/04/10" なら [[0,4],[5,7],[8,10]] */
export type Segments = readonly (readonly [number, number])[];

let measureCanvas: HTMLCanvasElement | null = null;
/** 横位置 x（入力欄の左端から）にある区画の番号と、その区画の表示位置・幅 */
function segmentAt(input: HTMLInputElement, text: string, segments: Segments, x: number) {
  const cs = getComputedStyle(input);
  measureCanvas ??= document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = cs.font;
  const offset =
    (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0) - input.scrollLeft;
  const w = (n: number) => ctx.measureText(text.slice(0, n)).width;
  // 隣の区画との境目は、区切り文字の中ほど
  let seg = segments.length - 1;
  for (let i = 0; i < segments.length - 1; i++) {
    const cut = offset + (w(segments[i][1]) + w(segments[i + 1][0])) / 2;
    if (x < cut) {
      seg = i;
      break;
    }
  }
  const [from, to] = segments[seg];
  return { seg, left: offset + w(from), width: w(to) - w(from) };
}

/**
 * 入力欄にホイール操作を付ける。
 * onStep(delta, seg) … delta は +1（奥へ回す）/ -1（手前へ回す）、seg は区画の番号。
 * enabled が false の間（打ち込み途中など）はホイールを受け付けず、ページがスクロールする。
 * 戻り値の highlight はカーソルの下の区画の位置で、強調表示に使う。
 */
export function useSegmentWheel(
  inputRef: RefObject<HTMLInputElement | null>,
  opts: {
    text: string;
    segments: Segments;
    enabled: boolean;
    onStep: (delta: number, seg: number) => void;
  }
) {
  const hoverSinceRef = useRef(0);
  const accRef = useRef(0);
  const pointerXRef = useRef<number | null>(null);
  const [highlight, setHighlight] = useState<{ left: number; width: number } | null>(null);
  // イベント処理から常に最新の値を参照するための入れ物
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const refresh = useCallback(() => {
    const el = inputRef.current;
    const x = pointerXRef.current;
    const { text, segments, enabled } = optsRef.current;
    if (!el || x === null || !enabled) {
      setHighlight(null);
      return;
    }
    const b = segmentAt(el, text, segments, x);
    setHighlight(b ? { left: b.left, width: b.width } : null);
  }, [inputRef]);

  useEffect(() => {
    installScrollTracker();
    const el = inputRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const { text, segments, enabled, onStep } = optsRef.current;
      if (!enabled || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (document.activeElement !== el) {
        const now = Date.now();
        if (now - hoverSinceRef.current < WHEEL_DWELL_MS) return;
        if (now - lastScrollAt < SCROLL_QUIET_MS) return;
      }
      const b = segmentAt(el, text, segments, e.clientX - el.getBoundingClientRect().left);
      if (!b) return;
      // ここから先はページをスクロールさせない
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      accRef.current += e.deltaY * unit;
      const steps = Math.trunc(accRef.current / WHEEL_STEP_PX);
      if (steps === 0) return;
      accRef.current -= steps * WHEEL_STEP_PX;
      // 1回の操作で動かしすぎないよう1段に抑える
      onStep(steps < 0 ? 1 : -1, b.seg);
    };
    const pointerX = (e: MouseEvent) => e.clientX - el.getBoundingClientRect().left;
    const onEnter = (e: MouseEvent) => {
      hoverSinceRef.current = Date.now();
      accRef.current = 0;
      pointerXRef.current = pointerX(e);
      refresh();
    };
    const onMove = (e: MouseEvent) => {
      pointerXRef.current = pointerX(e);
      refresh();
    };
    const onLeave = () => {
      pointerXRef.current = null;
      setHighlight(null);
    };

    // React の onWheel は passive で preventDefault できないため直接登録する
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [inputRef, refresh]);

  // 表示が変わったら（数字の幅が変わるので）強調の位置を合わせ直す
  useEffect(() => {
    if (pointerXRef.current !== null) refresh();
  }, [opts.text, opts.enabled, refresh]);

  return highlight;
}

/** useSegmentWheel の highlight を描く。入力欄と同じ relative な親の中に置く */
export function SegmentHighlight({ at }: { at: { left: number; width: number } | null }) {
  if (!at) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-[1.4em] rounded bg-primary/20 ring-1 ring-primary/50"
      style={{ left: at.left - 2, width: at.width + 4 }}
    />
  );
}
