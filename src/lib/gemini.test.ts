import { describe, it, expect } from "vitest";
import { toFriendlyGeminiError, extractJson, normalizeConfidence } from "./gemini";

describe("toFriendlyGeminiError", () => {
  it("クレジット切れは、追加すれば再開できることまで伝える", () => {
    const msg = toFriendlyGeminiError(
      new Error(
        "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/" +
          "v1beta/models/gemini-2.5-flash:generateContent: [429 Too Many Requests] " +
          "Your prepayment credits are depleted. Please go to AI Studio to manage your project and billing."
      )
    ).message;

    expect(msg).toContain("利用枠");
    expect(msg).toContain("クレジットを追加");
    // 手入力は使えることを併記して、業務が止まらないようにする
    expect(msg).toContain("手入力");
    expect(msg).not.toContain("429");
  });

  it("短時間の集中による制限は、待てば直ることを伝える", () => {
    const msg = toFriendlyGeminiError(new Error("[429] rate limit exceeded")).message;
    expect(msg).toContain("集中");
    expect(msg).toContain("待って");
  });

  it("APIキーの不備は設定を見るよう伝える", () => {
    expect(toFriendlyGeminiError(new Error("[403] API key not valid")).message).toContain(
      "GOOGLE_API_KEY"
    );
  });

  it("AI側の一時障害は時間をおくよう伝える", () => {
    expect(toFriendlyGeminiError(new Error("[503] model is overloaded")).message).toContain(
      "混み合って"
    );
  });

  it("通信断はネットワークを確認するよう伝える", () => {
    expect(toFriendlyGeminiError(new Error("fetch failed")).message).toContain("通信");
  });

  it("分類できないエラーは、元の内容を残したまま日本語で包む", () => {
    const msg = toFriendlyGeminiError(new Error("something unexpected")).message;
    expect(msg).toContain("AIの処理に失敗しました");
    expect(msg).toContain("something unexpected");
  });
});

describe("extractJson", () => {
  it("説明文が混ざっていてもJSONを取り出す", () => {
    expect(
      extractJson<{ a: number }>('こちらが結果です。\n{"a":1}\n以上です。')
    ).toEqual({ a: 1 });
  });

  it("JSONが無ければ日本語で知らせる", () => {
    expect(() => extractJson("JSONがありません", "テスト")).toThrow(/テストのJSON解析に失敗/);
  });

  it("括弧が閉じていなければ「見つからない」扱いにする", () => {
    expect(() => extractJson('{"a":', "テスト")).toThrow(/テストのJSON解析に失敗/);
  });

  it("括弧はあるが中身が壊れていれば形式が不正だと知らせる", () => {
    expect(() => extractJson('{"a": }', "テスト")).toThrow(/テストのJSON形式が不正/);
  });
});

describe("normalizeConfidence", () => {
  it("0〜1に収める", () => {
    expect(normalizeConfidence(0.75)).toBe(0.75);
    expect(normalizeConfidence(1.5)).toBe(1);
    expect(normalizeConfidence(-1)).toBe(0);
  });

  it("数値でなければ0にする（推測で高い値を入れない）", () => {
    expect(normalizeConfidence("たぶん高い")).toBe(0);
    expect(normalizeConfidence(undefined)).toBe(0);
  });
});
