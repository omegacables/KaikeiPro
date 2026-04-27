"use client";

import { useState } from "react";
import { Shield, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { verifyReceiptIntegrity } from "@/actions/receipt-storage";

interface ReceiptIntegrityBadgeProps {
  receiptId: string;
  fileHash: string | null;
  hashVerifiedAt: string | null;
  showVerifyButton?: boolean;
}

export function ReceiptIntegrityBadge({
  receiptId,
  fileHash,
  hashVerifiedAt,
  showVerifyButton = false,
}: ReceiptIntegrityBadgeProps) {
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<{ valid: boolean; verifiedAt: string } | null>(null);

  async function handleVerify() {
    setVerifying(true);
    try {
      const res = await verifyReceiptIntegrity(receiptId);
      setResult({ valid: res.valid, verifiedAt: res.verifiedAt });
    } catch (e) {
      console.error("Integrity verification failed:", e);
      setResult({ valid: false, verifiedAt: new Date().toISOString() });
    } finally {
      setVerifying(false);
    }
  }

  // Result from manual verification overrides stored state
  if (result) {
    return (
      <div className="flex items-center gap-2">
        {result.valid ? (
          <Badge variant="success" className="gap-1">
            <ShieldCheck className="size-3" />
            検証済み
          </Badge>
        ) : (
          <Badge variant="destructive" className="gap-1">
            <ShieldAlert className="size-3" />
            不一致
          </Badge>
        )}
      </div>
    );
  }

  // No hash stored (legacy receipt)
  if (!fileHash) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="muted" className="gap-1">
          <Shield className="size-3" />
          未対応
        </Badge>
      </div>
    );
  }

  // Hash exists but not yet verified
  if (!hashVerifiedAt) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="warning" className="gap-1">
          <Shield className="size-3" />
          未検証
        </Badge>
        {showVerifyButton && (
          <Button size="sm" variant="outline" onClick={handleVerify} disabled={verifying}>
            {verifying ? <Loader2 className="size-3 animate-spin" /> : "検証"}
          </Button>
        )}
      </div>
    );
  }

  // Hash exists and was verified
  return (
    <div className="flex items-center gap-2">
      <Badge variant="success" className="gap-1">
        <ShieldCheck className="size-3" />
        検証済み
      </Badge>
      {showVerifyButton && (
        <Button size="sm" variant="outline" onClick={handleVerify} disabled={verifying}>
          {verifying ? <Loader2 className="size-3 animate-spin" /> : "再検証"}
        </Button>
      )}
    </div>
  );
}
