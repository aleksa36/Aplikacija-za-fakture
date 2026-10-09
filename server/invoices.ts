import { db, ENTRY_SELECT, getSettings, mapClient, mapEntry, round2, transaction } from './db.ts';
import { formatDate, formatInvoiceNumber } from '../shared/format.ts';
import type {
  Client,
  Entry,
  Invoice,
  InvoiceCreateInput,
  InvoiceItem,
  InvoiceUpdateInput,
  Settings,
} from '../shared/types.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------- Brojevi faktura ----------

/** Pokušava da iz broja fakture izvuče redni broj prema formatu. */
export function parseInvoiceSeq(format: string, number: string): number | null {
  // Vitičaste zagrade se ne escape-uju jer označavaju tokene.
  const escaped = format.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const pattern = escaped
    .replace(/\{n+\}/g, '(\\d+)')
    .replace(/\{yyyy\}/g, '\\d{4}')
    .replace(/\{yy\}/g, '\\d{2}')
    .replace(/\{mm\}/g, '\\d{2}');
  const match = new RegExp(`^${pattern}$`).exec(number.trim());
  return match ? Number(match[1]) : null;
}

export function nextInvoiceNumber(issueDate: string): { number: string; seq: number } {
  const year = Number(issueDate.slice(0, 4));
  const row = db.prepare('SELECT MAX(seq) AS max FROM invoices WHERE year = ?').get(year) as { max: number | null };
  const seq = (row.max ?? 0) + 1;
  return { number: formatInvoiceNumber(getSettings().invoiceNumberFormat, seq, issueDate), seq };
}

function resolveSeq(number: string, issueDate: string, excludeId?: number): { year: number; seq: number } {
  const year = Number(issueDate.slice(0, 4));
  const parsed = parseInvoiceSeq(getSettings().invoiceNumberFormat, number);
  if (parsed !== null) return { year, seq: parsed };
  if (excludeId) {
    const row = db.prepare('SELECT seq, year FROM invoices WHERE id = ?').get(excludeId) as { seq: number; year: number };
    if (row.year === year) return { year, seq: row.seq };
  }
  return { year, seq: nextInvoiceNumber(issueDate).seq };
}

function assertNumberFree(number: string, excludeId?: number) {
  const row = db.prepare('SELECT id FROM invoices WHERE number = ? AND id != ?').get(number.trim(), excludeId ?? 0);
  if (row) throw new HttpError(409, `Faktura sa brojem "${number}" već postoji.`);
}

// ---------- Učitavanje ----------

export function computeTotals(items: InvoiceItem[], vatRate: number) {
  const subtotal = round2(items.reduce((sum, it) => sum + round2(it.quantity * it.unitPrice), 0));
  const vatAmount = round2((subtotal * vatRate) / 100);
  return { subtotal, vatAmount, total: round2(subtotal + vatAmount) };
}

function loadItems(invoiceId: number): InvoiceItem[] {
  return db
    .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position, id')
    .all(invoiceId)
    .map((r) => ({
      id: r.id as number,
      description: r.description as string,
      quantity: r.quantity as number,
      unit: r.unit as string,
      unitPrice: r.unit_price as number,
      amount: round2((r.quantity as number) * (r.unit_price as number)),
    }));
}

function mapInvoice(r: Record<string, unknown>, items: InvoiceItem[]): Invoice {
  const vatRate = r.vat_rate as number;
  return {
    id: r.id as number,
    number: r.number as string,
    year: r.year as number,
    seq: r.seq as number,
    clientId: r.client_id as number,
    issueDate: r.issue_date as string,
    serviceDate: r.service_date as string,
    dueDate: r.due_date as string,
    place: r.place as string,
    currency: r.currency as Invoice['currency'],
    language: r.language as Invoice['language'],
    vatRate,
    notes: r.notes as string,
    status: r.status as Invoice['status'],
    paidDate: (r.paid_date as string | null) ?? null,
    periodFrom: (r.period_from as string | null) ?? null,
    periodTo: (r.period_to as string | null) ?? null,
    includeReport: !!r.include_report,
    client: JSON.parse(r.client_json as string) as Client,
    seller: JSON.parse(r.seller_json as string) as Settings,
    createdAt: r.created_at as string,
    items,
    ...computeTotals(items, vatRate),
    clientName: (r.client_name as string | undefined) ?? undefined,
    entryCount: (r.entry_count as number | undefined) ?? undefined,
  };
}

