import { Router, type Request } from 'express';
import { rmSync } from 'node:fs';
import path from 'node:path';
import {
  DATA_DIR,
  db,
  ENTRY_SELECT,
  getSettings,
  mapClient,
  mapEntry,
  mapMaintenance,
  round2,
  saveSettings,
} from './db.ts';
import { skipPausedPeriods, syncMaintenance } from './recurring.ts';
import {
  createInvoice,
  defaultInvoiceNotes,
  deleteInvoice,
  getInvoice,
  getInvoiceEntries,
  HttpError,
  listInvoices,
  nextInvoiceNumber,
  updateInvoice,
} from './invoices.ts';
import { invoicePdf } from './pdf/invoice.ts';
import { reportPdf } from './pdf/report.ts';
import { addDays, addMonths, currentPeriod, formatDate, monthRange, today } from '../shared/format.ts';
import type {
  Client,
  ClientInput,
  Currency,
  Dashboard,
  EntryInput,
  InvoiceCreateInput,
  InvoiceStatus,
  InvoiceUpdateInput,
  MaintenanceInput,
  MoneyByCurrency,
} from '../shared/types.ts';

export const api = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function id(req: Request): number {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Neispravan ID.');
  return n;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function optNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = num(v, NaN);
  return Number.isFinite(n) ? n : null;
}

function date(v: unknown, field: string): string {
  const s = str(v);
  if (!ISO_DATE.test(s)) throw new HttpError(400, `Polje "${field}" mora biti datum (YYYY-MM-DD).`);
  return s;
}

function optDate(v: unknown): string | null {
  const s = str(v);
  return ISO_DATE.test(s) ? s : null;
}

function getClientOr404(clientId: number): Client {
  const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!row) throw new HttpError(404, 'Klijent ne postoji.');
  return mapClient(row);
}

function sumByCurrency(rows: { currency: Currency; amount: number }[]): MoneyByCurrency[] {
  const map = new Map<Currency, number>();
  for (const r of rows) map.set(r.currency, (map.get(r.currency) ?? 0) + r.amount);
  return [...map].map(([currency, amount]) => ({ currency, amount: round2(amount) })).filter((m) => m.amount !== 0);
}

// ---------- Podešavanja ----------

api.get('/settings', (_req, res) => {
  res.json(getSettings());
});

api.put('/settings', (req, res) => {
  const body = req.body ?? {};
  if (typeof body.logo === 'string' && body.logo.length > 2_000_000) throw new HttpError(400, 'Logo je prevelik (max ~1.5 MB).');
  res.json(saveSettings(body));
});

// ---------- Klijenti ----------

function clientInput(b: Record<string, unknown>): ClientInput {
  const name = str(b.name);
  if (!name) throw new HttpError(400, 'Naziv klijenta je obavezan.');
  return {
    name,
    address: str(b.address),
    city: str(b.city),
    zip: str(b.zip),
    country: str(b.country),
    pib: str(b.pib),
    mb: str(b.mb),
    email: str(b.email),
    phone: str(b.phone),
    contactPerson: str(b.contactPerson),
    hourlyRate: num(b.hourlyRate),
    currency: (str(b.currency) || 'RSD') as Currency,
    paymentDays: Math.max(0, Math.round(num(b.paymentDays, 15))),
    language: b.language === 'en' ? 'en' : 'sr',
    vatExempt: !!b.vatExempt,
    invoiceNote: str(b.invoiceNote),
    notes: str(b.notes),
    color: str(b.color) || 'blue',
    archived: !!b.archived,
  };
}

const CLIENT_COLUMNS = `name = ?, address = ?, city = ?, zip = ?, country = ?, pib = ?, mb = ?, email = ?, phone = ?,
  contact_person = ?, hourly_rate = ?, currency = ?, payment_days = ?, language = ?, vat_exempt = ?, invoice_note = ?,
  notes = ?, color = ?, archived = ?`;

function clientValues(c: ClientInput) {
  return [
    c.name, c.address, c.city, c.zip, c.country, c.pib, c.mb, c.email, c.phone, c.contactPerson, c.hourlyRate,
    c.currency, c.paymentDays, c.language, c.vatExempt ? 1 : 0, c.invoiceNote, c.notes, c.color, c.archived ? 1 : 0,
  ];
}

api.get('/clients', (_req, res) => {
  const rows = db.prepare('SELECT * FROM clients ORDER BY archived, name COLLATE NOCASE').all();
  res.json(rows.map(mapClient));
});

api.get('/clients/:id', (req, res) => {
  res.json(getClientOr404(id(req)));
});

