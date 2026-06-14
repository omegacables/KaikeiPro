import { NextResponse } from "next/server";

// デプロイ確認用の公開エンドポイント。Vercel が公開する Git 情報を返す。
// 本番にどのコミットが反映されているかを外部から確認できる。
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    env: process.env.VERCEL_ENV ?? "unknown",
    now: new Date().toISOString(),
  });
}
