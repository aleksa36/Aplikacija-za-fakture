import { Router, type Request } from 'express';
import {
  ENTRY_SELECT,
  exportAll,
  getDb,
  getSettings,
  importAll,
  mapClient,
  mapEntry,
  mapMaintenance,
  round2,
  saveSettings,
  type Db,
  type Param,
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
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
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

async function getClientOr404(db: Db, clientId: number): Promise<Client> {
  const row = await db.one('SELECT * FROM clients WHERE id = ?', [clientId]);
  if (!row) throw new HttpError(404, 'Klijent ne postoji.');
  return mapClient(row);
}

function sumByCurrency(rows: { currency: Currency; amount: number }[]): MoneyByCurrency[] {
  const map = new Map<Currency, number>();
  for (const r of rows) map.set(r.currency, (map.get(r.currency) ?? 0) + r.amount);
  return [...map].map(([currency, amount]) => ({ currency, amount: round2(amount) })).filter((m) => m.amount !== 0);
}

// ---------- Podešavanja ----------

api.get('/settings', async (_req, res) => {
  res.json(await getSettings(await getDb()));
});

api.put('/settings', async (req, res) => {
  const body = req.body ?? {};
  if (typeof body.logo === 'string' && body.logo.length > 2_000_000) throw new HttpError(400, 'Logo je prevelik (max ~1.5 MB).');
  res.json(await saveSettings(await getDb(), body));
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

const CLIENT_FIELDS = `name, address, city, zip, country, pib, mb, email, phone, contact_person, hourly_rate,
  currency, payment_days, language, vat_exempt, invoice_note, notes, color, archived`;

function clientValues(c: ClientInput): Param[] {
  return [
    c.name, c.address, c.city, c.zip, c.country, c.pib, c.mb, c.email, c.phone, c.contactPerson, c.hourlyRate,
    c.currency, c.paymentDays, c.language, c.vatExempt, c.invoiceNote, c.notes, c.color, c.archived,
  ];
}

api.get('/clients', async (_req, res) => {
  const db = await getDb();
  res.json((await db.query('SELECT * FROM clients ORDER BY archived, lower(name)')).map(mapClient));
});

api.get('/clients/:id', async (req, res) => {
  res.json(await getClientOr404(await getDb(), id(req)));
});

api.post('/clients', async (req, res) => {
  const db = await getDb();
  const values = clientValues(clientInput(req.body ?? {}));
  const row = await db.one(
    `INSERT INTO clients (${CLIENT_FIELDS}) VALUES (${values.map(() => '?').join(', ')}) RETURNING *`,
    values,
  );
  res.status(201).json(mapClient(row!));
});

api.put('/clients/:id', async (req, res) => {
  const db = await getDb();
  const clientId = id(req);
  const values = clientValues(clientInput(req.body ?? {}));
  const sets = CLIENT_FIELDS.split(',').map((f) => `${f.trim()} = ?`).join(', ');
  const row = await db.one(`UPDATE clients SET ${sets} WHERE id = ? RETURNING *`, [...values, clientId]);
  if (!row) throw new HttpError(404, 'Klijent ne postoji.');
  res.json(mapClient(row));
});

api.delete('/clients/:id', async (req, res) => {
  const db = await getDb();
  const clientId = id(req);
  const inv = await db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM invoices WHERE client_id = ?', [clientId]);
  if (inv && inv.n > 0) throw new HttpError(409, 'Klijent ima fakture i ne može se obrisati. Arhivirajte ga umesto toga.');
  await db.query('DELETE FROM clients WHERE id = ?', [clientId]);
  res.status(204).end();
});

// ---------- Stavke rada (sati) ----------

async function entryInput(db: Db, b: Record<string, unknown>): Promise<EntryInput> {
  const clientId = num(b.clientId);
  await getClientOr404(db, clientId);
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

async function getEntryOr404(db: Db, entryId: number) {
  const row = await db.one(`${ENTRY_SELECT} WHERE e.id = ?`, [entryId]);
  if (!row) throw new HttpError(404, 'Stavka ne postoji.');
  return mapEntry(row);
}

api.get('/entries', async (req, res) => {
  const db = await getDb();
  await syncMaintenance(db);
  const where: string[] = [];
  const params: Param[] = [];
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
  if (q.unbilled === '1') where.push('e.invoice_id IS NULL AND e.billable');
  if (q.search) {
    where.push('e.description ILIKE ?');
    params.push(`%${str(q.search)}%`);
  }
  const rows = await db.query(
    `${ENTRY_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.date DESC, e.id DESC`,
    params,
  );
  res.json(rows.map(mapEntry));
});

api.post('/entries', async (req, res) => {
  const db = await getDb();
  const e = await entryInput(db, req.body ?? {});
  const row = await db.one<{ id: number }>(
    `INSERT INTO entries (client_id, date, description, hours, rate, fixed_amount, billable)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [e.clientId, e.date, e.description, e.hours, e.rate, e.fixedAmount, e.billable],
  );
  res.status(201).json(await getEntryOr404(db, row!.id));
});

api.put('/entries/:id', async (req, res) => {
  const db = await getDb();
  const entryId = id(req);
  const existing = await getEntryOr404(db, entryId);
  if (existing.invoiceId) throw new HttpError(409, `Stavka je na fakturi ${existing.invoiceNumber} i ne može se menjati.`);
  const e = await entryInput(db, req.body ?? {});
  await db.query(
    `UPDATE entries SET client_id = ?, date = ?, description = ?, hours = ?, rate = ?, fixed_amount = ?, billable = ?
     WHERE id = ?`,
    [e.clientId, e.date, e.description, e.hours, e.rate, e.fixedAmount, e.billable, entryId],
  );
  res.json(await getEntryOr404(db, entryId));
});

api.delete('/entries/:id', async (req, res) => {
  const db = await getDb();
  const entryId = id(req);
  const existing = await getEntryOr404(db, entryId);
  if (existing.invoiceId) throw new HttpError(409, `Stavka je na fakturi ${existing.invoiceNumber} i ne može se obrisati.`);
  await db.query('DELETE FROM entries WHERE id = ?', [entryId]);
  res.status(204).end();
});

// ---------- Obavezna održavanja ----------

async function maintenanceInput(db: Db, b: Record<string, unknown>): Promise<MaintenanceInput> {
  const clientId = num(b.clientId);
  await getClientOr404(db, clientId);
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

async function getMaintenanceOr404(db: Db, mid: number) {
  const row = await db.one(`${MAINTENANCE_SELECT} WHERE m.id = ?`, [mid]);
  if (!row) throw new HttpError(404, 'Održavanje ne postoji.');
  return mapMaintenance(row);
}

api.get('/maintenance', async (_req, res) => {
  const db = await getDb();
  res.json((await db.query(`${MAINTENANCE_SELECT} ORDER BY m.active DESC, lower(c.name)`)).map(mapMaintenance));
});

api.post('/maintenance', async (req, res) => {
  const db = await getDb();
  const m = await maintenanceInput(db, req.body ?? {});
  const row = await db.one<{ id: number }>(
    `INSERT INTO maintenance (client_id, description, hours, fixed_amount, interval_months, day_of_month,
       start_date, end_date, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [m.clientId, m.description, m.hours, m.fixedAmount, m.intervalMonths, m.dayOfMonth, m.startDate, m.endDate, m.active],
  );
  const created = await syncMaintenance(db);
  res.status(201).json({ ...(await getMaintenanceOr404(db, row!.id)), createdEntries: created });
});

api.put('/maintenance/:id', async (req, res) => {
  const db = await getDb();
  const mid = id(req);
  const existing = await getMaintenanceOr404(db, mid);
  const m = await maintenanceInput(db, req.body ?? {});
  await db.query(
    `UPDATE maintenance SET client_id = ?, description = ?, hours = ?, fixed_amount = ?, interval_months = ?,
       day_of_month = ?, start_date = ?, end_date = ?, active = ? WHERE id = ?`,
    [m.clientId, m.description, m.hours, m.fixedAmount, m.intervalMonths, m.dayOfMonth, m.startDate, m.endDate, m.active, mid],
  );
  if (!existing.active && m.active) await skipPausedPeriods(db, mid);
  const created = await syncMaintenance(db);
  res.json({ ...(await getMaintenanceOr404(db, mid)), createdEntries: created });
});

api.delete('/maintenance/:id', async (req, res) => {
  await (await getDb()).query('DELETE FROM maintenance WHERE id = ?', [id(req)]);
  res.status(204).end();
});

api.post('/maintenance/sync', async (_req, res) => {
  res.json({ createdEntries: await syncMaintenance(await getDb()) });
});

// ---------- Fakture ----------

api.get('/invoices', async (req, res) => {
  res.json(
    await listInvoices(await getDb(), {
      clientId: optNum(req.query.clientId) ?? undefined,
      status: str(req.query.status) || undefined,
      year: optNum(req.query.year) ?? undefined,
    }),
  );
});

/** Predlog podrazumevanih vrednosti za novu fakturu. */
api.get('/invoices/draft', async (req, res) => {
  const db = await getDb();
  await syncMaintenance(db);
  const issueDate = optDate(req.query.issueDate) ?? today();
  const settings = await getSettings(db);
  const clientId = optNum(req.query.clientId);
  const client = clientId ? await getClientOr404(db, clientId) : null;
  res.json({
    number: (await nextInvoiceNumber(db, issueDate, settings)).number,
    place: settings.defaultPlace || settings.city,
    dueDate: addDays(issueDate, client?.paymentDays ?? settings.defaultPaymentDays),
    notes: client ? defaultInvoiceNotes(client, settings) : '',
  });
});

api.get('/invoices/:id', async (req, res) => {
  const db = await getDb();
  const invoiceId = id(req);
  const [invoice, entries] = await Promise.all([getInvoice(db, invoiceId), getInvoiceEntries(db, invoiceId)]);
  res.json({ ...invoice, entries });
});

api.post('/invoices', async (req, res) => {
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
  res.status(201).json(await createInvoice(await getDb(), input));
});

const STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'cancelled'];

api.put('/invoices/:id', async (req, res) => {
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
  res.json(await updateInvoice(await getDb(), id(req), input));
});

/** Brza promena statusa (npr. "plaćeno") bez slanja cele fakture. */
api.patch('/invoices/:id/status', async (req, res) => {
  const db = await getDb();
  const invoiceId = id(req);
  const inv = await getInvoice(db, invoiceId);
  const status = req.body?.status as InvoiceStatus;
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Neispravan status.');
  res.json(
    await updateInvoice(db, invoiceId, {
      ...inv,
      status,
      paidDate: status === 'paid' ? (optDate(req.body?.paidDate) ?? inv.paidDate ?? today()) : null,
    }),
  );
});

api.delete('/invoices/:id', async (req, res) => {
  await deleteInvoice(await getDb(), id(req));
  res.status(204).end();
});

// ---------- Izveštaji ----------

api.get('/reports/entries.csv', async (req, res) => {
  const db = await getDb();
  const where: string[] = [];
  const params: Param[] = [];
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
  const entries = (
    await db.query(`${ENTRY_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.date, e.id`, params)
  ).map(mapEntry);
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

api.get('/dashboard', async (_req, res) => {
  const db = await getDb();
  await syncMaintenance(db);
  const period = currentPeriod();
  const thisMonth = monthRange(period);
  const lastMonth = monthRange(addMonths(period, -1));
  const t = today();
  const year = t.slice(0, 4);

  const [hours, unbilledRows, unpaid, paid, monthRows, recent] = await Promise.all([
    db.one<{ this_month: number; last_month: number }>(
      `SELECT COALESCE(SUM(hours) FILTER (WHERE date >= ? AND date <= ?), 0) AS this_month,
              COALESCE(SUM(hours) FILTER (WHERE date >= ? AND date <= ?), 0) AS last_month
       FROM entries`,
      [thisMonth.from, thisMonth.to, lastMonth.from, lastMonth.to],
    ),
    db.query(`${ENTRY_SELECT} WHERE e.invoice_id IS NULL AND e.billable AND e.date <= ?`, [t]),
    listInvoices(db, { status: 'sent' }),
    listInvoices(db, { status: 'paid' }),
    db.query(`${ENTRY_SELECT} WHERE e.date >= ? AND e.date <= ? ORDER BY c.name`, [thisMonth.from, thisMonth.to]),
    db.query(`${ENTRY_SELECT} ORDER BY e.date DESC, e.id DESC LIMIT 8`),
  ]);

  const unbilledEntries = unbilledRows.map(mapEntry);
  const overdue = unpaid.filter((i) => i.dueDate < t);
  const paidThisYear = paid.filter((i) => (i.paidDate ?? i.issueDate).startsWith(year));

  const perClient = new Map<number, Dashboard['perClient'][number]>();
  for (const e of monthRows.map(mapEntry)) {
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
    hoursThisMonth: round2(hours?.this_month ?? 0),
    hoursLastMonth: round2(hours?.last_month ?? 0),
    unbilled: sumByCurrency(unbilledEntries.map((e) => ({ currency: e.currency ?? 'RSD', amount: e.value ?? 0 }))),
    unbilledHours: round2(unbilledEntries.reduce((s, e) => s + e.hours, 0)),
    unpaid: sumByCurrency(unpaid.map((i) => ({ currency: i.currency, amount: i.total }))),
    unpaidCount: unpaid.length,
    overdueCount: overdue.length,
    paidThisYear: sumByCurrency(paidThisYear.map((i) => ({ currency: i.currency, amount: i.total }))),
    perClient: [...perClient.values()].sort((a, b) => b.hours - a.hours),
    recentEntries: recent.map(mapEntry),
    overdueInvoices: overdue,
  };
  res.json(result);
});

// ---------- Rezervna kopija ----------

api.get('/backup', async (_req, res) => {
  const backup = await exportAll(await getDb());
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="fakture-backup-${today()}.json"`);
  res.send(JSON.stringify(backup));
});

api.post('/restore', async (req, res) => {
  try {
    res.json({ restored: await importAll(await getDb(), req.body) });
  } catch (err) {
    throw err instanceof HttpError ? err : new HttpError(400, err instanceof Error ? err.message : String(err));
  }
});
