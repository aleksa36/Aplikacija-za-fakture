import type { Content, CustomTableLayout, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Client, Lang, Settings } from '../../shared/types.ts';
import { LABELS } from './labels.ts';

export const COLORS = {
  text: '#1f2937',
  muted: '#6b7280',
  border: '#e5e7eb',
  zebra: '#f9fafb',
  soft: '#f3f4f6',
};

export function accent(settings: Settings): string {
  return /^#[0-9a-f]{6}$/i.test(settings.accentColor) ? settings.accentColor : '#1c7ed6';
}

/** Spaja delove u jedan red, preskačući prazne. */
export function joinLine(parts: (string | undefined | null | false)[], sep = ', '): string {
  return parts.filter((p) => p && String(p).trim()).join(sep);
}

const COUNTRY_EN: Record<string, string> = { srbija: 'Serbia', 'republika srbija': 'Republic of Serbia' };

export function addressLines(p: { address: string; zip: string; city: string; country: string }, lang: Lang): string[] {
  const country = lang === 'en' ? (COUNTRY_EN[p.country.trim().toLowerCase()] ?? p.country) : p.country;
  return [p.address, joinLine([joinLine([p.zip, p.city], ' '), country])].filter(Boolean);
}

/** Zaglavlje dokumenta: podaci izdavaoca levo, naslov i broj desno. */
export function headerBlock(settings: Settings, lang: Lang, title: string, subtitle: string): Content[] {
  const L = LABELS[lang];
  const color = accent(settings);
  const sellerLines: Content[] = [];
  if (settings.logo && /^data:image\/(png|jpe?g);base64,/.test(settings.logo)) {
    sellerLines.push({ image: settings.logo, fit: [150, 55], margin: [0, 0, 0, 8] });
  }
  sellerLines.push({ text: settings.companyName || settings.ownerName || '—', style: 'sellerName' });
  if (settings.ownerName && settings.companyName) sellerLines.push({ text: settings.ownerName, style: 'small' });
  for (const line of addressLines(settings, lang)) sellerLines.push({ text: line, style: 'small' });
  const ids = joinLine(
    [settings.pib && `${L.pib}: ${settings.pib}`, settings.mb && `${L.mb}: ${settings.mb}`],
    '   ',
  );
  if (ids) sellerLines.push({ text: ids, style: 'small' });
  if (settings.activityCode) sellerLines.push({ text: `${L.activityCode}: ${settings.activityCode}`, style: 'small' });
  const contact = joinLine([settings.email, settings.phone, settings.website], '  ·  ');
  if (contact) sellerLines.push({ text: contact, style: 'small' });

  return [
    {
      columns: [
        { width: '*', stack: sellerLines },
        {
          width: 'auto',
          alignment: 'right',
          stack: [
            { text: title, fontSize: 24, bold: true, color, characterSpacing: 1.5 },
            { text: subtitle, fontSize: 11, bold: true, margin: [0, 2, 0, 0] },
          ],
        },
      ],
    },
    {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: color }],
      margin: [0, 14, 0, 14],
    },
  ];
}

export function clientBlock(client: Client, lang: Lang, label: string): Content {
  const L = LABELS[lang];
  const lines: Content[] = [
    { text: label.toUpperCase(), style: 'label', margin: [0, 0, 0, 4] },
    { text: client.name, bold: true, fontSize: 11 },
  ];
  for (const line of addressLines(client, lang)) lines.push({ text: line });
  const ids = joinLine([client.pib && `${L.pib}: ${client.pib}`, client.mb && `${L.mb}: ${client.mb}`], '   ');
  if (ids) lines.push({ text: ids });
  if (client.contactPerson) lines.push({ text: `${L.contact}: ${client.contactPerson}`, color: COLORS.muted });
  if (client.email) lines.push({ text: client.email, color: COLORS.muted });
  return { stack: lines };
}

/** Mala tabela "oznaka: vrednost" (datumi, period...). */
export function metaTable(rows: [string, string][]): Content {
  return {
    table: {
      widths: ['auto', 'auto'],
      body: rows.map(([k, v]) => [
        { text: k, color: COLORS.muted, margin: [0, 1, 12, 1] },
        { text: v, bold: true, alignment: 'right', margin: [0, 1, 0, 1] },
      ]),
    },
    layout: 'noBorders',
  };
}

export function tableLayout(color: string): CustomTableLayout {
  return {
    hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 0 : 0.5),
    vLineWidth: () => 0,
    hLineColor: () => COLORS.border,
    fillColor: (row) => (row === 0 ? color : row % 2 === 0 ? COLORS.zebra : null),
    paddingLeft: () => 6,
    paddingRight: () => 6,
    paddingTop: () => 5,
    paddingBottom: () => 5,
  };
}

export function th(text: string, alignment: 'left' | 'right' | 'center' = 'left'): Content {
  return { text, bold: true, color: '#ffffff', fontSize: 9, alignment };
}

export function baseDocument(settings: Settings, lang: Lang, content: Content[], title: string): TDocumentDefinitions {
  const L = LABELS[lang];
  const footerLeft = joinLine([settings.companyName || settings.ownerName, settings.pib && `${L.pib} ${settings.pib}`], '  ·  ');
  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    info: { title, author: settings.companyName || settings.ownerName, creator: 'Fakture' },
    defaultStyle: { font: 'Roboto', fontSize: 9.5, color: COLORS.text, lineHeight: 1.25 },
    styles: {
      sellerName: { fontSize: 13, bold: true, margin: [0, 0, 0, 2] },
      small: { fontSize: 8.5, color: COLORS.muted },
      label: { fontSize: 8, bold: true, color: COLORS.muted, characterSpacing: 0.8 },
      sectionTitle: { fontSize: 8, bold: true, color: COLORS.muted, characterSpacing: 0.8, margin: [0, 0, 0, 4] },
    },
    footer: (currentPage, pageCount) => ({
      margin: [40, 16, 40, 0],
      columns: [
        { text: footerLeft, style: 'small', fontSize: 7.5 },
        { text: `${L.page} ${currentPage} ${L.of} ${pageCount}`, alignment: 'right', style: 'small', fontSize: 7.5 },
      ],
    }),
    content,
  };
}
