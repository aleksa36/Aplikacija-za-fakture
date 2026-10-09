import type { InvoiceStatus, MoneyByCurrency } from '../shared/types.ts';
import { addMonths, currentPeriod, formatMoney, monthRange, today } from '../shared/format.ts';

export const CLIENT_COLORS = ['blue', 'cyan', 'teal', 'green', 'lime', 'yellow', 'orange', 'red', 'pink', 'grape', 'violet', 'indigo'];

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Nacrt',
  sent: 'Poslata',
  paid: 'Plaćena',
  cancelled: 'Stornirana',
};

export const STATUS_COLOR: Record<InvoiceStatus, string> = {
  draft: 'gray',
  sent: 'blue',
  paid: 'teal',
  cancelled: 'red',
};

/** Naziv projekta za prikaz (posebne vrednosti iz statistike). */
export function projectLabel(project: string): string {
  if (project === '__maintenance') return 'Mesečno održavanje';
  return project || 'Bez projekta';
}

/**
 * Prihvata "1,5", "1.5", "1:30", "1h30", "1h 30m", "90m" i vraća broj sati (ili null).
 */
export function parseHours(input: string): number | null {
  const s = input.trim().toLowerCase().replace(',', '.');
  if (!s) return null;
  let m = /^(\d+):(\d{1,2})$/.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  m = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/.exec(s);
  if (m && (m[1] || m[2])) return Number(m[1] ?? 0) + Number(m[2] ?? 0) / 60;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function moneyList(list: MoneyByCurrency[]): string {
  if (!list.length) return '0,00';
  return list.map((m) => formatMoney(m.amount, m.currency)).join(' + ');
}

export function periodPresets() {
  const cur = currentPeriod();
  const thisMonth = monthRange(cur);
  const lastMonth = monthRange(addMonths(cur, -1));
  const year = today().slice(0, 4);
  return [
    { label: 'Ovaj mesec', value: [thisMonth.from, thisMonth.to] as [string, string] },
    { label: 'Prošli mesec', value: [lastMonth.from, lastMonth.to] as [string, string] },
    { label: 'Ova godina', value: [`${year}-01-01`, `${year}-12-31`] as [string, string] },
  ];
}

const WEEKDAYS = ['Nedelja', 'Ponedeljak', 'Utorak', 'Sreda', 'Četvrtak', 'Petak', 'Subota'];

export function weekday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

export function downloadUrl(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Srpska množina: count(1, 'unos', 'unosa', 'unosa') → "1 unos", 3 → "3 unosa", 5 → "5 unosa". */
export function count(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${n} ${word}`;
}

export const countEntries = (n: number) => count(n, 'unos', 'unosa', 'unosa');
