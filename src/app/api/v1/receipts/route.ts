import { handleApi } from "@/lib/external-api/http";
import { ApiError, registerReceiptFromApi } from "@/lib/external-api/core";

// 証憑の受け口（multipart/form-data）。同じファイルが登録済みならその id を返す
export const dynamic = "force-dynamic";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : null);

export function POST(req: Request) {
  return handleApi(req, "receipts:write", async (store, ctx) => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ApiError(400, "invalid_multipart", "本文を multipart/form-data として読めません");
    }
    const f = form.get("file");
    const file =
      f && typeof f !== "string"
        ? { bytes: new Uint8Array(await f.arrayBuffer()), type: f.type, size: f.size, name: f.name }
        : null;
    return registerReceiptFromApi(store, ctx, {
      file,
      paymentMethod: str(form.get("payment_method")),
      direction: str(form.get("direction")),
      originalFilename: str(form.get("original_filename")),
    });
  });
}
