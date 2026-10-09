import { mapMaintenance, type Db } from './db.ts';
import { addMonths, daysInMonth, formatMonth, pad, today } from '../shared/format.ts';
import type { Lang } from '../shared/types.ts';

/** Zamenjuje {mesec}/{month} i {godina}/{year} u opisu održavanja. */
export function renderMaintenanceDescription(template: string, period: string, lang: Lang): string {
  const [year] = period.split('-');
  const month = formatMonth(period, lang).split(' ')[0];
  return template
    .replace(/\{(mesec|month)\}/gi, month)
    .replace(/\{(godina|year)\}/gi, year);
}

export function occurrenceDate(period: string, dayOfMonth: number): string {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${pad(Math.min(dayOfMonth, daysInMonth(y, m)))}`;
}

function firstPeriod(startDate: string, dayOfMonth: number, step: number): string {
  const period = startDate.slice(0, 7);
  // Ako je dan u mesecu pre datuma početka, prva pojava pada u sledećem intervalu.
  return occurrenceDate(period, dayOfMonth) < startDate ? addMonths(period, step) : period;
}

/**
 * Upisuje stavke za sva aktivna obavezna održavanja čiji je datum stigao,
 * a još nisu upisana. Bezbedno je pozivati više puta (idempotentno).
 * Vraća broj novih stavki.
 */
export async function syncMaintenance(db: Db, upTo: string = today()): Promise<number> {
  const rules = await db.query(
    `SELECT m.*, c.language AS client_language,
            ARRAY(SELECT r.period FROM maintenance_runs r WHERE r.maintenance_id = m.id) AS done_periods
     FROM maintenance m JOIN clients c ON c.id = m.client_id
     WHERE m.active AND NOT c.archived AND m.start_date <= ?`,
    [upTo],
  );

  // Prvo izračunamo šta nedostaje (bez upisa), da u većini poziva ne otvaramo transakciju.
  const missing: { clientId: number; ruleId: number; period: string; date: string; description: string; hours: number; fixedAmount: number | null }[] = [];
  for (const row of rules) {
    const rule = mapMaintenance(row);
    const done = new Set(row.done_periods as string[]);
    const lang = (row.client_language as Lang) ?? 'sr';
    const step = Math.max(1, rule.intervalMonths);
    for (let period = firstPeriod(rule.startDate, rule.dayOfMonth, step); ; period = addMonths(period, step)) {
      const date = occurrenceDate(period, rule.dayOfMonth);
      if (date > upTo || (rule.endDate && date > rule.endDate)) break;
      if (done.has(period)) continue;
      missing.push({
        clientId: rule.clientId,
        ruleId: rule.id,
        period,
        date,
        description: renderMaintenanceDescription(rule.description, period, lang),
        hours: rule.hours,
        fixedAmount: rule.fixedAmount,
      });
    }
  }
  if (!missing.length) return 0;

  return db.tx(async (tx) => {
    let created = 0;
    for (const m of missing) {
      // Zauzmi period; ako ga je u međuvremenu upisao drugi zahtev, preskoči.
      const claimed = await tx.query(
        'INSERT INTO maintenance_runs (maintenance_id, period) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING period',
        [m.ruleId, m.period],
      );
      if (!claimed.length) continue;
      const entry = await tx.one<{ id: number }>(
        `INSERT INTO entries (client_id, date, description, hours, fixed_amount, billable, maintenance_id)
         VALUES (?, ?, ?, ?, ?, true, ?) RETURNING id`,
        [m.clientId, m.date, m.description, m.hours, m.fixedAmount, m.ruleId],
      );
      await tx.query('UPDATE maintenance_runs SET entry_id = ? WHERE maintenance_id = ? AND period = ?', [entry!.id, m.ruleId, m.period]);
      created++;
    }
    return created;
  });
}

/**
 * Kada se pauzirano održavanje ponovo uključi, periodi dok je bilo pauzirano
 * označavaju se kao preskočeni, da se ne bi naknadno upisali unazad.
 * Tekući period ostaje da se normalno upiše.
 */
export async function skipPausedPeriods(db: Db, maintenanceId: number, upTo: string = today()) {
  const row = await db.one('SELECT * FROM maintenance WHERE id = ?', [maintenanceId]);
  if (!row) return;
  const rule = mapMaintenance(row);
  const currentPeriod = upTo.slice(0, 7);
  const step = Math.max(1, rule.intervalMonths);
  const periods: string[] = [];
  for (let p = firstPeriod(rule.startDate, rule.dayOfMonth, step); p < currentPeriod; p = addMonths(p, step)) periods.push(p);
  if (!periods.length) return;
  await db.query(
    `INSERT INTO maintenance_runs (maintenance_id, period) VALUES ${periods.map(() => '(?, ?)').join(', ')} ON CONFLICT DO NOTHING`,
    periods.flatMap((p) => [maintenanceId, p]),
  );
}
