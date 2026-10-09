import { useEffect, useState } from 'react';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

// PDF se pravi u browseru (pdfmake). Biblioteka i fontovi (~2 MB) se učitavaju tek kad zatrebaju.
async function loadPdfMake() {
  const [pdfMakeModule, vfsModule] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]);
  const pdfMake = ((pdfMakeModule as { default?: unknown }).default ?? pdfMakeModule) as typeof import('pdfmake/build/pdfmake');
  const vfs = ((vfsModule as { default?: unknown }).default ?? vfsModule) as Record<string, string>;
  return { pdfMake, vfs };
}

export async function pdfBlob(doc: TDocumentDefinitions): Promise<Blob> {
  const { pdfMake, vfs } = await loadPdfMake();
  return new Promise((resolve) => pdfMake.createPdf(doc, undefined, undefined, vfs).getBlob(resolve));
}

/** Ime fajla samo od ASCII znakova (browseri ponekad odbace ime sa č, ć, š, ž, đ). */
export function safeFileName(s: string): string {
  return s
    .replace(/đ/g, 'dj')
    .replace(/Đ/g, 'Dj')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '');
}

/** Otvara PDF u novom tabu. Tab se otvara odmah (pre generisanja) da ga browser ne bi blokirao. */
export async function openPdf(build: () => Promise<TDocumentDefinitions> | TDocumentDefinitions) {
  const win = window.open('', '_blank');
  try {
    const url = URL.createObjectURL(await pdfBlob(await build()));
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch (err) {
    win?.close();
    throw err;
  }
}

export async function downloadPdf(build: () => Promise<TDocumentDefinitions> | TDocumentDefinitions, fileName: string) {
  const url = URL.createObjectURL(await pdfBlob(await build()));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Pravi blob URL za pregled u <iframe>; ponovo se generiše kad se dokument promeni. */
export function usePdfUrl(doc: TDocumentDefinitions | null): { url: string | null; error: string | null } {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let created: string | null = null;
    pdfBlob(doc)
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
        setError(null);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [doc]);
  return { url, error };
}
