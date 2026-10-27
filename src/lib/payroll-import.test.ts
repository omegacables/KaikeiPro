import { describe, it, expect } from "vitest";
import {
  classifyLabel,
  gridFromPositionedText,
  parseAmount,
  parseDate,
  parseMonth,
  parsePayrollGrid,
} from "./payroll-import";
import { decodeText, gridFromText, payrollFileKind } from "./payroll-file";
import { encodeSjis } from "./sjis";

// テストの人名・金額はすべて架空

describe("値の読み方", () => {
  it("金額", () => {
    expect(parseAmount("250,000")).toBe(250000);
    expect(parseAmount("¥250,000")).toBe(250000);
    expect(parseAmount("２５０，０００円")).toBe(250000);
    expect(parseAmount("△1,000")).toBe(-1000);
    expect(parseAmount("(1,000)")).toBe(-1000);
    expect(parseAmount("-")).toBe(0);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("山田")).toBeNull();
  });

  it("対象月と支給日（西暦・和暦・区切りの違い）", () => {
    expect(parseMonth("2026年10月分")).toBe("2026-10");
    expect(parseMonth("2026/4")).toBe("2026-04");
    expect(parseMonth("2026-10-01")).toBe("2026-10");
    expect(parseMonth("令和8年10月")).toBe("2026-10");
    expect(parseMonth("R8.4")).toBe("2026-04");
    expect(parseMonth("給与明細_2026年9月分.xlsx")).toBe("2026-09");
    expect(parseMonth("20◯◯年◯月分")).toBeNull();
    expect(parseDate("2026年10月15日")).toBe("2026-10-15");
    expect(parseDate("令和8年7月5日")).toBe("2026-07-05");
    expect(parseDate("2026/2/30")).toBeNull();
  });

  it("項目名の見分け（言い方の違い）", () => {
    expect(classifyLabel("源泉所得税（乙欄）")).toBe("income_tax");
    expect(classifyLabel("健康保険料")).toBe("health");
    expect(classifyLabel("介護保険料")).toBe("health");
    expect(classifyLabel("厚生年金保険料")).toBe("pension");
    expect(classifyLabel("雇用保険料")).toBe("employment");
    expect(classifyLabel("社会保険料")).toBe("social_lump");
    expect(classifyLabel("差引支給額")).toBe("net");
    expect(classifyLabel("総支給額")).toBe("gross");
    expect(classifyLabel("控除合計")).toBe("deduction_total");
    expect(classifyLabel("時間外手当")).toBe("earning");
    expect(classifyLabel("残業時間")).toBe("ignore");
    expect(classifyLabel("役員報酬")).toBe("officer_pay");
    expect(classifyLabel("財形貯蓄")).toBe("other_deduction");
  });
});

describe("横型の台帳（1行が1人）", () => {
  it("複数の人を読み、合計の行は飛ばす。総支給額が無ければ支給項目を足す", () => {
    const grid = [
      ["2026年4月分 給与台帳"],
      ["社員番号", "氏名", "役職", "基本給", "時間外手当", "通勤手当", "残業時間", "健康保険", "厚生年金", "雇用保険", "所得税", "住民税", "差引支給額"],
      ["001", "山田 太郎", "代表取締役", "400,000", "", "", "", "20,000", "36,600", "", "12,000", "15,000", "316,400"],
      ["002", "佐藤 花子", "", "220,000", "15,000", "10,000", "12", "11,000", "20,130", "1,350", "4,770", "8,000", "199,750"],
      ["", "合計", "", "620,000", "15,000", "10,000", "", "31,000", "56,730", "1,350", "16,770", "23,000", "516,150"],
    ];
    const r = parsePayrollGrid(grid, { fileName: "給与台帳_2026年4月.csv" });
    expect(r.records).toHaveLength(2);
    const [a, b] = r.records;
    expect(a).toMatchObject({
      employee_name: "山田 太郎",
      employee_type: "officer",
      pay_month: "2026-04",
      gross_salary: 400000,
      health_insurance: 20000,
      pension_insurance: 36600,
      income_tax: 12000,
      resident_tax: 15000,
      net_pay: 316400,
    });
    expect(a.warnings).toEqual([]);
    // 残業時間（12）は金額に入れない
    expect(b).toMatchObject({ employee_name: "佐藤 花子", employee_type: "employee", gross_salary: 245000, employment_insurance: 1350, net_pay: 199750 });
    expect(b.warnings).toEqual([]);
  });

  it("差引支給額が計算と合わなければ知らせる・見分けられない列は数えずに知らせる", () => {
    const grid = [
      ["氏名", "支給月", "総支給額", "所得税", "謎の列", "差引支給額"],
      ["鈴木 一郎", "2026/05", "300000", "7000", "500", "290000"],
    ];
    const [d] = parsePayrollGrid(grid).records;
    expect(d.pay_month).toBe("2026-05");
    expect(d.net_pay).toBe(293000);
    expect(d.warnings.join("\n")).toContain("差引支給額がファイルでは 290,000円");
    expect(d.warnings.join("\n")).toContain("謎の列");
  });
});

