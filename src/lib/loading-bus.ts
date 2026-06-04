// アプリ全体の「読み込み中」状態を集約する軽量バス。
// useData などのデータ取得が走っている間カウントを増減し、
// グローバルインジケーターが購読して表示する。

let active = 0;
const listeners = new Set<(n: number) => void>();

function emit() {
  for (const l of listeners) l(active);
}

export function beginLoad() {
  active += 1;
  emit();
}

export function endLoad() {
  active = Math.max(0, active - 1);
  emit();
}

export function subscribeLoad(listener: (n: number) => void): () => void {
  listeners.add(listener);
  listener(active);
  return () => {
    listeners.delete(listener);
  };
}
