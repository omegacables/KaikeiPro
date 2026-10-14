"use client";

/**
 * 消費税の集計（税区分ごとの取引・科目別税区分表・消費税集計表）。
 * 帳簿ではなく集計表なので、帳簿閲覧から分けてメニューに置いている。中身は帳簿閲覧と共通。
 */

import { LedgerBrowser } from "../ledgers/ledger-browser";

export default function TaxSummaryPage() {
  return <LedgerBrowser mode="tax" />;
}