describe("縦型（給与明細・賃金台帳）", () => {
  it("1人分の給与明細。合計の欄が空（数式の結果なし）でも計算する。氏名の添え書きは外して役員にする", () => {
    const grid = [
      ["給 与 明 細 書"],
      ["株式会社サンプル"],
      [],
      ["対象月", "2026年10月分", ""],
      ["支給日", "2026年10月15日", ""],
      ["氏名", "見本 太郎（代表取締役）", "見本 太郎（代表取締役）"],
      [],
      ["支給"],
      ["役員報酬", "", "300000"],
      ["支給合計", "", ""],
      ["控除"],
      ["源泉所得税（乙欄）", "", "30000"],
      ["社会保険料", "", "0"],
      ["住民税", "", "0"],
      ["寮費", "", "5000"],
      ["控除合計", "", ""],
      ["差引支給額", "", ""],
      ["【備考】"],
      ["・月額300,000円／毎月15日"],
    ];
    const r = parsePayrollGrid(grid);
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({
      employee_name: "見本 太郎",
      employee_type: "officer",
      pay_month: "2026-10",
      pay_date: "2026-10-15",
      gross_salary: 300000,
      income_tax: 30000,
      // 控除の欄の見分けられない項目（寮費は分かるが、ここでは控除の欄の項目として数える）
      other_deduction: 5000,
      net_pay: 265000,
    });
    expect(r.records[0].warnings).toEqual([]);
  });

  it("社会保険料がまとめて書かれていれば健康保険に入れて知らせる・控除合計との差はその他控除", () => {
    const grid = [
      ["氏名", "見本 花子"],
      ["対象月", "令和8年6月"],
      ["基本給", "200000"],
      ["社会保険料", "29000"],
      ["所得税", "4000"],
      ["控除合計", "36000"],
    ];
    const [d] = parsePayrollGrid(grid).records;
    expect(d).toMatchObject({ pay_month: "2026-06", health_insurance: 29000, other_deduction: 3000, net_pay: 164000 });
    expect(d.warnings.join("\n")).toContain("社会保険料");
    expect(d.warnings.join("\n")).toContain("その他控除");
  });

  it("月が横に並ぶ1人の賃金台帳は、月ごとに1件", () => {
    const grid = [
      ["賃金台帳"],
      ["氏名", "見本 次郎"],
      ["", "2026年4月", "2026年5月", "2026年6月"],
      ["基本給", "250,000", "250,000", "260,000"],
      ["健康保険", "12,500", "12,500", "13,000"],
      ["所得税", "5,000", "5,000", "5,500"],
    ];
    const r = parsePayrollGrid(grid);
    expect(r.records.map((d) => [d.employee_name, d.pay_month, d.gross_salary, d.net_pay])).toEqual([
      ["見本 次郎", "2026-04", 250000, 232500],
      ["見本 次郎", "2026-05", 250000, 232500],
      ["見本 次郎", "2026-06", 260000, 241500],
    ]);
  });

  it("給与の表でなければ何も作らず知らせる", () => {
    const r = parsePayrollGrid([["振込明細"], ["振込先", "見本銀行"], ["金額", "224,000"]]);
    expect(r.records).toEqual([]);
    expect(r.warnings[0]).toContain("見つかりませんでした");
  });
});

