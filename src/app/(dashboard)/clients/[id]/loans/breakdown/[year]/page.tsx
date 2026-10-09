import { redirect } from "next/navigation";

// 借入金及び支払利子の内訳書は、勘定科目内訳明細書の画面に統合した。
// 以前のURL（ブックマーク等）から来た場合はそちらへ移す。
export default async function LegacyLoanBreakdownPage({
  params,
}: {
  params: Promise<{ id: string; year: string }>;
}) {
  const { id, year } = await params;
  redirect(`/clients/${id}/breakdown/${year}/11`);
}
