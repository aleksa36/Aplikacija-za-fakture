import { db, mapMaintenance, transaction } from './db.ts';
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

/**
 * Upisuje stavke za sva aktivna obavezna održavanja čiji je datum stigao,
 * a još nisu upisana. Bezbedno je pozivati više puta (idempotentno).
 * Vraća broj novih stavki.
 */
export function syncMaintenance(upTo: string = today()): number {
  const rules = db
    .prepare(
      `SELECT m.*, c.language AS client_language FROM maintenance m
       JOIN clients c ON c.id = m.client_id
       WHERE m.active = 1 AND c.archived = 0 AND m.start_date <= ?`,
    )
    .all(upTo);

  const hasRun = db.prepare('SELECT 1 FROM maintenance_runs WHERE maintenance_id = ? AND period = ?');
  const insertEntry = db.prepare(
    `INSERT INTO entries (client_id, date, description, hours, fixed_amount, billable, maintenance_id)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  );
  const insertRun = db.prepare('INSERT INTO maintenance_runs (maintenance_id, period, entry_id) VALUES (?, ?, ?)');

  let created = 0;
  transaction(() => {
    for (const row of rules) {
      const rule = mapMaintenance(row);
      const lang = (row.client_language as Lang) ?? 'sr';
      const step = Math.max(1, rule.intervalMonths);
      let period = rule.startDate.slice(0, 7);
      // Ako je dan u mesecu pre datuma početka, prva pojava pada u sledećem intervalu.
      if (occurrenceDate(period, rule.dayOfMonth) < rule.startDate) period = addMonths(period, step);

      for (;;) {
        const date = occurrenceDate(period, rule.dayOfMonth);
        if (date > upTo) break;
        if (rule.endDate && date > rule.endDate) break;
        if (!hasRun.get(rule.id, period)) {
          const description = renderMaintenanceDescription(rule.description, period, lang);
          const res = insertEntry.run(rule.clientId, date, description, rule.hours, rule.fixedAmount, rule.id);
          insertRun.run(rule.id, period, Number(res.lastInsertRowid));
          created++;
        }
        period = addMonths(period, step);
      }
    }
  });
  return created;
}

/**
 * Kada se pauzirano održavanje ponovo uključi, periodi dok je bilo pauzirano
 * označavaju se kao preskočeni, da se ne bi naknadno upisali unazad.
 * Tekući period ostaje da se normalno upiše.
 */
export function skipPausedPeriods(maintenanceId: number, upTo: string = today()) {
  const row = db.prepare('SELECT * FROM maintenance WHERE id = ?').get(maintenanceId);
  if (!row) return;
  const rule = mapMaintenance(row);
  const currentPeriod = upTo.slice(0, 7);
  const step = Math.max(1, rule.intervalMonths);
  const insert = db.prepare('INSERT OR IGNORE INTO maintenance_runs (maintenance_id, period, entry_id) VALUES (?, ?, NULL)');
  let period = rule.startDate.slice(0, 7);
  if (occurrenceDate(period, rule.dayOfMonth) < rule.startDate) period = addMonths(period, step);
  while (period < currentPeriod) {
    insert.run(rule.id, period);
    period = addMonths(period, step);
  }
}
