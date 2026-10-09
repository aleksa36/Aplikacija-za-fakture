import path from 'node:path';
import type { Client, Entry, Settings, Todo } from '../shared/types.ts';

// Baza je PostgreSQL:
// - ako je postavljen DATABASE_URL (npr. Supabase), koristi se ta baza;
// - u suprotnom lokalno radi ugrađeni PGlite (Postgres u procesu, podaci u ./data/pglite).

export type Param = string | number | boolean | null;
export type Row = Record<string, unknown>;

export interface Db {
  /** Upit sa `?` parametrima (pretvaraju se u $1, $2…). */
  query<T = Row>(sql: string, params?: Param[]): Promise<T[]>;
  one<T = Row>(sql: string, params?: Param[]): Promise<T | undefined>;
  /** Više naredbi bez parametara (migracije). */
  exec(sql: string): Promise<void>;
  /** Izvršava fn u transakciji; unutar transakcije se poziva direktno. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

/** Pretvara `?` u `$1, $2…`. Naši upiti nemaju `?` unutar string literala. */
export function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function withHelpers(base: Pick<Db, 'query' | 'exec' | 'tx'>): Db {
  return {
    ...base,
    one: async (sql, params) => (await base.query(sql, params))[0] as never,
  };
}

async function connectPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import('postgres');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url) || url.includes('host=/');
  const sql = postgres(url, {
    // Supabase "transaction pooler" (port 6543) ne podržava pripremljene upite.
    prepare: false,
    ssl: local ? false : 'require',
    max: process.env.AWS_LAMBDA_FUNCTION_NAME ? 2 : 10,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
  });
  const wrap = (s: import('postgres').Sql | import('postgres').TransactionSql, inTx: boolean): Db =>
    withHelpers({
      query: async (q, params = []) => [...(await s.unsafe(toPg(q), params as never[]))] as never,
      exec: async (q) => {
        await s.unsafe(q);
      },
      tx: (fn) => (inTx ? fn(wrap(s, true)) : (sql.begin((t) => fn(wrap(t, true))) as Promise<never>)),
    });
  return wrap(sql, false);
}

async function connectPglite(dataDir: string): Promise<Db> {
  // Dinamički import sa promenljivom da ga bundler za Netlify ne bi pakovao.
  const moduleName = '@electric-sql/pglite';
  const { PGlite } = (await import(/* @vite-ignore */ moduleName)) as typeof import('@electric-sql/pglite');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir);
  type Tx = Parameters<Parameters<typeof pg.transaction>[0]>[0];
  const wrap = (s: typeof pg | Tx, inTx: boolean): Db =>
    withHelpers({
      query: async (q, params = []) => (await s.query(toPg(q), params)).rows as never,
      exec: async (q) => {
        await s.exec(q);
      },
      tx: (fn) => (inTx ? fn(wrap(s, true)) : pg.transaction((t) => fn(wrap(t, true)))),
    });
  return wrap(pg, false);
}

export function describeDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url.replace(/\/\/([^:@/]+):[^@]*@/, '//$1:***@');
  return `PGlite (${path.resolve(process.env.DATA_DIR ?? 'data', 'pglite')})`;
}

let ready: Promise<Db> | null = null;

/** Vraća konekciju na bazu; pri prvom pozivu se povezuje i pokreće migracije. */
export function getDb(): Promise<Db> {
  if (!ready) {
    const url = process.env.DATABASE_URL;
    ready = (url ? connectPostgres(url) : connectPglite(path.resolve(process.env.DATA_DIR ?? 'data', 'pglite')))
      .then(async (db) => {
        await migrate(db);
        return db;
      })
      .catch((err) => {
        ready = null; // sledeći zahtev pokušava ponovo
        throw err;
      });
  }
  return ready;
}

// ---------- Migracije ----------

// Redosled je bitan za uvoz (strani ključevi).
const TABLES = ['settings', 'clients', 'todos', 'invoices', 'invoice_items', 'entries', 'maintenance_log'];

