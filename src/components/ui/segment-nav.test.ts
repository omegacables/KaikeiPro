import { describe, it, expect } from "vitest";
import { segmentNav } from "./segment-nav";

describe("segmentNav（年・月・日を順に選ぶ）", () => {
  it("欄に入った直後の Enter は、そのまま次の欄へ（打ち込み＋Enter の速さを保つ）", () => {
    expect(segmentNav("Enter", false, null, 3)).toEqual({ kind: "leave", dir: 1 });
    expect(segmentNav("Enter", true, null, 3)).toEqual({ kind: "leave", dir: -1 });
  });

  it("欄に入った直後の → は年から選び始め、← は前の欄へ", () => {
    expect(segmentNav("ArrowRight", false, null, 3)).toEqual({ kind: "select", seg: 0 });
    expect(segmentNav("ArrowLeft", false, null, 3)).toEqual({ kind: "leave", dir: -1 });
  });

  it("Enter と → で 年 → 月 → 日 → 次の欄 と進む", () => {
    for (const key of ["Enter", "ArrowRight"]) {
      expect(segmentNav(key, false, 0, 3)).toEqual({ kind: "select", seg: 1 });
      expect(segmentNav(key, false, 1, 3)).toEqual({ kind: "select", seg: 2 });
      expect(segmentNav(key, false, 2, 3)).toEqual({ kind: "leave", dir: 1 });
    }
  });

  it("Shift+Enter と ← で 日 → 月 → 年 → 前の欄 と戻る", () => {
    for (const [key, shift] of [["Enter", true], ["ArrowLeft", false]] as const) {
      expect(segmentNav(key, shift, 2, 3)).toEqual({ kind: "select", seg: 1 });
      expect(segmentNav(key, shift, 1, 3)).toEqual({ kind: "select", seg: 0 });
      expect(segmentNav(key, shift, 0, 3)).toEqual({ kind: "leave", dir: -1 });
    }
  });

  it("年月（2区画）は 年 → 月 → 次の欄", () => {
    expect(segmentNav("Enter", false, 0, 2)).toEqual({ kind: "select", seg: 1 });
    expect(segmentNav("Enter", false, 1, 2)).toEqual({ kind: "leave", dir: 1 });
  });

  it("関係のないキーは扱わない", () => {
    expect(segmentNav("Tab", false, 1, 3)).toBeNull();
    expect(segmentNav("ArrowUp", false, 1, 3)).toBeNull();
  });
});
