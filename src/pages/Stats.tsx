import { useMemo, useState } from 'react';
import { Group, Paper, SimpleGrid, Table, Text } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useNavigate } from 'react-router-dom';
import { formatDateRange, formatHours, formatMoney, today } from '../../shared/format.ts';
import { useClients, useStats } from '../api.ts';
import { ClientBadge, ClientSelect, EmptyState, PageHeader, StatCard } from '../components/common.tsx';
import { HoursChart, Meter } from '../components/HoursChart.tsx';
import { count, countEntries, moneyList, periodPresets, projectLabel } from '../utils.ts';

export function StatsPage() {
  const navigate = useNavigate();
  const year = today().slice(0, 4);
  const [range, setRange] = useState<[string | null, string | null]>([`${year}-01-01`, `${year}-12-31`]);
  const [clientId, setClientId] = useState<number | null>(null);
  const [from, to] = range;
  const stats = useStats({ from, to, clientId });
  const clients = useClients();
  const clientMap = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, { name: c.name, color: c.color }])), [clients.data]);

  const s = stats.data;
  const activeMonths = s ? s.byMonth.filter((m) => m.hours > 0).length : 0;
  const maxClient = Math.max(0, ...(s?.byClient ?? []).map((c) => c.hours));
  const maxProject = Math.max(0, ...(s?.byProject ?? []).map((p) => p.hours));

  return (
    <>
      <PageHeader title="Statistika" description="Koliko je sati potrošeno – po mesecima, klijentima i projektima." />

      <Group mb="md" gap="sm" align="flex-end" wrap="wrap">
        <DatePickerInput
          type="range"
          label="Period"
          value={range}
          onChange={setRange}
          valueFormat="DD.MM.YYYY."
          presets={[
            ...periodPresets(),
            { label: 'Prošla godina', value: [`${Number(year) - 1}-01-01`, `${Number(year) - 1}-12-31`] },
          ]}
          w={260}
        />
        <ClientSelect label="Klijent" value={clientId} onChange={setClientId} clearable placeholder="Svi klijenti" w={240} includeArchived />
      </Group>

      {!s ? null : (
        <div style={{ opacity: stats.isFetching ? 0.6 : 1, transition: 'opacity 150ms' }}>
          <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} mb="lg">
            <StatCard label="Ukupno sati" value={`${formatHours(s.totalHours)} h`} hint={countEntries(s.totalEntries)} />
            <StatCard
              label="Prosečno mesečno"
              value={`${formatHours(activeMonths ? s.totalHours / activeMonths : 0)} h`}
              hint={`${count(activeMonths, 'mesec', 'meseca', 'meseci')} sa radom`}
            />
            <StatCard label="Vrednost rada" value={moneyList(s.value)} />
            <StatCard label="Fakturisano" value={moneyList(s.invoiced)} hint="fakture izdate u periodu (bez storniranih)" />
          </SimpleGrid>

          <Paper p="md" mb="lg">
            <Text fw={600} mb="xs">
              Sati po mesecima
            </Text>
            <HoursChart months={s.byMonth} clients={clientMap} />
          </Paper>

          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
            <Paper p={0}>
              <Text fw={600} p="md" pb="xs">
                Po klijentima
              </Text>
              {s.byClient.length === 0 ? (
                <EmptyState>Nema unosa u ovom periodu.</EmptyState>
              ) : (
                <Table verticalSpacing="xs" highlightOnHover>
                  <Table.Tbody>
                    {s.byClient.map((c) => (
                      <Table.Tr key={c.clientId} className="clickable-row" onClick={() => navigate(`/klijenti/${c.clientId}`)}>
                        <Table.Td>
                          <ClientBadge name={c.name} color={c.color} />
                        </Table.Td>
                        <Table.Td w="30%">
                          <Meter value={c.hours} max={maxClient} />
                        </Table.Td>
                        <Table.Td className="num">{formatHours(c.hours)} h</Table.Td>
                        <Table.Td className="num">{formatMoney(c.value, c.currency)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Paper>

            <Paper p={0}>
              <Text fw={600} p="md" pb="xs">
                Po projektima
              </Text>
              {s.byProject.length === 0 ? (
                <EmptyState>Nema unosa u ovom periodu.</EmptyState>
              ) : (
                <Table.ScrollContainer minWidth={480}>
                  <Table verticalSpacing="xs">
                    <Table.Tbody>
                      {s.byProject.map((p) => (
                        <Table.Tr key={`${p.clientId}-${p.project}`}>
                          <Table.Td>
                            <Text size="sm" fw={500}>
                              {projectLabel(p.project)}
                            </Text>
                            <Group gap={6}>
                              <ClientBadge name={p.clientName} color={p.color} />
                              <Text size="xs" c="dimmed">
                                {formatDateRange(p.firstDate, p.lastDate)}
                              </Text>
                            </Group>
                          </Table.Td>
                          <Table.Td w="25%">
                            <Meter value={p.hours} max={maxProject} />
                          </Table.Td>
                          <Table.Td className="num">{formatHours(p.hours)} h</Table.Td>
                          <Table.Td className="num">{formatMoney(p.value, p.currency)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Paper>
          </SimpleGrid>
        </div>
      )}
    </>
  );
}