api.post('/clients', (req, res) => {
  const c = clientInput(req.body ?? {});
  const result = db
    .prepare(
      `INSERT INTO clients (name, address, city, zip, country, pib, mb, email, phone, contact_person, hourly_rate,
         currency, payment_days, language, vat_exempt, invoice_note, notes, color, archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(...clientValues(c));
  res.status(201).json(getClientOr404(Number(result.lastInsertRowid)));
});

api.put('/clients/:id', (req, res) => {
  const clientId = id(req);
  getClientOr404(clientId);
  const c = clientInput(req.body ?? {});
  db.prepare(`UPDATE clients SET ${CLIENT_COLUMNS} WHERE id = ?`).run(...clientValues(c), clientId);
  res.json(getClientOr404(clientId));
});

api.delete('/clients/:id', (req, res) => {
  const clientId = id(req);
  const inv = db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE client_id = ?').get(clientId) as { n: number };
  if (inv.n > 0) throw new HttpError(409, 'Klijent ima fakture i ne može se obrisati. Arhivirajte ga umesto toga.');
  db.prepare('DELETE FROM clients WHERE id = ?').run(clientId);
  res.status(204).end();
});

// ---------- Stavke rada (sati) ----------

function entryInput(b: Record<string, unknown>): EntryInput {
  const clientId = num(b.clientId);
  getClientOr404(clientId);
  const hours = round2(num(b.hours));
  const fixedAmount = optNum(b.fixedAmount);
  if (hours < 0 || hours > 24) throw new HttpError(400, 'Broj sati mora biti između 0 i 24.');
  if (hours === 0 && fixedAmount === null) throw new HttpError(400, 'Unesite broj sati ili paušalni iznos.');
  return {
    clientId,
    date: date(b.date, 'datum'),
    description: str(b.description),
    hours,
    rate: optNum(b.rate),
    fixedAmount,
    billable: b.billable === undefined ? true : !!b.billable,
  };
}

function getEntryOr404(entryId: number) {
  const row = db.prepare(`${ENTRY_SELECT} WHERE e.id = ?`).get(entryId);
  if (!row) throw new HttpError(404, 'Stavka ne postoji.');
  return mapEntry(row);
}

api.get('/entries', (req, res) => {
  syncMaintenance();
  const where: string[] = [];
  const params: (string | number)[] = [];
  const q = req.query;
  if (q.clientId) {
    where.push('e.client_id = ?');
    params.push(num(q.clientId));
  }
  if (optDate(q.from)) {
    where.push('e.date >= ?');
    params.push(str(q.from));
  }
  if (optDate(q.to)) {
    where.push('e.date <= ?');
    params.push(str(q.to));
  }
  if (q.unbilled === '1') where.push('e.invoice_id IS NULL AND e.billable = 1');
  if (q.search) {
    where.push('e.description LIKE ?');
    params.push(`%${str(q.search)}%`);
  }
  const rows = db
    .prepare(`${ENTRY_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.date DESC, e.id DESC`)
    .all(...params);
  res.json(rows.map(mapEntry));
});

api.post('/entries', (req, res) => {
  const e = entryInput(req.body ?? {});
  const result = db
    .prepare(
      `INSERT INTO entries (client_id, date, description, hours, rate, fixed_amount, billable)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(e.clientId, e.date, e.description, e.hours, e.rate, e.fixedAmount, e.billable ? 1 : 0);
  res.status(201).json(getEntryOr404(Number(result.lastInsertRowid)));
});

api.put('/entries/:id', (req, res) => {
  const entryId = id(req);
  const existing = getEntryOr404(entryId);
  if (existing.invoiceId) throw new HttpError(409, `Stavka je na fakturi ${existing.invoiceNumber} i ne može se menjati.`);
  const e = entryInput(req.body ?? {});
  db.prepare(
    `UPDATE entries SET client_id = ?, date = ?, description = ?, hours = ?, rate = ?, fixed_amount = ?, billable = ?
     WHERE id = ?`,
  ).run(e.clientId, e.date, e.description, e.hours, e.rate, e.fixedAmount, e.billable ? 1 : 0, entryId);
  res.json(getEntryOr404(entryId));
});

api.delete('/entries/:id', (req, res) => {
  const entryId = id(req);
  const existing = getEntryOr404(entryId);
  if (existing.invoiceId) throw new HttpError(409, `Stavka je na fakturi ${existing.invoiceNumber} i ne može se obrisati.`);
  db.prepare('DELETE FROM entries WHERE id = ?').run(entryId);
  res.status(204).end();
});

// ---------- Obavezna održavanja ----------

function maintenanceInput(b: Record<string, unknown>): MaintenanceInput {
  const clientId = num(b.clientId);
  getClientOr404(clientId);
  const description = str(b.description);
  if (!description) throw new HttpError(400, 'Opis održavanja je obavezan.');
  const hours = round2(num(b.hours));
  const fixedAmount = optNum(b.fixedAmount);
  if (hours <= 0 && fixedAmount === null) throw new HttpError(400, 'Unesite broj sati ili paušalni iznos.');
  const intervalMonths = Math.round(num(b.intervalMonths, 1));
  if (![1, 2, 3, 6, 12].includes(intervalMonths)) throw new HttpError(400, 'Neispravan interval.');
  return {
    clientId,
    description,
    hours,
    fixedAmount,
    intervalMonths,
    dayOfMonth: Math.min(31, Math.max(1, Math.round(num(b.dayOfMonth, 1)))),
    startDate: date(b.startDate, 'početak'),
    endDate: optDate(b.endDate),
    active: b.active === undefined ? true : !!b.active,
  };
}

const MAINTENANCE_SELECT = `
  SELECT m.*, c.name AS client_name,
         (SELECT MAX(period) FROM maintenance_runs r WHERE r.maintenance_id = m.id AND r.entry_id IS NOT NULL) AS last_period
  FROM maintenance m JOIN clients c ON c.id = m.client_id`;

function getMaintenanceOr404(mid: number) {
  const row = db.prepare(`${MAINTENANCE_SELECT} WHERE m.id = ?`).get(mid);
  if (!row) throw new HttpError(404, 'Održavanje ne postoji.');
  return mapMaintenance(row);
}

api.get('/maintenance', (_req, res) => {
  res.json(db.prepare(`${MAINTENANCE_SELECT} ORDER BY m.active DESC, c.name COLLATE NOCASE`).all().map(mapMaintenance));
});

api.post('/maintenance', (req, res) => {
  const m = maintenanceInput(req.body ?? {});
  const result = db
    .prepare(
      `INSERT INTO maintenance (client_id, description, hours, fixed_amount, interval_months, day_of_month,
         start_date, end_date, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(m.clientId, m.description, m.hours, m.fixedAmount, m.intervalMonths, m.dayOfMonth, m.startDate, m.endDate, m.active ? 1 : 0);
  const created = syncMaintenance();
  res.status(201).json({ ...getMaintenanceOr404(Number(result.lastInsertRowid)), createdEntries: created });
});

api.put('/maintenance/:id', (req, res) => {
  const mid = id(req);
  const existing = getMaintenanceOr404(mid);
  const m = maintenanceInput(req.body ?? {});
  db.prepare(
    `UPDATE maintenance SET client_id = ?, description = ?, hours = ?, fixed_amount = ?, interval_months = ?,
       day_of_month = ?, start_date = ?, end_date = ?, active = ? WHERE id = ?`,
  ).run(m.clientId, m.description, m.hours, m.fixedAmount, m.intervalMonths, m.dayOfMonth, m.startDate, m.endDate, m.active ? 1 : 0, mid);
  if (!existing.active && m.active) skipPausedPeriods(mid);
  const created = syncMaintenance();
  res.json({ ...getMaintenanceOr404(mid), createdEntries: created });
});

api.delete('/maintenance/:id', (req, res) => {
  db.prepare('DELETE FROM maintenance WHERE id = ?').run(id(req));
  res.status(204).end();
});

api.post('/maintenance/sync', (_req, res) => {
  res.json({ createdEntries: syncMaintenance() });
});

// ---------- Fakture ----------

api.get('/invoices', (req, res) => {
  res.json(
    listInvoices({
      clientId: optNum(req.query.clientId) ?? undefined,
      status: str(req.query.status) || undefined,
      year: optNum(req.query.year) ?? undefined,
    }),
  );
});

/** Predlog podrazumevanih vrednosti za novu fakturu. */
api.get('/invoices/draft', (req, res) => {
  syncMaintenance();
  const issueDate = optDate(req.query.issueDate) ?? today();
  const settings = getSettings();
  const clientId = optNum(req.query.clientId);
  const client = clientId ? getClientOr404(clientId) : null;
  res.json({
    number: nextInvoiceNumber(issueDate).number,
    place: settings.defaultPlace || settings.city,
    dueDate: addDays(issueDate, client?.paymentDays ?? settings.defaultPaymentDays),
    notes: client ? defaultInvoiceNotes(client, settings) : '',
  });
});

api.get('/invoices/:id', (req, res) => {
  const invoiceId = id(req);
  res.json({ ...getInvoice(invoiceId), entries: getInvoiceEntries(invoiceId) });
});

api.post('/invoices', (req, res) => {
  const b = req.body ?? {};
  const input: InvoiceCreateInput = {
    clientId: num(b.clientId),
    number: str(b.number),
    issueDate: date(b.issueDate, 'datum izdavanja'),
    serviceDate: date(b.serviceDate, 'datum prometa'),
    dueDate: date(b.dueDate, 'rok plaćanja'),
    place: str(b.place),
    periodFrom: optDate(b.periodFrom),
    periodTo: optDate(b.periodTo),
    entryIds: Array.isArray(b.entryIds) ? b.entryIds.map(Number).filter(Number.isInteger) : [],
    grouping: b.grouping === 'detailed' ? 'detailed' : 'grouped',
    includeReport: b.includeReport === undefined ? true : !!b.includeReport,
    notes: typeof b.notes === 'string' ? b.notes : '',
  };
  res.status(201).json(createInvoice(input));
});

const STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'cancelled'];

api.put('/invoices/:id', (req, res) => {
  const b = req.body ?? {};
  const status = STATUSES.includes(b.status) ? (b.status as InvoiceStatus) : 'draft';
  const input: InvoiceUpdateInput = {
    number: str(b.number),
    issueDate: date(b.issueDate, 'datum izdavanja'),
    serviceDate: date(b.serviceDate, 'datum prometa'),
    dueDate: date(b.dueDate, 'rok plaćanja'),
    place: str(b.place),
    notes: typeof b.notes === 'string' ? b.notes : '',
    status,
    paidDate: status === 'paid' ? (optDate(b.paidDate) ?? today()) : null,
    includeReport: !!b.includeReport,
    vatRate: num(b.vatRate),
    items: (Array.isArray(b.items) ? b.items : [])
      .map((it: Record<string, unknown>) => ({
        description: str(it.description),
        quantity: num(it.quantity),
        unit: str(it.unit),
        unitPrice: num(it.unitPrice),
      }))
      .filter((it: { description: string }) => it.description),
  };
  res.json(updateInvoice(id(req), input));
});

/** Brza promena statusa (npr. "plaćeno") bez slanja cele fakture. */
api.patch('/invoices/:id/status', (req, res) => {
  const invoiceId = id(req);
  const inv = getInvoice(invoiceId);
  const status = req.body?.status as InvoiceStatus;
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Neispravan status.');
  const updated = updateInvoice(invoiceId, {
    ...inv,
    status,
    paidDate: status === 'paid' ? (optDate(req.body?.paidDate) ?? inv.paidDate ?? today()) : null,
  });
  res.json(updated);
});

api.delete('/invoices/:id', (req, res) => {
  deleteInvoice(id(req));
  res.status(204).end();
});

function safeFileName(s: string): string {
  return s.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function sendPdf(res: import('express').Response, pdf: Buffer, fileName: string, download: boolean) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="${fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  res.send(pdf);
}

api.get('/invoices/:id/pdf', async (req, res) => {
  const invoiceId = id(req);
  const invoice = getInvoice(invoiceId);
  const pdf = await invoicePdf(invoice, getInvoiceEntries(invoiceId));
  const prefix = invoice.language === 'en' ? 'Invoice' : 'Faktura';
  sendPdf(res, pdf, `${prefix}_${safeFileName(invoice.number)}_${safeFileName(invoice.client.name)}.pdf`, req.query.download === '1');
});

// ---------- Izveštaji ----------

api.get('/reports/pdf', async (req, res) => {
  syncMaintenance();
  const client = getClientOr404(num(req.query.clientId));
  const from = date(req.query.from, 'od');
  const to = date(req.query.to, 'do');
  const where = ['e.client_id = ?', 'e.date >= ?', 'e.date <= ?'];
  if (req.query.billableOnly === '1') where.push('e.billable = 1');
  if (req.query.unbilledOnly === '1') where.push('e.invoice_id IS NULL');
  const entries = db
    .prepare(`${ENTRY_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.date, e.id`)
    .all(client.id, from, to)
    .map(mapEntry);
  const pdf = await reportPdf({ settings: getSettings(), client, entries, from, to, showAmounts: req.query.amounts === '1' });
  const prefix = client.language === 'en' ? 'Work_report' : 'Izvestaj';
  sendPdf(res, pdf, `${prefix}_${safeFileName(client.name)}_${from}_${to}.pdf`, req.query.download === '1');
});

api.get('/reports/entries.csv', (req, res) => {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (req.query.clientId) {
    where.push('e.client_id = ?');
    params.push(num(req.query.clientId));
  }
  if (optDate(req.query.from)) {
    where.push('e.date >= ?');
    params.push(str(req.query.from));
  }
  if (optDate(req.query.to)) {
    where.push('e.date <= ?');
    params.push(str(req.query.to));
  }
  const entries = db
    .prepare(`${ENTRY_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.date, e.id`)
    .all(...params)
    .map(mapEntry);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Datum', 'Klijent', 'Opis', 'Sati', 'Satnica', 'Paušal', 'Iznos', 'Valuta', 'Naplativo', 'Faktura', 'Održavanje'];
  const lines = entries.map((e) =>
    [
      formatDate(e.date),
      e.clientName,
      e.description,
      String(e.hours).replace('.', ','),
      e.fixedAmount === null ? String(e.effectiveRate).replace('.', ',') : '',
      e.fixedAmount === null ? '' : String(e.fixedAmount).replace('.', ','),
      String(e.value).replace('.', ','),
      e.currency,
      e.billable ? 'da' : 'ne',
      e.invoiceNumber ?? '',
      e.maintenanceId ? 'da' : '',
    ]
      .map(esc)
      .join(';'),
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sati.csv"');
  // BOM da bi Excel ispravno prikazao č, ć, š, ž, đ
  res.send('﻿' + [header.map(esc).join(';'), ...lines].join('\r\n'));
});

// ---------- Kontrolna tabla ----------

api.get('/dashboard', (_req, res) => {
  syncMaintenance();
  const period = currentPeriod();
  const thisMonth = monthRange(period);
  const lastMonth = monthRange(addMonths(period, -1));
  const t = today();

  const hoursIn = (from: string, to: string) =>
    (db.prepare('SELECT COALESCE(SUM(hours), 0) AS h FROM entries WHERE date >= ? AND date <= ?').get(from, to) as { h: number }).h;

  const unbilledEntries = db
    .prepare(`${ENTRY_SELECT} WHERE e.invoice_id IS NULL AND e.billable = 1 AND e.date <= ?`)
    .all(t)
    .map(mapEntry);

  const unpaid = listInvoices({ status: 'sent' });
  const overdue = unpaid.filter((i) => i.dueDate < t);
  const year = Number(t.slice(0, 4));
  const paidThisYear = listInvoices({ status: 'paid' }).filter((i) => (i.paidDate ?? i.issueDate).startsWith(String(year)));

  const perClientRows = db
    .prepare(`${ENTRY_SELECT} WHERE e.date >= ? AND e.date <= ? ORDER BY c.name`)
    .all(thisMonth.from, thisMonth.to)
    .map(mapEntry);
  const perClient = new Map<number, Dashboard['perClient'][number]>();
  for (const e of perClientRows) {
    const p = perClient.get(e.clientId) ?? {
      clientId: e.clientId,
      name: e.clientName ?? '',
      color: e.clientColor ?? 'blue',
      hours: 0,
      value: 0,
      currency: e.currency ?? 'RSD',
    };
    p.hours = round2(p.hours + e.hours);
    p.value = round2(p.value + (e.billable ? (e.value ?? 0) : 0));
    perClient.set(e.clientId, p);
  }

  const result: Dashboard = {
    month: period,
    hoursThisMonth: round2(hoursIn(thisMonth.from, thisMonth.to)),
    hoursLastMonth: round2(hoursIn(lastMonth.from, lastMonth.to)),
    unbilled: sumByCurrency(unbilledEntries.map((e) => ({ currency: e.currency ?? 'RSD', amount: e.value ?? 0 }))),
    unbilledHours: round2(unbilledEntries.reduce((s, e) => s + e.hours, 0)),
    unpaid: sumByCurrency(unpaid.map((i) => ({ currency: i.currency, amount: i.total }))),
    unpaidCount: unpaid.length,
    overdueCount: overdue.length,
    paidThisYear: sumByCurrency(paidThisYear.map((i) => ({ currency: i.currency, amount: i.total }))),
    perClient: [...perClient.values()].sort((a, b) => b.hours - a.hours),
    recentEntries: db.prepare(`${ENTRY_SELECT} ORDER BY e.date DESC, e.id DESC LIMIT 8`).all().map(mapEntry),
    overdueInvoices: overdue,
  };
  res.json(result);
});

// ---------- Rezervna kopija ----------

api.get('/backup', (_req, res) => {
  const file = path.join(DATA_DIR, `backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  res.download(file, `fakture-backup-${today()}.db`, () => rmSync(file, { force: true }));
});
