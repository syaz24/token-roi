'use client';

import { Download } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Button } from './ui';

/** Exports respect whatever filters are currently in the URL. */
export function ExportButton({ type, label }: { type: string; label: string }) {
  const sp = useSearchParams();

  function download() {
    const params = new URLSearchParams(sp.toString());
    params.set('type', type);
    window.location.href = `/api/export?${params.toString()}`;
  }

  return (
    <Button onClick={download}>
      <Download size={11} />
      {label}
    </Button>
  );
}
