import type { Content, TableCell } from 'pdfmake/interfaces';
import type { Client, Currency, Entry, Lang, Settings } from '../../shared/types.ts';
import { formatDate, formatHours, formatMoney, formatNumber, today } from '../../shared/format.ts';
import { LABELS } from './labels.ts';
import { accent, baseDocument, clientBlock, COLORS, headerBlock, metaTable, renderPdf, tableLayout, th } from './common.ts';

/** Tabela izveštaja o radu: datum, opis, sati (i opciono iznos) sa zbirom. */
export function workReportTable(entries: Entry[], lang: Lang, color: string, currency: Currency, showAmounts: boolean): Content {
  const L = LABELS[lang];
  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const totalValue = entries.reduce((s, e) => s + (e.value ?? 0), 0);
  let prevDate = '';

  const rows: TableCell[][] = entries.map((e) => {
    const isFlat = e.fixedAmount !== null;
    const tags = [e.maintenanceId ? L.maintenance : null, isFlat ? L.flat : null].filter(Boolean).join(', ');
    const dateText = e.date === prevDate ? '' : formatDate(e.date, lang);
    prevDate = e.date;
    const row: TableCell[] = [
      { text: dateText, noWrap: true },
      {
        text: [
          { text: e.description || '—' },
          ...(tags ? [{ text: `  (${tags})`, color: COLORS.muted, fontSize: 8 }] : []),
        ],
      },
      { text: e.hours ? formatHours(e.hours, lang) : '—', alignment: 'right' },
    ];
    if (showAmounts) row.push({ text: formatNumber(e.value ?? 0, lang), alignment: 'right' });
    return row;
  });

  const header: TableCell[] = [th(L.date), th(L.description), th(L.hours, 'right')];
  if (showAmounts) header.push(th(`${L.amount} (${currency})`, 'right'));

  const totalRow: TableCell[] = [
    { text: '', fillColor: COLORS.soft },
    { text: showAmounts ? L.totalShort : L.totalHours, bold: true, alignment: 'right', fillColor: COLORS.soft },
    { text: formatHours(totalHours, lang), bold: true, alignment: 'right', fillColor: COLORS.soft },
  ];
  if (showAmounts) {
    totalRow.push({ text: formatMoney(totalValue, currency, lang), bold: true, alignment: 'right', fillColor: COLORS.soft });
  }

  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: showAmounts ? [62, '*', 40, 90] : [62, '*', 50],
      body: [header, ...rows, totalRow],
    },
    layout: tableLayout(color),
  };
}

export function reportPdf(opts: {
  settings: Settings;
  client: Client;
  entries: Entry[];
  from: string;
  to: string;
  showAmounts: boolean;
}): Promise<Buffer> {
  const { settings, client, entries, from, to, showAmounts } = opts;
  const lang = client.language;
  const L = LABELS[lang];
  const color = accent(settings);
  const period = `${formatDate(from, lang)} – ${formatDate(to, lang)}`;

  const content: Content[] = [
    ...headerBlock(settings, lang, L.report, period),
    {
      columns: [
        { width: '*', ...(clientBlock(client, lang, L.client) as object) },
        {
          width: 'auto',
          ...(metaTable([
            [L.period, period],
            [L.totalHours, formatHours(entries.reduce((s, e) => s + e.hours, 0), lang)],
            ...(showAmounts
              ? ([[L.totalAmount, formatMoney(entries.reduce((s, e) => s + (e.value ?? 0), 0), client.currency, lang)]] as [string, string][])
              : []),
          ]) as object),
        },
      ],
      columnGap: 20,
      margin: [0, 0, 0, 18],
    } as Content,
    workReportTable(entries, lang, color, client.currency, showAmounts),
    {
      text: `${L.generated}: ${formatDate(today(), lang)}`,
      style: 'small',
      margin: [0, 16, 0, 0],
    },
  ];

  return renderPdf(baseDocument(settings, lang, content, `${L.report} – ${client.name}`));
}
