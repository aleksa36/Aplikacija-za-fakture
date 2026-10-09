import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Entry, Invoice } from '../../shared/types.ts';
import { formatDate, formatHours, formatMoney, formatNumber } from '../../shared/format.ts';
import { LABELS } from './labels.ts';
import { accent, baseDocument, clientBlock, COLORS, headerBlock, metaTable, tableLayout, th } from './common.ts';
import { workReportTable } from './report.ts';

/** Definicija PDF dokumenta fakture (sa opcionim izveštajem o radu kao drugom stranom). */
export function invoiceDocument(invoice: Invoice, entries: Entry[]): TDocumentDefinitions {
  const lang = invoice.language;
  const L = LABELS[lang];
  const s = invoice.seller;
  const color = accent(s);
  const cur = invoice.currency;
  const num = (n: number) => formatNumber(n, lang);

  const itemRows: TableCell[][] = invoice.items.map((it, i) => [
    { text: String(i + 1), color: COLORS.muted },
    { text: it.description },
    { text: formatHours(it.quantity, lang), alignment: 'right' },
    { text: it.unit, color: COLORS.muted },
    { text: num(it.unitPrice), alignment: 'right' },
    { text: num(it.amount ?? it.quantity * it.unitPrice), alignment: 'right', bold: true },
  ]);

  const totalsRows: TableCell[][] = [];
  if (invoice.vatRate > 0) {
    totalsRows.push(
      [{ text: L.subtotal, color: COLORS.muted }, { text: formatMoney(invoice.subtotal, cur, lang), alignment: 'right' }],
      [
        { text: `${L.vat} ${formatNumber(invoice.vatRate, lang, 0)}%`, color: COLORS.muted },
        { text: formatMoney(invoice.vatAmount, cur, lang), alignment: 'right' },
      ],
    );
  }

  const payment: Content[] = [{ text: L.paymentInfo.toUpperCase(), style: 'sectionTitle' }];
  const payRows: [string, string][] = [];
  const domestic = lang === 'sr' && cur === 'RSD';
  if (s.bankAccount && (domestic || !s.iban)) payRows.push([L.bankAccount, s.bankAccount]);
  if (s.iban && !domestic) payRows.push([L.iban, s.iban]);
  if (s.swift && !domestic) payRows.push([L.swift, s.swift]);
  if (s.bankName) payRows.push([L.bank, s.bankName]);
  payRows.push([L.reference, invoice.number]);
  payment.push({
    table: {
      widths: ['auto', '*'],
      body: payRows.map(([k, v]) => [
        { text: k, color: COLORS.muted, margin: [0, 1, 10, 1] },
        { text: v, bold: true, margin: [0, 1, 0, 1] },
      ]),
    },
    layout: 'noBorders',
  });

  const content: Content[] = [
    ...headerBlock(s, lang, L.invoice, `${L.invoiceNo} ${invoice.number}`),
    {
      columns: [
        { width: '*', ...(clientBlock(invoice.client, lang, L.buyer) as object) },
        {
          width: 'auto',
          ...(metaTable([
            [L.issueDate, formatDate(invoice.issueDate, lang)],
            [L.serviceDate, formatDate(invoice.serviceDate, lang)],
            [L.dueDate, formatDate(invoice.dueDate, lang)],
            ...(invoice.place ? ([[L.place, invoice.place]] as [string, string][]) : []),
          ]) as object),
        },
      ],
      columnGap: 20,
      margin: [0, 0, 0, 22],
    } as Content,
    {
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [18, '*', 38, 28, 70, 80],
        body: [
          [th(L.no), th(L.description), th(L.quantity, 'right'), th(L.unit), th(`${L.price} (${cur})`, 'right'), th(`${L.amount} (${cur})`, 'right')],
          ...itemRows,
        ],
      },
      layout: tableLayout(color),
    },
    {
      columns: [
        { width: '*', text: '' },
        {
          width: 230,
          stack: [
            ...(totalsRows.length
              ? [
                  {
                    table: { widths: ['*', 'auto'], body: totalsRows },
                    layout: 'noBorders',
                    margin: [0, 0, 0, 4],
                  } as Content,
                ]
              : []),
            {
              table: {
                widths: ['*', 'auto'],
                body: [
                  [
                    { text: L.total, bold: true, color: '#ffffff', margin: [4, 7, 0, 5] },
                    {
                      text: formatMoney(invoice.total, cur, lang),
                      bold: true,
                      color: '#ffffff',
                      fontSize: 12,
                      alignment: 'right',
                      margin: [0, 4, 4, 4],
                    },
                  ],
                ],
              },
              layout: { defaultBorder: false, fillColor: () => color },
            },
          ],
        },
      ],
      margin: [0, 12, 0, 24],
    },
    {
      columns: [
        { width: '*', stack: payment },
        invoice.notes.trim()
          ? { width: '*', stack: [{ text: L.notes.toUpperCase(), style: 'sectionTitle' }, { text: invoice.notes, color: COLORS.muted }] }
          : { width: '*', text: '' },
      ],
      columnGap: 24,
    },
  ];

  if (s.ownerName) {
    content.push({
      columns: [
        { width: '*', text: '' },
        {
          width: 180,
          stack: [
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 0.5, lineColor: COLORS.muted }] },
            { text: `${L.issuedBy}: ${s.ownerName}`, style: 'small', alignment: 'center', margin: [0, 4, 0, 0] },
          ],
        },
      ],
      margin: [0, 50, 0, 0],
      unbreakable: true,
    });
  }

  if (invoice.includeReport && entries.length) {
    content.push(
      { text: '', pageBreak: 'after' },
      ...headerBlock(s, lang, L.report, `${L.reportFor} ${invoice.number}`),
      {
        columns: [
          { width: '*', ...(clientBlock(invoice.client, lang, L.client) as object) },
          {
            width: 'auto',
            ...(metaTable(
              invoice.periodFrom && invoice.periodTo
                ? [[L.period, `${formatDate(invoice.periodFrom, lang)} – ${formatDate(invoice.periodTo, lang)}`]]
                : [[L.issueDate, formatDate(invoice.issueDate, lang)]],
            ) as object),
          },
        ],
        columnGap: 20,
        margin: [0, 0, 0, 18],
      } as Content,
      workReportTable(entries, lang, color, cur, false),
    );
  }

  const doc = baseDocument(s, lang, content, `${L.invoice} ${invoice.number}`);
  if (invoice.status === 'cancelled') {
    doc.watermark = { text: L.cancelled, color: '#e03131', opacity: 0.12, bold: true };
  }
  return doc;
}
