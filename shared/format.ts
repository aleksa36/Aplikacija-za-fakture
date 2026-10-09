import type { Lang } from './types.ts';

export const MONTHS: Record<Lang, string[]> = {
  sr: ['januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

const SHORT_MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function groupThousands(intPart: string, sep: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** 1234.5 -> "1.234,50" (sr) ili "1,234.50" (en). */
export function formatNumber(n: number, lang: Lang = 'sr', decimals = 2): string {
  const negative = n < 0;
  const [intPart, frac] = Math.abs(n).toFixed(decimals).split('.');
  const out =
    lang === 'sr'
      ? groupThousands(intPart, '.') + (frac ? ',' + frac : '')
      : groupThousands(intPart, ',') + (frac ? '.' + frac : '');
  return (negative ? '-' : '') + out;
}

export function formatMoney(n: number, currency: string, lang: Lang = 'sr'): string {
  return `${formatNumber(n, lang)} ${currency}`;
}

/** Sati bez nepotrebnih decimala: 2 -> "2", 1.5 -> "1,5", 1.25 -> "1,25". */
export function formatHours(h: number, lang: Lang = 'sr'): string {
  const rounded = Math.round(h * 100) / 100;
  const decimals = Number.isInteger(rounded) ? 0 : Number.isInteger(rounded * 10) ? 1 : 2;
  return formatNumber(rounded, lang, decimals);
}

/** "2026-10-09" -> "09.10.2026." (sr) ili "09 Oct 2026" (en). */
export function formatDate(iso: string | null | undefined, lang: Lang = 'sr'): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (lang === 'en') return `${d} ${SHORT_MONTHS_EN[Number(m) - 1]} ${y}`;
  return `${d}.${m}.${y}.`;
}

/** "2026-10" -> "oktobar 2026" */
export function formatMonth(period: string, lang: Lang = 'sr'): string {
  const [y, m] = period.split('-');
  return `${MONTHS[lang][Number(m) - 1]} ${y}`;
}

// ---------- Rad sa datumima (ISO stringovi, bez vremenskih zona) ----------

export function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): string {
  return toIso(new Date());
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toIso(new Date(y, m - 1, d + days));
}

/** Pomera period "YYYY-MM" za n meseci. */
export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

export function monthRange(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number);
  return { from: `${period}-01`, to: `${period}-${pad(daysInMonth(y, m))}` };
}

export function currentPeriod(): string {
  return today().slice(0, 7);
}

/** Tokeni: {n}, {nn}, {nnn}, {nnnn} (redni broj u godini), {yyyy}, {yy}, {mm}. */
export function formatInvoiceNumber(format: string, seq: number, issueDate: string): string {
  const [yyyy, mm] = issueDate.split('-');
  return format
    .replace(/\{(n+)\}/g, (_, n: string) => pad(seq, n.length))
    .replace(/\{yyyy\}/g, yyyy)
    .replace(/\{yy\}/g, yyyy.slice(2))
    .replace(/\{mm\}/g, mm);
}
