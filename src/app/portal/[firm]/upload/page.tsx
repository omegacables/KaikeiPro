"use client";

import { useState, useRef, useCallback } from "react";
import {
  Camera,
  Upload,
  CreditCard,
  Banknote,
  Smartphone,
  Building2,
  Check,
  X,
  Loader2,
  FileText,
  History,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/providers/auth-provider";
import { uploadReceipt } from "@/actions/receipt-storage";
import { useParams } from "next/navigation";
import Link from "next/link";

const paymentMethods = [
  { key: "cash", label: "現金", icon: Banknote },
  { key: "card", label: "カード", icon: CreditCard },
  { key: "e_money", label: "電子マネー", icon: Smartphone },
  { key: "bank_transfer", label: "振込", icon: Building2 },
];

export default function UploadPage() {
  const { user } = useAuth();
  const params = useParams();
  const firm = params.firm as string;
  const [selectedMethod, setSelectedMethod] = useState("cash");
  const [uploaded, setUploaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  };

  const processFile = (file: File) => {
    setError(null);
    setSelectedFile(file);

    // 画像プレビュー生成
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  };

  const handleClearFile = () => {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  }, []);

  const handleUpload = async () => {
    if (!selectedFile || !user?.clientId) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("client_id", user.clientId);
      formData.append("uploaded_by", user.id);
      formData.append("payment_method", selectedMethod);

      await uploadReceipt(formData);

      setUploaded(true);
      handleClearFile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  };

  if (uploaded) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="size-20 rounded-full bg-success/20 flex items-center justify-center text-success">
          <Check className="size-10" />
        </div>
        <h2 className="text-xl font-bold text-foreground">アップロード完了</h2>
        <p className="text-muted-foreground text-sm text-center">
          領収書がアップロードされました。
          <br />
          AIが自動で読み取りを行います。
        </p>
        <div className="flex flex-col gap-3 mt-4 w-full max-w-xs">
          <Button onClick={() => setUploaded(false)}>
            <Camera className="size-5" />
            続けて撮影
          </Button>
          <Link href={`/portal/${firm}/receipts`} className="w-full">
            <Button variant="outline" className="w-full">
              <History className="size-5" />
              履歴を見る
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <h2 className="text-lg font-bold text-foreground mb-4">
        領収書をアップロード
      </h2>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        capture="environment"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Camera / file area */}
      <Card className="mb-6 overflow-hidden">
        {selectedFile && previewUrl ? (
          <div className="relative">
            <img
              src={previewUrl}
              alt="プレビュー"
              className="w-full max-h-64 object-contain bg-charcoal/5"
            />
            <button
              onClick={handleClearFile}
              className="absolute top-2 right-2 size-8 rounded-full bg-charcoal/70 text-cream flex items-center justify-center"
            >
              <X className="size-4" />
            </button>
            <div className="px-4 py-2 bg-card border-t border-border">
              <p className="text-xs text-muted-foreground truncate">
                {selectedFile.name} ({(selectedFile.size / 1024).toFixed(0)} KB)
              </p>
            </div>
          </div>
        ) : selectedFile ? (
          <div className="aspect-[4/3] bg-charcoal/5 flex flex-col items-center justify-center gap-2 relative">
            <FileText className="size-10 text-primary" />
            <p className="text-sm text-foreground font-medium truncate max-w-[80%]">
              {selectedFile.name}
            </p>
            <p className="text-xs text-muted-foreground">
              PDF / {(selectedFile.size / 1024).toFixed(0)} KB
            </p>
            <button
              onClick={handleClearFile}
              className="absolute top-2 right-2 size-8 rounded-full bg-charcoal/70 text-cream flex items-center justify-center"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <div
            className={cn(
              "aspect-[4/3] flex flex-col items-center justify-center gap-4 cursor-pointer transition-all",
              "border-2 border-dashed rounded-xl m-2",
              isDragOver
                ? "border-primary bg-primary/10"
                : "border-muted-foreground/30 bg-charcoal/5 hover:border-primary/50 hover:bg-charcoal/10"
            )}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <Camera className="size-8" />
            </div>
            <div className="text-center px-4">
              <p className="text-foreground font-bold text-sm">
                タップして撮影 または ファイルを選択
              </p>
              <p className="text-muted-foreground text-xs mt-1.5">
                ここにドラッグ&ドロップも可能です
              </p>
              <p className="text-muted-foreground text-[10px] mt-1">
                JPG, PNG, PDF対応 / 最大10MB
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-primary/60">
              <Upload className="size-4" />
              <span className="text-xs font-medium">アップロード</span>
            </div>
          </div>
        )}
      </Card>

      {/* Error message */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Payment method */}
      <p className="text-sm font-bold text-foreground mb-3">支払い方法</p>
      <div className="grid grid-cols-4 gap-2 mb-6">
        {paymentMethods.map((method) => (
          <button
            key={method.key}
            onClick={() => setSelectedMethod(method.key)}
            className={cn(
              "flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all cursor-pointer",
              selectedMethod === method.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:border-primary/30"
            )}
          >
            <method.icon className="size-5" />
            <span className="text-[10px] font-medium">{method.label}</span>
          </button>
        ))}
      </div>

      {/* Batch upload info */}
      <Card className="p-4 mb-6 bg-primary/5 border-primary/20">
        <p className="text-sm font-medium text-foreground">
          複数枚アップロード
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          複数の領収書をまとめて選択してアップロードできます。
        </p>
      </Card>

      {/* Upload button */}
      <Button
        className="w-full py-4 text-base"
        onClick={handleUpload}
        disabled={!selectedFile || uploading || !user?.clientId}
      >
        {uploading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="size-5 animate-spin" />
            <span>アップロード中...</span>
          </div>
        ) : (
          <>
            <Upload className="size-5" />
            アップロード
          </>
        )}
      </Button>

      {/* Uploading overlay */}
      {uploading && (
        <div className="mt-4">
          <Card className="p-4 bg-primary/5 border-primary/20">
            <div className="flex items-center gap-3">
              <Loader2 className="size-5 text-primary animate-spin shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">処理中です...</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  ファイルをアップロードしています。しばらくお待ちください。
                </p>
              </div>
            </div>
            <div className="mt-3 w-full bg-muted/40 h-1.5 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-primary animate-pulse w-full" />
            </div>
          </Card>
        </div>
      )}

      {!user?.clientId && (
        <p className="text-xs text-muted-foreground text-center mt-2">
          ログインしてからアップロードしてください
        </p>
      )}
    </>
  );
}