const migrations: string[] = [
  `
  CREATE TABLE settings (
    id integer PRIMARY KEY CHECK (id = 1),
    data text NOT NULL
  );

  CREATE TABLE clients (
    id serial PRIMARY KEY,
    name text NOT NULL,
    address text NOT NULL DEFAULT '',
    city text NOT NULL DEFAULT '',
    zip text NOT NULL DEFAULT '',
    country text NOT NULL DEFAULT '',
    pib text NOT NULL DEFAULT '',
    mb text NOT NULL DEFAULT '',
    email text NOT NULL DEFAULT '',
    phone text NOT NULL DEFAULT '',
    contact_person text NOT NULL DEFAULT '',
    hourly_rate double precision NOT NULL DEFAULT 0,
    currency text NOT NULL DEFAULT 'RSD',
    payment_days integer NOT NULL DEFAULT 15,
    language text NOT NULL DEFAULT 'sr',
    vat_exempt boolean NOT NULL DEFAULT false,
    invoice_note text NOT NULL DEFAULT '',
    notes text NOT NULL DEFAULT '',
    color text NOT NULL DEFAULT 'blue',
    archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE maintenance (
    id serial PRIMARY KEY,
    client_id integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    description text NOT NULL,
    hours double precision NOT NULL DEFAULT 0,
    fixed_amount double precision,
    interval_months integer NOT NULL DEFAULT 1,
    day_of_month integer NOT NULL DEFAULT 1,
    start_date text NOT NULL,
    end_date text,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE invoices (
    id serial PRIMARY KEY,
    number text NOT NULL UNIQUE,
    year integer NOT NULL,
    seq integer NOT NULL,
    client_id integer NOT NULL REFERENCES clients(id),
    issue_date text NOT NULL,
    service_date text NOT NULL,
    due_date text NOT NULL,
    place text NOT NULL DEFAULT '',
    currency text NOT NULL,
    language text NOT NULL DEFAULT 'sr',
    vat_rate double precision NOT NULL DEFAULT 0,
    notes text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'draft',
    paid_date text,
    period_from text,
    period_to text,
    include_report boolean NOT NULL DEFAULT true,
    client_json text NOT NULL,
    seller_json text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE invoice_items (
    id serial PRIMARY KEY,
    invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    position integer NOT NULL,
    description text NOT NULL,
    quantity double precision NOT NULL,
    unit text NOT NULL DEFAULT '',
    unit_price double precision NOT NULL
  );
  CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);

  CREATE TABLE entries (
    id serial PRIMARY KEY,
    client_id integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    date text NOT NULL,
    description text NOT NULL DEFAULT '',
    hours double precision NOT NULL DEFAULT 0,
    rate double precision,
    fixed_amount double precision,
    billable boolean NOT NULL DEFAULT true,
    maintenance_id integer REFERENCES maintenance(id) ON DELETE SET NULL,
    invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX idx_entries_client_date ON entries(client_id, date);
  CREATE INDEX idx_entries_invoice ON entries(invoice_id);

  -- Pamti za koje periode je održavanje već upisano, da se ne bi ponovo
  -- generisalo čak i ako korisnik obriše automatski upisanu stavku.
  CREATE TABLE maintenance_runs (
    maintenance_id integer NOT NULL REFERENCES maintenance(id) ON DELETE CASCADE,
    period text NOT NULL,
    entry_id integer,
    PRIMARY KEY (maintenance_id, period)
  );

  -- Supabase izlaže tabele iz "public" šeme preko svog REST API-ja. Uključen RLS bez
  -- pravila znači da im se preko tog API-ja ne može pristupiti; aplikacija se povezuje
  -- direktno kao vlasnik tabela i nije ograničena.
  ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
  ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
  ALTER TABLE maintenance ENABLE ROW LEVEL SECURITY;
  ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
  ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
  ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
  ALTER TABLE maintenance_runs ENABLE ROW LEVEL SECURITY;
  `,
  // 2: jednostavniji model – mesečno održavanje je iznos na klijentu, ručni unos ima period od–do,
  //    projekti na unosima i todo lista po klijentu.
  `
  ALTER TABLE clients ADD COLUMN maintenance_amount double precision NOT NULL DEFAULT 0;
  ALTER TABLE clients ADD COLUMN maintenance_label text NOT NULL DEFAULT 'Mesečno održavanje';
  ALTER TABLE clients ADD COLUMN maintenance_start text;

  ALTER TABLE entries ADD COLUMN kind text NOT NULL DEFAULT 'manual';
  ALTER TABLE entries ADD COLUMN period text;
  ALTER TABLE entries ADD COLUMN date_to text;
  ALTER TABLE entries ADD COLUMN project text NOT NULL DEFAULT '';

  -- Prenos postojećih pravila održavanja na klijente (prvo aktivno paušalno pravilo po klijentu).
  UPDATE clients c SET
    maintenance_amount = m.fixed_amount,
    maintenance_label = COALESCE(NULLIF(trim(regexp_replace(m.description, '\\s*[–-]?\\s*\\{[a-z]+\\}', '', 'gi')), ''), 'Mesečno održavanje'),
    maintenance_start = substr(m.start_date, 1, 7)
  FROM (
    SELECT DISTINCT ON (client_id) * FROM maintenance
    WHERE active AND fixed_amount IS NOT NULL AND fixed_amount > 0
    ORDER BY client_id, id
  ) m
  WHERE m.client_id = c.id;

  UPDATE entries SET kind = 'maintenance', period = substr(date, 1, 7) WHERE maintenance_id IS NOT NULL;

  -- Meseci za koje je održavanje već upisano (da se obrisana stavka ne bi ponovo pojavila).
  CREATE TABLE maintenance_log (
    client_id integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    period text NOT NULL,
    PRIMARY KEY (client_id, period)
  );
  INSERT INTO maintenance_log (client_id, period)
    SELECT DISTINCT m.client_id, r.period FROM maintenance_runs r JOIN maintenance m ON m.id = r.maintenance_id
    ON CONFLICT DO NOTHING;

  ALTER TABLE entries DROP COLUMN maintenance_id;
  DROP TABLE maintenance_runs;
  DROP TABLE maintenance;

  CREATE INDEX idx_entries_maintenance ON entries(client_id, period) WHERE kind = 'maintenance';

  CREATE TABLE todos (
    id serial PRIMARY KEY,
    client_id integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    text text NOT NULL,
    done boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    done_at timestamptz
  );
  CREATE INDEX idx_todos_client ON todos(client_id);

  ALTER TABLE maintenance_log ENABLE ROW LEVEL SECURITY;
  ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
  `,
];

