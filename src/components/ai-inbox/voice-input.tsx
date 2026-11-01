"use client";

/**
 * 音声入力（ブラウザの音声認識 Web Speech API・日本語）と、声に合わせて揺れる光の輪。
 * 輪は libraries.dev の Voice Ring（SwiftUI）の見た目を参考に、canvas で描き直したもの：
 *   何本かの細い輪がスペクトルの色で重なり、声の大きさで形がたわむ。待っている間はゆっくり漂い、
 *   考えている間（processing）は光が輪を回る。
 * 音声認識に対応していないブラウザ（Firefox など）ではボタンを出さない。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDocTheme } from "./thinking";

type RingState = "idle" | "listening" | "processing";

// ---------------------------------------------------------------------------
// 光の輪
// ---------------------------------------------------------------------------

export function VoiceRing({
  state,
  level,
  size = 160,
  className,
}: {
  state: RingState;
  /** 0〜1 の声の大きさ（毎フレーム読む） */
  level: () => number;
  size?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useDocTheme();
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const RINGS = 6;
    const POINTS = 96;
    const cx = size / 2;
    const cy = size / 2;
    const baseR = size * 0.3;
    let smooth = 0;
    let raf = 0;
    const start = performance.now();

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const st = stateRef.current;
      // 声の大きさは、上がるときは速く・下がるときはゆっくり（ふわっと戻る）
      const target = st === "listening" ? Math.min(1, Math.max(0, level())) : 0;
      smooth += (target - smooth) * (target > smooth ? 0.35 : 0.08);
      ctx.clearRect(0, 0, size, size);

      const spin = st === "processing" ? t * 2.4 : t * 0.25;
      const amp = (st === "listening" ? 0.04 + smooth * 0.28 : st === "processing" ? 0.05 : 0.025) * baseR;
      ctx.globalCompositeOperation = theme === "dark" ? "lighter" : "source-over";

      for (let i = 0; i < RINGS; i++) {
        const phase = i * 0.9;
        const r0 = baseR * (1 + (i - RINGS / 2) * 0.02);
        ctx.beginPath();
        for (let k = 0; k <= POINTS; k++) {
          const a = (k / POINTS) * Math.PI * 2;
          const wobble =
            Math.sin(a * 3 + t * 1.7 + phase) * 0.55 + Math.sin(a * 5 - t * 1.1 + phase * 1.3) * 0.3 + Math.sin(a * 2 + t * 0.6) * 0.15;
          const r = r0 + wobble * amp;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        let stroke: CanvasGradient | string;
        if ("createConicGradient" in ctx) {
          const g = ctx.createConicGradient(spin + i * 0.35, cx, cy);
          const hues = st === "processing" ? [95, 140, 190, 95] : [95, 160, 210, 280, 330, 40, 95];
          hues.forEach((h, j) => g.addColorStop(j / (hues.length - 1), `hsla(${h}, 70%, ${theme === "dark" ? 62 : 42}%, ${0.55 - i * 0.05})`));
          stroke = g;
        } else {
          stroke = theme === "dark" ? "rgba(156,204,74,0.5)" : "rgba(82,113,32,0.5)";
        }
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.6;
        ctx.shadowColor = theme === "dark" ? "rgba(156,204,74,0.6)" : "rgba(82,113,32,0.35)";
        ctx.shadowBlur = 6 + smooth * 14;
        ctx.stroke();
      }
      // 考えている間は、光が輪を回る
      if (st === "processing") {
        const a = spin;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * baseR, cy + Math.sin(a) * baseR, 3, 0, Math.PI * 2);
        ctx.fillStyle = theme === "dark" ? "#d8f0a8" : "#527120";
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, theme, level]);

  return <canvas ref={ref} style={{ width: size, height: size }} className={cn("block", className)} aria-hidden />;
}

// ---------------------------------------------------------------------------
// 音声認識
// ---------------------------------------------------------------------------

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function speechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechSupported(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(Boolean(speechCtor())), []);
  return ok;
}

