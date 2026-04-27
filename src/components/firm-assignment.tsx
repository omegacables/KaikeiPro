"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Building2 } from "lucide-react";
import { assignClientToFirm } from "@/actions/clients";

interface Firm {
  id: string;
  name: string;
}

interface FirmAssignmentProps {
  clientId: string;
  currentFirmId: string | null;
  currentFirmName: string | null;
  firms: Firm[];
}

export function FirmAssignment({
  clientId,
  currentFirmId,
  currentFirmName,
  firms,
}: FirmAssignmentProps) {
  const [selectedFirmId, setSelectedFirmId] = useState<string>(currentFirmId ?? "");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const hasChanged = (selectedFirmId || null) !== currentFirmId;

  function handleSave() {
    setSaved(false);
    startTransition(async () => {
      await assignClientToFirm(clientId, selectedFirmId || null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Building2 className="size-4 text-muted-foreground" />
      <span className="text-muted-foreground text-sm">所属事務所:</span>
      {currentFirmId === null && !hasChanged && (
        <Badge variant="warning">未所属</Badge>
      )}
      <select
        value={selectedFirmId}
        onChange={(e) => {
          setSelectedFirmId(e.target.value);
          setSaved(false);
        }}
        className="text-sm border border-border rounded px-2 py-1 bg-background text-foreground"
      >
        <option value="">未所属</option>
        {firms.map((firm) => (
          <option key={firm.id} value={firm.id}>
            {firm.name}
          </option>
        ))}
      </select>
      {hasChanged && (
        <button
          onClick={handleSave}
          disabled={isPending}
          className="text-xs px-3 py-1 rounded bg-primary text-white hover:bg-primary-dark disabled:opacity-50"
        >
          {isPending ? "保存中..." : "保存"}
        </button>
      )}
      {saved && (
        <span className="text-xs text-green-600">保存しました</span>
      )}
    </div>
  );
}