export function getInvoice(id: number): Invoice {
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'Faktura ne postoji.');
  return mapInvoice(row, loadItems(id));
}

export function getInvoiceEntries(id: number): Entry[] {
  return db.prepare(`${ENTRY_SELECT} WHERE e.invoice_id = ? ORDER BY e.date, e.id`).all(id).map(mapEntry);
}

export function listInvoices(filter: { clientId?: number; status?: string; year?: number }): Invoice[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.clientId) {
    where.push('i.client_id = ?');
    params.push(filter.clientId);
  }
  if (filter.status) {
    where.push('i.status = ?');
    params.push(filter.status);
  }
  if (filter.year) {
    where.push('i.year = ?');
    params.push(filter.year);
  }
  const rows = db
    .prepare(
      `SELECT i.*, c.name AS client_name,
              (SELECT COUNT(*) FROM entries e WHERE e.invoice_id = i.id) AS entry_count
       FROM invoices i JOIN clients c ON c.id = i.client_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY i.issue_date DESC, i.year DESC, i.seq DESC`,
    )
    .all(...params);
  return rows.map((r) => mapInvoice(r, loadItems(r.id as number)));
}

// ---------- Kreiranje i izmena ----------

function getClient(id: number): Client {
  const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'Klijent ne postoji.');
  return mapClient(row);
}

export function defaultInvoiceNotes(client: Client, settings: Settings = getSettings()): string {
  const base = client.language === 'en' ? settings.defaultInvoiceNoteEn : settings.defaultInvoiceNote;
  return [client.invoiceNote, base].filter((s) => s && s.trim()).join('\n');
}

/** Pretvara stavke rada u stavke fakture. */
export function buildItems(
  entries: Entry[],
  grouping: 'grouped' | 'detailed',
  client: Client,
  settings: Settings,
  period: { from: string | null; to: string | null },
): InvoiceItem[] {
  const lang = client.language;
  const hourUnit = lang === 'en' ? 'h' : 'sat';
  const pieceUnit = lang === 'en' ? 'pcs' : 'kom';
  const items: InvoiceItem[] = [];
  const fixed = entries.filter((e) => e.fixedAmount !== null);
  const hourly = entries.filter((e) => e.fixedAmount === null && e.hours > 0);

  if (grouping === 'detailed') {
    for (const e of entries) {
      if (e.fixedAmount !== null) {
        items.push({ description: e.description, quantity: 1, unit: pieceUnit, unitPrice: e.fixedAmount });
      } else if (e.hours > 0) {
        items.push({
          description: `${formatDate(e.date, lang)} – ${e.description}`.trim(),
          quantity: e.hours,
          unit: hourUnit,
          unitPrice: e.effectiveRate ?? client.hourlyRate,
        });
      }
    }
    return items;
  }

  // Grupisano: sati po satnici u jednu stavku, paušalne stavke posebno.
  const byRate = new Map<number, number>();
  for (const e of hourly) {
    const rate = e.effectiveRate ?? client.hourlyRate;
    byRate.set(rate, (byRate.get(rate) ?? 0) + e.hours);
  }
  const base = lang === 'en' ? settings.serviceDescriptionEn : settings.serviceDescription;
  const periodText =
    period.from && period.to
      ? lang === 'en'
        ? ` for the period ${formatDate(period.from, lang)} – ${formatDate(period.to, lang)}`
        : ` za period ${formatDate(period.from, lang)} – ${formatDate(period.to, lang)}`
      : '';
  for (const [rate, hours] of byRate) {
    items.push({ description: `${base}${periodText}`, quantity: round2(hours), unit: hourUnit, unitPrice: rate });
  }
  for (const e of fixed) {
    items.push({ description: e.description, quantity: 1, unit: pieceUnit, unitPrice: e.fixedAmount! });
  }
  return items;
}