const ERROR_TEXT: Record<string, string> = {
  "not-allowed": "マイクの使用が許可されていません。ブラウザのアドレスバーの鍵のマークから、マイクを許可してください。",
  "service-not-allowed": "この端末では音声入力を使えません。",
  "no-speech": "声が聞き取れませんでした。もう一度お話しください。",
  "audio-capture": "マイクが見つかりません。",
  network: "音声認識の通信に失敗しました。",
};

/**
 * 音声入力のボタン。押すと話を聞く画面（光の輪）を出し、話し終わると文字を onText に渡す。
 * 送るかどうかは利用者が決める（聞き間違いのまま送らないよう、入力欄に入れるだけ）。
 */
export function VoiceInputButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const supported = useSpeechSupported();
  const [open, setOpen] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const levelRef = useRef(0);
  const audioRef = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null);

  const level = useCallback(() => levelRef.current, []);

  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    cancelAnimationFrame(a.raf);
    a.stream.getTracks().forEach((t) => t.stop());
    a.ctx.close().catch(() => {});
    audioRef.current = null;
    levelRef.current = 0;
  }, []);

  const finish = useCallback(
    (send: boolean) => {
      recRef.current?.abort();
      recRef.current = null;
      stopAudio();
      setOpen(false);
      const text = (finalRef.current || "").trim();
      finalRef.current = "";
      setInterim("");
      if (send && text) onText(text);
    },
    [onText, stopAudio]
  );

  const start = async () => {
    const Ctor = speechCtor();
    if (!Ctor) return;
    setError(null);
    setInterim("");
    finalRef.current = "";
    setOpen(true);

    // 声の大きさ（輪の揺れ）。マイクが使えなくても音声認識だけで続ける
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        levelRef.current = Math.min(1, Math.sqrt(sum / buf.length) * 4);
        if (audioRef.current) audioRef.current.raf = requestAnimationFrame(tick);
      };
      audioRef.current = { ctx, stream, raf: requestAnimationFrame(tick) };
    } catch {
      // 輪は小さく揺れるだけになる
    }

    const rec = new Ctor();
    rec.lang = "ja-JP";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let fin = "";
      let mid = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript;
        else mid += r[0].transcript;
      }
      finalRef.current = fin;
      setInterim(fin + mid);
    };
    rec.onerror = (e) => setError(ERROR_TEXT[e.error] ?? `音声入力に失敗しました（${e.error}）`);
    rec.onend = () => {
      // 話し終わったら、聞き取れた分を入力欄へ（エラーのときは画面に残して知らせる）
      if (finalRef.current.trim()) finish(true);
      else stopAudio();
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setError("音声入力を始められませんでした。");
    }
  };

  useEffect(() => () => finish(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!supported) return null;

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={disabled}
        className="shrink-0 size-10 rounded-full border border-border bg-card text-foreground flex items-center justify-center hover:bg-muted/40 disabled:opacity-50"
        aria-label="音声で入力"
        title="音声で入力"
      >
        <Mic className="size-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 backdrop-blur-sm px-4" role="dialog" aria-label="音声入力">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl text-center">
            <div className="flex justify-end">
              <button onClick={() => finish(false)} className="text-muted-foreground hover:text-foreground" aria-label="やめる">
                <X className="size-5" />
              </button>
            </div>
            <div className="flex justify-center">
              <VoiceRing state={error ? "idle" : "listening"} level={level} size={200} />
            </div>
            <p className="mt-2 text-base font-bold text-foreground">{error ? "うまく聞き取れませんでした" : "お話しください"}</p>
            <p className="mt-2 min-h-12 text-base text-foreground break-words">{interim || (error ? "" : "例:「取引先と4人でした。A社の山田様ほか2名です」")}</p>
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {error ? (
                <button onClick={start} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
                  <Mic className="size-4" />
                  もう一度
                </button>
              ) : (
                <button
                  onClick={() => {
                    recRef.current?.stop();
                    if (finalRef.current.trim() || interim.trim()) {
                      finalRef.current = finalRef.current || interim;
                      finish(true);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
                >
                  <MicOff className="size-4" />
                  話し終わった
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
