import type { Client, Entry, Invoice, Settings } from '../../shared/types.ts';
import { request } from '../api.ts';
import { invoiceDocument } from './invoice.ts';
import { reportDocument } from './report.ts';
import { downloadPdf, openPdf, safeFileName } from './render.ts';

export { usePdfUrl } from './render.ts';
export { invoiceDocument, reportDocument };

type InvoiceWithEntries = Invoice & { entries: Entry[] };

export function invoiceFileName(inv: Pick<Invoice, 'number' | 'language' | 'client'>): string {
  return `${inv.language === 'en' ? 'Invoice' : 'Faktura'}_${safeFileName(inv.number)}_${safeFileName(inv.client.name)}.pdf`;
}

async function loadInvoice(id: number) {
  return request<InvoiceWithEntries>(`/invoices/${id}`);
}

export function openInvoicePdf(id: number, preloaded?: InvoiceWithEntries) {
  return openPdf(async () => {
    const inv = preloaded ?? (await loadInvoice(id));
    return invoiceDocument(inv, inv.entries);
  });
}

export async function downloadInvoicePdf(id: number, preloaded?: InvoiceWithEntries) {
  const inv = preloaded ?? (await loadInvoice(id));
  return downloadPdf(() => invoiceDocument(inv, inv.entries), invoiceFileName(inv));
}

export interface ReportOptions {
  settings: Settings;
  client: Client;
  entries: Entry[];
  from: string;
  to: string;
  showAmounts: boolean;
}

export function openReportPdf(opts: ReportOptions) {
  return openPdf(() => reportDocument(opts));
}

export function downloadReportPdf(opts: ReportOptions) {
  const prefix = opts.client.language === 'en' ? 'Work_report' : 'Izvestaj';
  return downloadPdf(() => reportDocument(opts), `${prefix}_${safeFileName(opts.client.name)}_${opts.from}_${opts.to}.pdf`);
}
