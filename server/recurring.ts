import type { Db } from './db.ts';
import { addMonths, maintenanceTitle, today } from '../shared/format.ts';
import type { Lang } from '../shared/types.ts';

/**
 * Upisuje mesečno održavanje za svakog klijenta koji ga ima, za sve mesece od početka
 * održavanja do tekućeg, ako za taj mesec još nije upisano. Bezbedno je pozivati više puta.
 * Vraća broj novih stavki.
 */
export async function syncMaintenance(db: Db, upTo: string = today()): Promise<number> {
  const current = upTo.slice(0, 7);
  const clients = await db.query<{
    id: number;
    language: Lang;
    maintenance_amount: number;
    maintenance_label: string;
    maintenance_start: string;
    done: string[];
  }>(
    `SELECT c.id, c.language, c.maintenance_amount, c.maintenance_label, c.maintenance_start,
            ARRAY(SELECT l.period FROM maintenance_log l WHERE l.client_id = c.id) AS done
     FROM clients c
     WHERE c.maintenance_amount > 0 AND NOT c.archived AND c.maintenance_start IS NOT NULL AND c.maintenance_start <= ?`,
    [current],
  );

  const missing: { clientId: number; period: string; title: string; amount: number }[] = [];
  for (const c of clients) {
    const done = new Set(c.done);
    for (let p = c.maintenance_start; p <= current; p = addMonths(p, 1)) {
      if (!done.has(p)) {
        missing.push({ clientId: c.id, period: p, title: maintenanceTitle(c.maintenance_label, p, c.language), amount: c.maintenance_amount });
      }
    }
  }
  if (!missing.length) return 0;

  return db.tx(async (tx) => {
    let created = 0;
    for (const m of missing) {
      // Zauzmi mesec; ako ga je u međuvremenu upisao drugi zahtev, preskoči.
      const claimed = await tx.query(
        'INSERT INTO maintenance_log (client_id, period) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING period',
        [m.clientId, m.period],
      );
      if (!claimed.length) continue;
      await tx.query(
        `INSERT INTO entries (client_id, kind, period, date, description, hours, fixed_amount, billable)
         VALUES (?, 'maintenance', ?, ?, ?, 0, ?, true)`,
        [m.clientId, m.period, `${m.period}-01`, m.title, m.amount],
      );
      created++;
    }
    return created;
  });
}
