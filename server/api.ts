import { Router, type Request } from 'express';
import {
  ENTRY_SELECT,
  ENTRY_VALUE_SQL,
  exportAll,
  getDb,
  getSettings,
  importAll,
  mapClient,
  mapEntry,
  mapTodo,
  round2,
  saveSettings,
  type Db,
  type Param,
} from './db.ts';
import { syncMaintenance } from './recurring.ts';
import {
  createInvoice,
  defaultInvoiceNotes,
  deleteInvoices,
  getInvoice,
  getInvoiceEntries,
  HttpError,
  listInvoices,
  nextInvoiceNumber,
  updateInvoice,
} from './invoices.ts';
import { addDays, addMonths, currentPeriod, formatDate, formatMonth, maintenanceTitle, monthRange, today } from '../shared/format.ts';
import type {
  Client,
  ClientInput,
  Currency,
  Dashboard,
  EntryInput,
  InvoiceCreateInput,
  InvoiceStatus,
  InvoiceUpdateInput,
  MoneyByCurrency,
  Stats,
} from '../shared/types.ts';

export const api = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;
const MAX_HOURS = 100_000;

function id(req: Request): number {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Neispravan ID.');
  return n;
}

function ids(v: unknown): number[] {
  if (!Array.isArray(v)) throw new HttpError(400, 'Nedostaje lista ID-jeva.');
  return [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
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

function optMonth(v: unknown): string | null {
  const s = str(v).slice(0, 7);
  return ISO_MONTH.test(s) ? s : null;
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

function placeholders(list: unknown[]): string {
  return list.map(() => '?').join(', ');
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
  const maintenanceAmount = Math.max(0, num(b.maintenanceAmount));
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
    maintenanceAmount,
    maintenanceLabel: str(b.maintenanceLabel) || 'Mesečno održavanje',
    // Ako održavanje postoji a početak nije zadat, kreće od tekućeg meseca.
    maintenanceStart: maintenanceAmount > 0 ? (optMonth(b.maintenanceStart) ?? currentPeriod()) : null,
  };
}

const CLIENT_FIELDS = `name, address, city, zip, country, pib, mb, email, phone, contact_person, hourly_rate,
  currency, payment_days, language, vat_exempt, invoice_note, notes, color, archived,
  maintenance_amount, maintenance_label, maintenance_start`;

function clientValues(c: ClientInput): Param[] {
  return [
    c.name, c.address, c.city, c.zip, c.country, c.pib, c.mb, c.email, c.phone, c.contactPerson, c.hourlyRate,
    c.currency, c.paymentDays, c.language, c.vatExempt, c.invoiceNote, c.notes, c.color, c.archived,
    c.maintenanceAmount, c.maintenanceLabel, c.maintenanceStart,
  ];
}

const CLIENT_SELECT = `
  SELECT c.*, (SELECT COUNT(*)::int FROM todos t WHERE t.client_id = c.id AND NOT t.done) AS open_todos
  FROM clients c`;

api.get('/clients', async (_req, res) => {
  const db = await getDb();
  res.json((await db.query(`${CLIENT_SELECT} ORDER BY c.archived, lower(c.name)`)).map(mapClient));
});

api.get('/clients/:id', async (req, res) => {
  const row = await (await getDb()).one(`${CLIENT_SELECT} WHERE c.id = ?`, [id(req)]);
  if (!row) throw new HttpError(404, 'Klijent ne postoji.');
  res.json(mapClient(row));
});

api.post('/clients', async (req, res) => {
  const db = await getDb();
  const values = clientValues(clientInput(req.body ?? {}));
  const row = await db.one(`INSERT INTO clients (${CLIENT_FIELDS}) VALUES (${placeholders(values)}) RETURNING *`, values);
  await syncMaintenance(db);
  res.status(201).json(mapClient(row!));
});

api.put('/clients/:id', async (req, res) => {
  const db = await getDb();
  const clientId = id(req);
  const values = clientValues(clientInput(req.body ?? {}));
  const sets = CLIENT_FIELDS.split(',').map((f) => `${f.trim()} = ?`).join(', ');
  const row = await db.one(`UPDATE clients SET ${sets} WHERE id = ? RETURNING *`, [...values, clientId]);
  if (!row) throw new HttpError(404, 'Klijent ne postoji.');
  await syncMaintenance(db);
  res.json(mapClient(row));
});

api.delete('/clients/:id', async (req, res) => {
  const db = await getDb();
  const clientId = id(req);
  const inv = await db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM invoices WHERE client_id = ?', [clientId]);
  if (inv && inv.n > 0) throw new HttpError(409, 'Klijent ima fakture i ne može se obrisati. Obrišite prvo fakture ili ga arhivirajte.');
  await db.query('DELETE FROM clients WHERE id = ?', [clientId]);
  res.status(204).end();
});

// ---------- Unosi (sati, paušal, mesečno održavanje) ----------

async function entryInput(db: Db, b: Record<string, unknown>): Promise<EntryInput & { client: Client }> {
  const client = await getClientOr404(db, num(b.clientId));
  const project = str(b.project).slice(0, 100);

  if (b.kind === 'maintenance') {
    const period = optMonth(b.period);
    if (!period) throw new HttpError(400, 'Izaberite mesec održavanja.');
    const fixedAmount = optNum(b.fixedAmount) ?? (client.maintenanceAmount || null);
    if (fixedAmount === null || fixedAmount <= 0) throw new HttpError(400, 'Unesite iznos održavanja.');
    return {
      client,
      kind: 'maintenance',
      clientId: client.id,
      period,
      date: `${period}-01`,
      dateTo: null,
      project,
      description: str(b.description) || maintenanceTitle(client.maintenanceLabel, period, client.language),
      hours: Math.max(0, round2(num(b.hours))),
      rate: null,
      fixedAmount,
    };
  }

  const from = date(b.date, 'od');
  const to = optDate(b.dateTo);
  if (to && to < from) throw new HttpError(400, 'Datum "do" ne može biti pre datuma "od".');
  const hours = round2(num(b.hours));
  const fixedAmount = optNum(b.fixedAmount);
  if (hours < 0 || hours > MAX_HOURS) throw new HttpError(400, 'Neispravan broj sati.');
  if (hours === 0 && fixedAmount === null) throw new HttpError(400, 'Unesite broj sati ili paušalni iznos.');
  if (fixedAmount !== null && fixedAmount < 0) throw new HttpError(400, 'Iznos ne može biti negativan.');
  return {
    client,
    kind: 'manual',
    clientId: client.id,
    period: null,
    date: from,
    dateTo: to && to !== from ? to : null,
    project,
    description: str(b.description),
    hours,
    rate: fixedAmount === null ? optNum(b.rate) : null,
    fixedAmount,
  };
}

async function getEntryOr404(db: Db, entryId: number) {
  const row = await db.one(`${ENTRY_SELECT} WHERE e.id = ?`, [entryId]);
  if (!row) throw new HttpError(404, 'Unos ne postoji.');
  return mapEntry(row);
}

async function assertMaintenanceFree(db: Db, clientId: number, period: string, excludeId = 0) {
  const row = await db.one(
    `SELECT id FROM entries WHERE kind = 'maintenance' AND client_id = ? AND period = ? AND id <> ?`,
    [clientId, period, excludeId],
  );
  if (row) throw new HttpError(409, `Održavanje za ${formatMonth(period)} je već upisano za ovog klijenta.`);
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
  if (q.project !== undefined && q.project !== '') {
    where.push('e.project = ?');
    params.push(str(q.project));
  }
  if (q.search) {
    where.push('(e.description ILIKE ? OR e.project ILIKE ?)');
    params.push(`%${str(q.search)}%`, `%${str(q.search)}%`);
  }
  const rows = await db.query(
    `${ENTRY_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.date DESC, e.id DESC`,
    params,
  );
  res.json(rows.map(mapEntry));
});

/** Nazivi projekata (za predloge pri unosu). */
api.get('/projects', async (req, res) => {
  const db = await getDb();
  const clientId = optNum(req.query.clientId);
  const rows = await db.query<{ project: string }>(
    `SELECT project FROM entries WHERE project <> '' ${clientId ? 'AND client_id = ?' : ''}
     GROUP BY project ORDER BY MAX(date) DESC LIMIT 100`,
    clientId ? [clientId] : [],
  );
  res.json(rows.map((r) => r.project));
});

api.post('/entries', async (req, res) => {
  const db = await getDb();
  const e = await entryInput(db, req.body ?? {});
  const entryId = await db.tx(async (tx) => {
    if (e.kind === 'maintenance') {
      await assertMaintenanceFree(tx, e.clientId, e.period!);
      // Zabeleži mesec da ga automatski upis ne bi dodao još jednom.
      await tx.query('INSERT INTO maintenance_log (client_id, period) VALUES (?, ?) ON CONFLICT DO NOTHING', [e.clientId, e.period]);
    }
    const row = await tx.one<{ id: number }>(
      `INSERT INTO entries (client_id, kind, period, date, date_to, project, description, hours, rate, fixed_amount, billable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true) RETURNING id`,
      [e.clientId, e.kind, e.period, e.date, e.dateTo, e.project, e.description, e.hours, e.rate, e.fixedAmount],
    );
    return row!.id;
  });
  res.status(201).json(await getEntryOr404(db, entryId));
});

api.put('/entries/:id', async (req, res) => {
  const db = await getDb();
  const entryId = id(req);
  const existing = await getEntryOr404(db, entryId);
  if (existing.invoiceId) {
    throw new HttpError(409, `Unos je na fakturi ${existing.invoiceNumber} i ne može se menjati. Možete ga obrisati.`);
  }
  const e = await entryInput(db, req.body ?? {});
  await db.tx(async (tx) => {
    if (e.kind === 'maintenance') {
      await assertMaintenanceFree(tx, e.clientId, e.period!, entryId);
      await tx.query('INSERT INTO maintenance_log (client_id, period) VALUES (?, ?) ON CONFLICT DO NOTHING', [e.clientId, e.period]);
    }
    await tx.query(
      `UPDATE entries SET client_id = ?, kind = ?, period = ?, date = ?, date_to = ?, project = ?, description = ?,
         hours = ?, rate = ?, fixed_amount = ? WHERE id = ?`,
      [e.clientId, e.kind, e.period, e.date, e.dateTo, e.project, e.description, e.hours, e.rate, e.fixedAmount, entryId],
    );
  });
  res.json(await getEntryOr404(db, entryId));
});

// Brisanje je dozvoljeno i za fakturisane unose (faktura zadržava svoje stavke).
api.delete('/entries/:id', async (req, res) => {
  await (await getDb()).query('DELETE FROM entries WHERE id = ?', [id(req)]);
  res.status(204).end();
});

api.post('/entries/bulk-delete', async (req, res) => {
  const list = ids(req.body?.ids);
  if (list.length) await (await getDb()).query(`DELETE FROM entries WHERE id IN (${placeholders(list)})`, list);
  res.json({ deleted: list.length });
});

// ---------- Zadaci (todo lista po klijentu) ----------

const TODO_SELECT = `
  SELECT t.*, c.name AS client_name, c.color AS client_color
  FROM todos t JOIN clients c ON c.id = t.client_id`;

api.get('/todos', async (req, res) => {
  const db = await getDb();
  const where: string[] = [];
  const params: Param[] = [];
  if (req.query.clientId) {
    where.push('t.client_id = ?');
    params.push(num(req.query.clientId));
  }
  if (req.query.open === '1') where.push('NOT t.done');
  const rows = await db.query(
    `${TODO_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.done, CASE WHEN t.done THEN t.done_at END DESC, t.created_at`,
    params,
  );
  res.json(rows.map(mapTodo));
});

api.post('/todos', async (req, res) => {
  const db = await getDb();
  const client = await getClientOr404(db, num(req.body?.clientId));
  const text = str(req.body?.text).slice(0, 1000);
  if (!text) throw new HttpError(400, 'Unesite tekst zadatka.');
  const row = await db.one<{ id: number }>('INSERT INTO todos (client_id, text) VALUES (?, ?) RETURNING id', [client.id, text]);
  res.status(201).json(mapTodo((await db.one(`${TODO_SELECT} WHERE t.id = ?`, [row!.id]))!));
});

api.patch('/todos/:id', async (req, res) => {
  const db = await getDb();
  const todoId = id(req);
  const b = req.body ?? {};
  if (typeof b.text === 'string') {
    const text = str(b.text).slice(0, 1000);
    if (!text) throw new HttpError(400, 'Unesite tekst zadatka.');
    await db.query('UPDATE todos SET text = ? WHERE id = ?', [text, todoId]);
  }
  if (typeof b.done === 'boolean') {
    await db.query(`UPDATE todos SET done = ?, done_at = CASE WHEN ? THEN now() ELSE NULL END WHERE id = ?`, [b.done, b.done, todoId]);
  }
  const row = await db.one(`${TODO_SELECT} WHERE t.id = ?`, [todoId]);
  if (!row) throw new HttpError(404, 'Zadatak ne postoji.');
  res.json(mapTodo(row));
});

api.delete('/todos/:id', async (req, res) => {
  await (await getDb()).query('DELETE FROM todos WHERE id = ?', [id(req)]);
  res.status(204).end();
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

/** ?entries=delete briše i unose sa fakture; inače se unosi vraćaju u nefakturisane. */
api.delete('/invoices/:id', async (req, res) => {
  await deleteInvoices(await getDb(), [id(req)], req.query.entries === 'delete');
  res.status(204).end();
});

api.post('/invoices/bulk-delete', async (req, res) => {
  const list = ids(req.body?.ids);
  await deleteInvoices(await getDb(), list, req.body?.entries === 'delete');
  res.json({ deleted: list.length });
});

// ---------- Statistika ----------

api.get('/stats', async (req, res) => {
  const db = await getDb();
  await syncMaintenance(db);
  const year = today().slice(0, 4);
  const from = optDate(req.query.from) ?? `${year}-01-01`;
  const to = optDate(req.query.to) ?? `${year}-12-31`;
  const clientId = optNum(req.query.clientId);
  const where = `e.date >= ? AND e.date <= ?${clientId ? ' AND e.client_id = ?' : ''}`;
  const params: Param[] = clientId ? [from, to, clientId] : [from, to];

  const [months, clients, projects, invoiced] = await Promise.all([
    db.query<{ month: string; client_id: number; hours: number }>(
      `SELECT substr(e.date, 1, 7) AS month, e.client_id, SUM(e.hours) AS hours
       FROM entries e WHERE ${where} GROUP BY 1, 2 ORDER BY 1`,
      params,
    ),
    db.query<{ client_id: number; name: string; color: string; currency: Currency; hours: number; value: number; entries: number }>(
      `SELECT c.id AS client_id, c.name, c.color, c.currency, SUM(e.hours) AS hours,
              SUM(${ENTRY_VALUE_SQL}) AS value, COUNT(*)::int AS entries
       FROM entries e JOIN clients c ON c.id = e.client_id WHERE ${where}
       GROUP BY c.id ORDER BY hours DESC, value DESC`,
      params,
    ),
    db.query<{
      client_id: number; name: string; color: string; currency: Currency; project: string;
      hours: number; value: number; entries: number; first_date: string; last_date: string;
    }>(
      `SELECT c.id AS client_id, c.name, c.color, c.currency,
              CASE WHEN e.kind = 'maintenance' AND e.project = '' THEN '__maintenance' ELSE e.project END AS project,
              SUM(e.hours) AS hours, SUM(${ENTRY_VALUE_SQL}) AS value, COUNT(*)::int AS entries,
              MIN(e.date) AS first_date, MAX(COALESCE(e.date_to, e.date)) AS last_date
       FROM entries e JOIN clients c ON c.id = e.client_id WHERE ${where}
       GROUP BY c.id, 5 ORDER BY hours DESC, value DESC`,
      params,
    ),
    db.query<{ currency: Currency; amount: number }>(
      `SELECT i.currency, SUM(ii.quantity * ii.unit_price * (1 + i.vat_rate / 100)) AS amount
       FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
       WHERE i.status <> 'cancelled' AND i.issue_date >= ? AND i.issue_date <= ?${clientId ? ' AND i.client_id = ?' : ''}
       GROUP BY i.currency`,
      params,
    ),
  ]);

  // Svi meseci u periodu (i oni bez rada), najviše poslednjih 36.
  const byMonth: Stats['byMonth'] = [];
  const lastMonth = to.slice(0, 7);
  const firstMonth = [from.slice(0, 7), addMonths(lastMonth, -35)].sort()[1];
  for (let m = firstMonth; m <= lastMonth; m = addMonths(m, 1)) {
    const rows = months.filter((r) => r.month === m);
    byMonth.push({
      month: m,
      hours: round2(rows.reduce((s, r) => s + r.hours, 0)),
      byClient: rows.map((r) => ({ clientId: r.client_id, hours: round2(r.hours) })),
    });
  }

  const stats: Stats = {
    from,
    to,
    totalHours: round2(clients.reduce((s, c) => s + c.hours, 0)),
    totalEntries: clients.reduce((s, c) => s + c.entries, 0),
    value: sumByCurrency(clients.map((c) => ({ currency: c.currency, amount: c.value }))),
    invoiced: sumByCurrency(invoiced),
    byMonth,
    byClient: clients.map((c) => ({
      clientId: c.client_id, name: c.name, color: c.color, currency: c.currency,
      hours: round2(c.hours), value: round2(c.value), entries: c.entries,
    })),
    byProject: projects.map((p) => ({
      clientId: p.client_id, clientName: p.name, color: p.color, currency: p.currency, project: p.project,
      hours: round2(p.hours), value: round2(p.value), entries: p.entries, firstDate: p.first_date, lastDate: p.last_date,
    })),
  };
  res.json(stats);
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
  const header = ['Od', 'Do', 'Klijent', 'Projekat', 'Opis', 'Vrsta', 'Sati', 'Satnica', 'Paušal', 'Iznos', 'Valuta', 'Faktura'];
  const lines = entries.map((e) =>
    [
      formatDate(e.date),
      formatDate(e.dateTo),
      e.clientName,
      e.project,
      e.description,
      e.kind === 'maintenance' ? 'održavanje' : e.fixedAmount === null ? 'sati' : 'paušal',
      String(e.hours).replace('.', ','),
      e.fixedAmount === null ? String(e.effectiveRate).replace('.', ',') : '',
      e.fixedAmount === null ? '' : String(e.fixedAmount).replace('.', ','),
      String(e.value).replace('.', ','),
      e.currency,
      e.invoiceNumber ?? '',
    ]
      .map(esc)
      .join(';'),
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="unosi.csv"');
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

  const [hours, unbilledRows, unpaid, paid, monthRows, recent, todos] = await Promise.all([
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
    db.query(`${TODO_SELECT} WHERE NOT t.done ORDER BY t.created_at LIMIT 12`),
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
    openTodos: todos.map(mapTodo),
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