async function migrate(db: Db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (version integer NOT NULL);
    ALTER TABLE schema_version ENABLE ROW LEVEL SECURITY;
  `);
  await db.tx(async (tx) => {
    // Zaključavanje sprečava da dve instance (npr. dve Netlify funkcije) migriraju istovremeno.
    await tx.query('SELECT pg_advisory_xact_lock(727274)');
    const row = await tx.one<{ version: number }>('SELECT version FROM schema_version');
    let version = row?.version ?? 0;
    if (!row) await tx.query('INSERT INTO schema_version (version) VALUES (0)');
    while (version < migrations.length) {
      await tx.exec(migrations[version]);
      version++;
      await tx.query('UPDATE schema_version SET version = ?', [version]);
    }
  });
}

// ---------- Izvoz / uvoz (rezervna kopija) ----------

export interface BackupFile {
  app: 'fakture';
  version: number;
  exportedAt: string;
  tables: Record<string, Row[]>;
}

export async function exportAll(db: Db): Promise<BackupFile> {
  const tables: Record<string, Row[]> = {};
  for (const t of TABLES) tables[t] = await db.query(`SELECT * FROM ${t}`);
  return { app: 'fakture', version: migrations.length, exportedAt: new Date().toISOString(), tables };
}

/** Briše sve podatke i učitava ih iz rezervne kopije (u jednoj transakciji). */
export async function importAll(db: Db, backup: BackupFile): Promise<Record<string, number>> {
  if (backup?.app !== 'fakture' || typeof backup.tables !== 'object') throw new Error('Datoteka nije rezervna kopija ove aplikacije.');
  const counts: Record<string, number> = {};
  await db.tx(async (tx) => {
    await tx.exec(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    for (const table of TABLES) {
      const rows = backup.tables[table] ?? [];
      counts[table] = rows.length;
      if (!rows.length) continue;
      const allowed = new Set((await tx.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?`,
        [table],
      )).map((c) => c.column_name));
      const cols = Object.keys(rows[0]).filter((c) => allowed.has(c));
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const values = chunk.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
        const params = chunk.flatMap((r) => cols.map((c) => (r[c] ?? null) as Param));
        await tx.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values}`, params);
      }
      if (allowed.has('id')) {
        await tx.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT MAX(id) FROM ${table}), 1))`);
      }
    }
  });
  return counts;
}

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
  ipsQr: true,
  paymentCode: '221',
};

export async function getSettings(db: Db): Promise<Settings> {
  const row = await db.one<{ data: string }>('SELECT data FROM settings WHERE id = 1');
  return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.data) : {}) };
}

export async function saveSettings(db: Db, s: Partial<Settings>): Promise<Settings> {
  const merged: Settings = { ...(await getSettings(db)), ...s };
  await db.query(
    'INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data',
    [JSON.stringify(merged)],
  );
  return merged;
}

// ---------- Mapiranje redova ----------

function ts(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v ?? '');
}

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
    maintenanceAmount: (r.maintenance_amount as number) ?? 0,
    maintenanceLabel: (r.maintenance_label as string) ?? '',
    maintenanceStart: (r.maintenance_start as string | null) ?? null,
    createdAt: ts(r.created_at),
    openTodos: (r.open_todos as number | undefined) ?? undefined,
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
    kind: (r.kind as Entry['kind']) ?? 'manual',
    date: r.date as string,
    dateTo: (r.date_to as string | null) ?? null,
    period: (r.period as string | null) ?? null,
    project: (r.project as string) ?? '',
    description: r.description as string,
    hours,
    rate,
    fixedAmount,
    billable: !!r.billable,
    invoiceId: (r.invoice_id as number | null) ?? null,
    invoiceNumber: (r.invoice_number as string | null) ?? null,
    createdAt: ts(r.created_at),
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

/** SQL izraz za vrednost stavke (alias e = entries, c = clients). */
export const ENTRY_VALUE_SQL = 'COALESCE(e.fixed_amount, e.hours * COALESCE(e.rate, c.hourly_rate))';

export function mapTodo(r: Row): Todo {
  return {
    id: r.id as number,
    clientId: r.client_id as number,
    text: r.text as string,
    done: !!r.done,
    createdAt: ts(r.created_at),
    doneAt: r.done_at ? ts(r.done_at) : null,
    clientName: r.client_name as string | undefined,
    clientColor: r.client_color as string | undefined,
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
