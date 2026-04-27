import { redirect } from "next/navigation";

export default async function PortalPage({
  params,
}: {
  params: Promise<{ firm: string }>;
}) {
  const { firm } = await params;
  redirect(`/portal/${firm}/upload`);
}
