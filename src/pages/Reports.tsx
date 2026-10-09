import { useMemo, useState } from 'react';
import { Button, Checkbox, Group, Paper, SimpleGrid, Table, Text, Title, Tooltip } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconDownload, IconFileTypeCsv, IconFileTypePdf, IconFileInvoice } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import type { Currency } from '../../shared/types.ts';
import { currentPeriod, formatDateRange, formatHours, formatMoney, monthRange } from '../../shared/format.ts';
import { notifyError, qs, useClients, useEntries, useSettings } from '../api.ts';
import { downloadReportPdf, openReportPdf } from '../pdf/index.ts';
import { ClientBadge, ClientSelect, EmptyState, PageHeader, StatCard } from '../components/common.tsx';
import { countEntries, moneyList, periodPresets } from '../utils.ts';

export function ReportsPage() {
  const navigate = useNavigate();
  const month = monthRange(currentPeriod());
  const [clientId, setClientId] = useState<number | null>(null);
  const [range, setRange] = useState<[string | null, string | null]>([month.from, month.to]);
  const [showAmounts, setShowAmounts] = useState(false);
  const [billableOnly, setBillableOnly] = useState(true);
  const [unbilledOnly, setUnbilledOnly] = useState(false);
  const [from, to] = range;

  const entries = useEntries({ clientId, from, to }, !!from && !!to);
  const list = useMemo(
    () =>
      (entries.data ?? [])
        .filter((e) => (!billableOnly || e.billable) && (!unbilledOnly || !e.invoiceId))
        .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id),
    [entries.data, billableOnly, unbilledOnly],
  );

  const perClient = useMemo(() => {
    const map = new Map<number, { name: string; color: string; hours: number; value: number; currency: Currency; unbilled: number }>();
    for (const e of list) {
      const p = map.get(e.clientId) ?? { name: e.clientName ?? '', color: e.clientColor ?? 'gray', hours: 0, value: 0, currency: e.currency ?? 'RSD', unbilled: 0 };
      p.hours += e.hours;
      if (e.billable) p.value += e.value ?? 0;
      if (e.billable && !e.invoiceId) p.unbilled += e.value ?? 0;
      map.set(e.clientId, p);
    }
    return [...map].sort((a, b) => b[1].hours - a[1].hours);
  }, [list]);

  const totals = new Map<Currency, number>();
  for (const [, p] of perClient) totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.value);
  const totalHours = list.reduce((s, e) => s + e.hours, 0);

  const settings = useSettings();
  const clients = useClients();
  const client = clients.data?.find((c) => c.id === clientId);
  const reportOptions =
    client && settings.data && from && to ? { settings: settings.data, client, entries: list, from, to, showAmounts } : null;
  const pdf = (mode: 'open' | 'download') => {
    if (!reportOptions) return;
    (mode === 'open' ? openReportPdf(reportOptions) : downloadReportPdf(reportOptions)).catch(notifyError);
  };
  const csvParams = qs({ clientId, from, to });

  return (
    <>
      <PageHeader title="Izveštaji" description="Pregled rada po periodu i klijentu, PDF izveštaj o radu za klijenta i izvoz u Excel (CSV)." />

      <Paper p="md" mb="md">
        <Group gap="sm" align="flex-end" wrap="wrap">
          <DatePickerInput
            type="range"
            label="Period"
            value={range}
            onChange={setRange}
            valueFormat="DD.MM.YYYY."
            presets={periodPresets()}
            w={260}
          />
          <ClientSelect label="Klijent" value={clientId} onChange={setClientId} clearable placeholder="Svi klijenti" w={240} includeArchived />
          <Checkbox label="Samo naplativo" checked={billableOnly} onChange={(e) => setBillableOnly(e.currentTarget.checked)} mb={8} />
          <Checkbox label="Samo nefakturisano" checked={unbilledOnly} onChange={(e) => setUnbilledOnly(e.currentTarget.checked)} mb={8} />
          <Checkbox label="Iznosi u PDF-u" checked={showAmounts} onChange={(e) => setShowAmounts(e.currentTarget.checked)} mb={8} />
        </Group>
        <Group mt="md" gap="xs">
          <Tooltip label="Prvo izaberite klijenta" disabled={!!clientId}>
            <Button leftSection={<IconFileTypePdf size={16} />} onClick={() => pdf('open')} disabled={!reportOptions}>
              PDF izveštaj za klijenta
            </Button>
          </Tooltip>
          <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => pdf('download')} disabled={!reportOptions}>
            Preuzmi PDF
          </Button>
          <Button variant="default" leftSection={<IconFileTypeCsv size={16} />} component="a" href={`/api/reports/entries.csv${csvParams}`}>
            Izvezi CSV
          </Button>
          {clientId && (
            <Button
              variant="light"
              leftSection={<IconFileInvoice size={16} />}
              onClick={() => navigate(`/fakture/nova${qs({ clientId, from, to })}`)}
            >
              Napravi fakturu za ovaj period
            </Button>
          )}
        </Group>
      </Paper>

      <SimpleGrid cols={{ base: 1, sm: 3 }} mb="md">
        <StatCard label="Ukupno sati" value={`${formatHours(totalHours)} h`} hint={countEntries(list.length)} />
        <StatCard label="Vrednost" value={moneyList([...totals].map(([currency, amount]) => ({ currency, amount })))} />
        <StatCard label="Klijenata" value={perClient.length} />
      </SimpleGrid>

      {!clientId && perClient.length > 0 && (
        <Paper p={0} mb="md">
          <Title order={5} p="md" pb="xs">
            Po klijentima
          </Title>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Klijent</Table.Th>
                <Table.Th className="num">Sati</Table.Th>
                <Table.Th className="num">Vrednost</Table.Th>
                <Table.Th className="num">Nefakturisano</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {perClient.map(([id, p]) => (
                <Table.Tr key={id} className="clickable-row" onClick={() => setClientId(id)}>
                  <Table.Td>
                    <ClientBadge name={p.name} color={p.color} />
                  </Table.Td>
                  <Table.Td className="num">{formatHours(p.hours)} h</Table.Td>
                  <Table.Td className="num">{formatMoney(p.value, p.currency)}</Table.Td>
                  <Table.Td className="num">{formatMoney(p.unbilled, p.currency)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      <Paper p={0}>
        <Title order={5} p="md" pb="xs">
          Unosi
        </Title>
        {list.length === 0 ? (
          <EmptyState>Nema unosa za izabrane filtere.</EmptyState>
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing="xs" striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Datum</Table.Th>
                  {!clientId && <Table.Th>Klijent</Table.Th>}
                  <Table.Th>Opis</Table.Th>
                  <Table.Th className="num">Sati</Table.Th>
                  <Table.Th className="num">Iznos</Table.Th>
                  <Table.Th>Faktura</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {list.map((e) => (
                  <Table.Tr key={e.id}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateRange(e.date, e.dateTo)}</Table.Td>
                    {!clientId && (
                      <Table.Td>
                        <ClientBadge name={e.clientName} color={e.clientColor} />
                      </Table.Td>
                    )}
                    <Table.Td>
                      <Text size="sm">
                        {e.project && <b>{e.project}: </b>}
                        {e.description}
                      </Text>
                    </Table.Td>
                    <Table.Td className="num">{e.hours ? formatHours(e.hours) : '—'}</Table.Td>
                    <Table.Td className="num">{formatMoney(e.value ?? 0, e.currency ?? '')}</Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {e.invoiceNumber ?? ''}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Paper>
    </>
  );
}