function insertItems(invoiceId: number, items: InvoiceItem[]) {
  const stmt = db.prepare(
    'INSERT INTO invoice_items (invoice_id, position, description, quantity, unit, unit_price) VALUES (?, ?, ?, ?, ?, ?)',
  );
  items.forEach((it, i) =>
    stmt.run(invoiceId, i, it.description.trim(), Number(it.quantity) || 0, it.unit ?? '', Number(it.unitPrice) || 0),
  );
}

export function createInvoice(input: InvoiceCreateInput): Invoice {
  const client = getClient(input.clientId);
  const settings = getSettings();
  const number = input.number?.trim() || nextInvoiceNumber(input.issueDate).number;
  assertNumberFree(number);
  const { year, seq } = resolveSeq(number, input.issueDate);

  const entries: Entry[] = input.entryIds.length
    ? db
        .prepare(`${ENTRY_SELECT} WHERE e.id IN (${input.entryIds.map(() => '?').join(',')}) ORDER BY e.date, e.id`)
        .all(...input.entryIds)
        .map(mapEntry)
    : [];
  for (const e of entries) {
    if (e.clientId !== client.id) throw new HttpError(400, 'Stavka rada pripada drugom klijentu.');
    if (e.invoiceId) throw new HttpError(409, `Stavka od ${formatDate(e.date)} je već fakturisana.`);
  }

  const items = buildItems(entries, input.grouping, client, settings, { from: input.periodFrom, to: input.periodTo });
  const vatRate = settings.vatPayer && !client.vatExempt ? settings.vatRate : 0;

  const id = transaction(() => {
    const res = db
      .prepare(
        `INSERT INTO invoices (number, year, seq, client_id, issue_date, service_date, due_date, place, currency,
           language, vat_rate, notes, status, period_from, period_to, include_report, client_json, seller_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
      )
      .run(
        number,
        year,
        seq,
        client.id,
        input.issueDate,
        input.serviceDate,
        input.dueDate,
        input.place ?? '',
        client.currency,
        client.language,
        vatRate,
        input.notes ?? '',
        input.periodFrom,
        input.periodTo,
        input.includeReport ? 1 : 0,
        JSON.stringify(client),
        JSON.stringify(settings),
      );
    const invoiceId = Number(res.lastInsertRowid);
    insertItems(invoiceId, items);
    // Zamrzni satnicu na stavkama rada da kasnija promena satnice klijenta ne menja istoriju.
    const link = db.prepare('UPDATE entries SET invoice_id = ?, rate = COALESCE(rate, ?) WHERE id = ?');
    for (const e of entries) link.run(invoiceId, e.effectiveRate ?? client.hourlyRate, e.id);
    return invoiceId;
  });
  return getInvoice(id);
}

export function updateInvoice(id: number, input: InvoiceUpdateInput): Invoice {
  const current = getInvoice(id);
  const number = input.number.trim();
  if (!number) throw new HttpError(400, 'Broj fakture je obavezan.');
  assertNumberFree(number, id);
  const { year, seq } =
    number === current.number && input.issueDate.slice(0, 4) === String(current.year)
      ? { year: current.year, seq: current.seq }
      : resolveSeq(number, input.issueDate, id);

  transaction(() => {
    db.prepare(
      `UPDATE invoices SET number = ?, year = ?, seq = ?, issue_date = ?, service_date = ?, due_date = ?, place = ?,
         notes = ?, status = ?, paid_date = ?, include_report = ?, vat_rate = ? WHERE id = ?`,
    ).run(
      number,
      year,
      seq,
      input.issueDate,
      input.serviceDate,
      input.dueDate,
      input.place ?? '',
      input.notes ?? '',
      input.status,
      input.status === 'paid' ? input.paidDate : null,
      input.includeReport ? 1 : 0,
      Number(input.vatRate) || 0,
      id,
    );
    db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(id);
    insertItems(id, input.items);
    // Stornirana faktura oslobađa stavke rada da mogu ponovo da se fakturišu.
    if (input.status === 'cancelled') db.prepare('UPDATE entries SET invoice_id = NULL WHERE invoice_id = ?').run(id);
  });
  return getInvoice(id);
}

export function deleteInvoice(id: number) {
  getInvoice(id);
  transaction(() => {
    db.prepare('UPDATE entries SET invoice_id = NULL WHERE invoice_id = ?').run(id);
    db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  });
}
