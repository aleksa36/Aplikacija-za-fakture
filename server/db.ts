import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Client, Entry, Maintenance, Settings } from '../shared/types.ts';

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data');
mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = path.join(DATA_DIR, 'fakture.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// Migracije: svaka se izvršava tačno jednom, redom.
const migrations: string[] = [
  `
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL
  );

  CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    zip TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    pib TEXT NOT NULL DEFAULT '',
    mb TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    contact_person TEXT NOT NULL DEFAULT '',
    hourly_rate REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'RSD',
    payment_days INTEGER NOT NULL DEFAULT 15,
    language TEXT NOT NULL DEFAULT 'sr',
    vat_exempt INTEGER NOT NULL DEFAULT 0,
    invoice_note TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT 'blue',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE maintenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    hours REAL NOT NULL DEFAULT 0,
    fixed_amount REAL,
    interval_months INTEGER NOT NULL DEFAULT 1,
    day_of_month INTEGER NOT NULL DEFAULT 1,
    start_date TEXT NOT NULL,
    end_date TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    year INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    issue_date TEXT NOT NULL,
    service_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    place TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'sr',
    vat_rate REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    paid_date TEXT,
    period_from TEXT,
    period_to TEXT,
    include_report INTEGER NOT NULL DEFAULT 1,
    client_json TEXT NOT NULL,
    seller_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    description TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit TEXT NOT NULL DEFAULT '',
    unit_price REAL NOT NULL
  );

  CREATE TABLE entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    hours REAL NOT NULL DEFAULT 0,
    rate REAL,
    fixed_amount REAL,
    billable INTEGER NOT NULL DEFAULT 1,
    maintenance_id INTEGER REFERENCES maintenance(id) ON DELETE SET NULL,
    invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_entries_client_date ON entries(client_id, date);
  CREATE INDEX idx_entries_invoice ON entries(invoice_id);

  -- Pamti za koje periode je održavanje već upisano, da se ne bi ponovo
  -- generisalo čak i ako korisnik obriše automatski upisanu stavku.
  CREATE TABLE maintenance_runs (
    maintenance_id INTEGER NOT NULL REFERENCES maintenance(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    entry_id INTEGER,
    PRIMARY KEY (maintenance_id, period)
  );
  `,
];

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (version < migrations.length) {
    transaction(() => {
      db.exec(migrations[version]);
      db.prepare('UPDATE schema_version SET version = ?').run(version + 1);
    });
    version++;
  }
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

migrate();

// ---------- Podešavanja ----------

export const DEFAULT_SETTINGS: Settings = {
  companyName: '',
  ownerName: '',
  address: '',
  city: '',
  zip: '',
  country: 'Srbija',
  pib: '',
  mb: '',
  activityCode: '',
  email: '',
  phone: '',
  website: '',
  bankAccount: '',
  bankName: '',
  iban: '',
  swift: '',
  logo: '',
  accentColor: '#1c7ed6',
  invoiceNumberFormat: '{n}/{yyyy}',
  defaultPlace: '',
  defaultPaymentDays: 15,
  defaultHourlyRate: 0,
  defaultCurrency: 'RSD',
  vatPayer: false,
  vatRate: 20,
  defaultInvoiceNote: 'Obveznik nije u sistemu PDV-a.\nFaktura je važeća bez pečata i potpisa.',
  defaultInvoiceNoteEn: 'The issuer is not registered for VAT.\nThe invoice is valid without stamp and signature.',
  serviceDescription: 'Usluge razvoja i održavanja softvera',
  serviceDescriptionEn: 'Software development and maintenance services',
};

export function getSettings(): Settings {
  const row = db.prepare('SELECT data FROM settings WHERE id = 1').get() as { data: string } | undefined;
  return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.data) : {}) };
}

export function saveSettings(s: Partial<Settings>): Settings {
  const merged: Settings = { ...getSettings(), ...s };
  db.prepare(
    'INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
  ).run(JSON.stringify(merged));
  return merged;
}

// ---------- Mapiranje redova ----------

type Row = Record<string, unknown>;

export function mapClient(r: Row): Client {
  return {
    id: r.id as number,
    name: r.name as string,
    address: r.address as string,
    city: r.city as string,
    zip: r.zip as string,
    country: r.country as string,
    pib: r.pib as string,
    mb: r.mb as string,
    email: r.email as string,
    phone: r.phone as string,
    contactPerson: r.contact_person as string,
    hourlyRate: r.hourly_rate as number,
    currency: r.currency as Client['currency'],
    paymentDays: r.payment_days as number,
    language: r.language as Client['language'],
    vatExempt: !!r.vat_exempt,
    invoiceNote: r.invoice_note as string,
    notes: r.notes as string,
    color: r.color as string,
    archived: !!r.archived,
    createdAt: r.created_at as string,
  };
}

export function mapEntry(r: Row): Entry {
  const hours = r.hours as number;
  const rate = (r.rate as number | null) ?? null;
  const fixedAmount = (r.fixed_amount as number | null) ?? null;
  const effectiveRate = rate ?? ((r.client_rate as number | undefined) ?? 0);
  return {
    id: r.id as number,
    clientId: r.client_id as number,
    date: r.date as string,
    description: r.description as string,
    hours,
    rate,
    fixedAmount,
    billable: !!r.billable,
    maintenanceId: (r.maintenance_id as number | null) ?? null,
    invoiceId: (r.invoice_id as number | null) ?? null,
    invoiceNumber: (r.invoice_number as string | null) ?? null,
    createdAt: r.created_at as string,
    effectiveRate,
    value: entryValue(hours, effectiveRate, fixedAmount),
    currency: r.client_currency as Entry['currency'],
    clientName: r.client_name as string,
    clientColor: r.client_color as string,
  };
}

export function entryValue(hours: number, rate: number, fixedAmount: number | null): number {
  return round2(fixedAmount ?? hours * rate);
}

export function mapMaintenance(r: Row): Maintenance {
  return {
    id: r.id as number,
    clientId: r.client_id as number,
    description: r.description as string,
    hours: r.hours as number,
    fixedAmount: (r.fixed_amount as number | null) ?? null,
    intervalMonths: r.interval_months as number,
    dayOfMonth: r.day_of_month as number,
    startDate: r.start_date as string,
    endDate: (r.end_date as string | null) ?? null,
    active: !!r.active,
    createdAt: r.created_at as string,
    clientName: r.client_name as string | undefined,
    lastPeriod: (r.last_period as string | null) ?? null,
  };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** SELECT za stavke rada sa podacima o klijentu i fakturi. */
export const ENTRY_SELECT = `
  SELECT e.*, c.hourly_rate AS client_rate, c.currency AS client_currency,
         c.name AS client_name, c.color AS client_color, i.number AS invoice_number
  FROM entries e
  JOIN clients c ON c.id = e.client_id
  LEFT JOIN invoices i ON i.id = e.invoice_id
`;
