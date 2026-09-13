/**
 * 帳簿書類の法定保存期間。
 *
 * 保存期間内の削除を止めるために使う。これまで期間の管理が一切無く、
 * 証憑も仕訳もいつでも完全に削除できる状態だった。
 *
 * 期間そのものは電子帳簿保存法ではなく各税法で決まる。電帳法は
 * 「どう保存してよいか」の特例にすぎない。
 */

export type EntityType = "individual" | "corporation";

/** 保存期間の判定に使う条件 */
export type RetentionInput = {
  /** 法人か個人か */
  entityType: EntityType;
  /** その書類が属する事業年度（課税期間）の末日 YYYY-MM-DD */
  fiscalYearEnd: string;
  /** 欠損金・災害損失金が生じた事業年度か（法人のみ。10年になる） */
  hasLossCarryforward?: boolean;
  /** 申告期限の延長特例の月数（法人のみ。0 or 未指定なら特例なし） */
  filingExtensionMonths?: number;
};

/**
 * 保存しなければならない年数。
 *
 *   法人（青色・白色とも）        7年（法規59① / 法規67②）
 *   欠損金が生じた事業年度        10年（法法57⑩、法規26の3）
 *     ※平成30年4月1日**前**開始事業年度は9年
 *   個人（青色）帳簿・決算関係書類 7年（所規63①）
 *   消費税の帳簿・請求書等         7年（消令50①）
 *
 * 株式会社は会社法432②・435④で**会計帳簿・計算書類が10年**。
 * 税法の7年で消せると判断すると会社法違反になるため、
 * 法人は最低10年を採る。
 */
export function retentionYears(input: RetentionInput): number {
  if (input.entityType === "individual") return 7;
  // 法人は会社法の10年が下限。欠損金があっても10年で足りる
  return 10;
}

/**
 * 保存期間の起算日。
 *
 *   法人: 事業年度終了の日の翌日から**2か月**を経過した日（法規59②）。
 *         申告期限の延長特例があれば「延長月数＋2」か月
 *   個人: その年の**翌年3月15日の翌日**（所規63④）
 *
 * タックスアンサーの「申告期限の翌日」は簡略表現で、条文はこの形。
 */
export function retentionStartDate(input: RetentionInput): string {
  const end = new Date(`${input.fiscalYearEnd}T00:00:00Z`);
  if (input.entityType === "individual") {
    // その年の翌年3月15日の翌日＝3月16日
    return `${end.getUTCFullYear() + 1}-03-16`;
  }
  const months = 2 + (input.filingExtensionMonths ?? 0);
  const d = new Date(end);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** 保存期間の満了日（この日までは消せない） */
export function retentionEndDate(input: RetentionInput): string {
  const start = new Date(`${retentionStartDate(input)}T00:00:00Z`);
  start.setUTCFullYear(start.getUTCFullYear() + retentionYears(input));
  start.setUTCDate(start.getUTCDate() - 1);
  return start.toISOString().slice(0, 10);
}

/**
 * その日付時点で、まだ保存しなければならないか。
 * true なら削除してはいけない。
 */
export function isWithinRetention(input: RetentionInput, asOf: string): boolean {
  return asOf <= retentionEndDate(input);
}
