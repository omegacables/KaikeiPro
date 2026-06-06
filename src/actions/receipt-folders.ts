"use server";

import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase";

export interface ReceiptFolder {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
}

export async function getFolders(clientId: string): Promise<ReceiptFolder[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("receipt_folders")
    .select("*")
    .eq("client_id", clientId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
  }));
}

export async function createFolder(
  clientId: string,
  name: string,
  parentId?: string
): Promise<ReceiptFolder> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("receipt_folders")
    .insert({
      client_id: clientId,
      name: name.trim(),
      parent_id: parentId ?? null,
      created_by: user?.id ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  return {
    id: data.id,
    name: data.name,
    parentId: data.parent_id,
    sortOrder: data.sort_order,
  };
}

export async function renameFolder(folderId: string, name: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("receipt_folders")
    .update({ name: name.trim() })
    .eq("id", folderId);

  if (error) throw new Error(error.message);
}

export async function deleteFolder(folderId: string): Promise<void> {
  const admin = createAdminSupabaseClient();

  // フォルダ内の領収書のfolder_idをnullにする
  await admin
    .from("receipts")
    .update({ folder_id: null })
    .eq("folder_id", folderId);

  // フォルダを削除
  const { error } = await admin
    .from("receipt_folders")
    .delete()
    .eq("id", folderId);

  if (error) throw new Error(error.message);
}

export async function moveReceiptToFolder(
  receiptId: string,
  folderId: string | null
): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("receipts")
    .update({ folder_id: folderId })
    .eq("id", receiptId);

  if (error) throw new Error(error.message);
}