describe("ファイルの形", () => {
  it("Shift_JIS の CSV も読める（給与ソフトの書き出し）", () => {
    const csv = "氏名,支給月,総支給額,所得税\r\n見本 三郎,2026/07,180000,2000\r\n";
    const { bytes } = encodeSjis(csv);
    const text = decodeText(bytes);
    const [d] = parsePayrollGrid(gridFromText(text)).records;
    expect(d).toMatchObject({ employee_name: "見本 三郎", pay_month: "2026-07", gross_salary: 180000, net_pay: 178000 });
  });

  it("タブ区切りも読める", () => {
    const grid = gridFromText("氏名\t総支給額\t所得税\n見本 四郎\t100000\t0\n");
    expect(parsePayrollGrid(grid, { fileName: "2026年8月.tsv" }).records[0]).toMatchObject({ pay_month: "2026-08", gross_salary: 100000 });
  });

  it("PDF の文字の位置から表を組み立てる（同じ高さは1行、近い文字は1つのセル）", () => {
    const items = [
      { str: "氏名", x: 57, y: 670, width: 20 },
      { str: "見本", x: 210, y: 670, width: 24 },
      { str: "五郎（取締役）", x: 240, y: 670, width: 70 },
      { str: "対象月", x: 57, y: 704, width: 30 },
      { str: "2026年9月分", x: 233, y: 704, width: 60 },
      { str: "役員報酬", x: 57, y: 624, width: 40 },
      { str: "150,000", x: 328, y: 624, width: 35 },
      { str: "源泉所得税", x: 57, y: 561, width: 50 },
      { str: "3,000", x: 334, y: 562, width: 25 },
      { str: "住民税", x: 57, y: 527, width: 30 },
      { str: "-", x: 368, y: 527, width: 5 },
    ];
    const grid = gridFromPositionedText(items);
    expect(grid[0]).toEqual(["対象月", "2026年9月分"]);
    expect(grid[1]).toEqual(["氏名", "見本 五郎（取締役）"]);
    const [d] = parsePayrollGrid(grid).records;
    expect(d).toMatchObject({ employee_name: "見本 五郎", employee_type: "officer", pay_month: "2026-09", gross_salary: 150000, income_tax: 3000, net_pay: 147000 });
  });

  it("ファイルの種類", () => {
    expect(payrollFileKind("a.CSV")).toBe("text");
    expect(payrollFileKind("a.xlsx")).toBe("excel");
    expect(payrollFileKind("a.pdf")).toBe("pdf");
    expect(payrollFileKind("a.jpg")).toBe("image");
    expect(payrollFileKind("a.xls")).toBe("unsupported");
  });
});

describe("Excel の読み込み", () => {
  it("結合したセル・計算結果の無い数式があっても読める", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("給与明細");
    ws.getCell("A1").value = "対象月";
    ws.getCell("B1").value = "2026年11月分";
    ws.getCell("A2").value = "氏名";
    ws.getCell("B2").value = "見本 六子";
    ws.mergeCells("B2:C2");
    ws.getCell("A3").value = "基本給";
    ws.getCell("C3").value = 210000;
    ws.getCell("A4").value = "所得税";
    ws.getCell("C4").value = 4500;
    ws.getCell("A5").value = "差引支給額";
    ws.getCell("C5").value = { formula: "C3-C4" } as never;
    const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const { gridsFromExcel } = await import("./payroll-file");
    const [{ grid }] = await gridsFromExcel(buf);
    const [d] = parsePayrollGrid(grid).records;
    expect(d).toMatchObject({ employee_name: "見本 六子", pay_month: "2026-11", gross_salary: 210000, net_pay: 205500 });
    expect(d.warnings).toEqual([]);
  });
});
