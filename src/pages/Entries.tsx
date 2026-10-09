import { useMemo, useState } from 'react';
import { ActionIcon, Badge, Group, Modal, Paper, SimpleGrid, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { MonthPickerInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { IconEdit, IconSearch, IconTrash, IconRepeat, IconLock, IconCoinOff } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import type { Entry } from '../../shared/types.ts';
import { currentPeriod, formatDate, formatHours, formatMoney, monthRange } from '../../shared/format.ts';
import { useDeleteEntry, useEntries } from '../api.ts';
import { ClientBadge, ClientSelect, EmptyState, PageHeader, StatCard } from '../components/common.tsx';
import { EntryForm } from '../components/EntryForm.tsx';
import { moneyList, weekday } from '../utils.ts';

export function EntriesPage() {
  const [month, setMonth] = useState<string | null>(`${currentPeriod()}-01`);
  const [clientId, setClientId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Entry | null>(null);

  const range = month ? monthRange(month.slice(0, 7)) : null;
  const entries = useEntries({ clientId, from: range?.from, to: range?.to, search: search.trim() || undefined });
  const del = useDeleteEntry();

  const list = entries.data ?? [];
  const byDate = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of list) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return [...map];
  }, [list]);

  const totalHours = list.reduce((s, e) => s + e.hours, 0);
  const billableValue = sumByCurrency(list.filter((e) => e.billable));
  const unbilled = list.filter((e) => e.billable && !e.invoiceId);

  const confirmDelete = (e: Entry) =>
    modals.openConfirmModal({
      title: 'Brisanje stavke',
      children: (
        <Text size="sm">
          Obrisati unos od {formatDate(e.date)} ({formatHours(e.hours)} h) za {e.clientName}?
          {e.maintenanceId ? ' Automatski upisano održavanje se neće ponovo generisati za ovaj period.' : ''}
        </Text>
      ),
      labels: { confirm: 'Obriši', cancel: 'Otkaži' },
      confirmProps: { color: 'red' },
      onConfirm: () => del.mutate(e.id),
    });

  return (
    <>
      <PageHeader title="Unos sati" description="Evidentirajte rad po klijentima. Obavezna održavanja se upisuju automatski." />

      <Paper p="md" mb="lg">
        <Title order={5} mb="sm">
          Novi unos
        </Title>
        <EntryForm />
      </Paper>

      <Group mb="md" gap="sm" wrap="wrap">
        <MonthPickerInput
          value={month}
          onChange={setMonth}
          valueFormat="MMMM YYYY"
          placeholder="Svi meseci"
          clearable
          w={200}
          label="Mesec"
        />
        <ClientSelect value={clientId} onChange={setClientId} clearable placeholder="Svi klijenti" label="Klijent" w={240} includeArchived />
        <TextInput
          label="Pretraga"
          placeholder="Opis sadrži…"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={220}
        />
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 3 }} mb="md">
        <StatCard label="Ukupno sati" value={`${formatHours(totalHours)} h`} hint={`${list.length} unosa`} />
        <StatCard label="Vrednost (naplativo)" value={moneyList(billableValue)} />
        <StatCard
          label="Još nije fakturisano"
          value={moneyList(sumByCurrency(unbilled))}
          hint={`${formatHours(unbilled.reduce((s, e) => s + e.hours, 0))} h`}
        />
      </SimpleGrid>

      {entries.isLoading ? null : byDate.length === 0 ? (
        <Paper>
          <EmptyState>Nema unosa za izabrani period.</EmptyState>
        </Paper>
      ) : (
        <Stack gap="md">
          {byDate.map(([date, items]) => (
            <Paper key={date} p={0}>
              <Group justify="space-between" px="md" py="xs" bg="var(--mantine-color-default-hover)" style={{ borderTopLeftRadius: 8, borderTopRightRadius: 8 }}>
                <Text fw={600} size="sm">
                  {weekday(date)}, {formatDate(date)}
                </Text>
                <Text fw={600} size="sm" className="num">
                  {formatHours(items.reduce((s, e) => s + e.hours, 0))} h
                </Text>
              </Group>
              <Table verticalSpacing="xs" highlightOnHover>
                <Table.Tbody>
                  {items.map((e) => (
                    <Table.Tr key={e.id}>
                      <Table.Td w={200}>
                        <ClientBadge name={e.clientName} color={e.clientColor} />
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                          {e.description || <Text span c="dimmed">bez opisa</Text>}
                        </Text>
                        <Group gap={6} mt={4}>
                          {e.maintenanceId && (
                            <Badge size="xs" variant="light" color="violet" leftSection={<IconRepeat size={10} />}>
                              održavanje
                            </Badge>
                          )}
                          {e.fixedAmount !== null && (
                            <Badge size="xs" variant="light" color="gray">
                              paušal
                            </Badge>
                          )}
                          {!e.billable && (
                            <Badge size="xs" variant="light" color="orange" leftSection={<IconCoinOff size={10} />}>
                              nenaplativo
                            </Badge>
                          )}
                          {e.invoiceId && (
                            <Badge
                              size="xs"
                              variant="light"
                              color="teal"
                              leftSection={<IconLock size={10} />}
                              component={Link}
                              to={`/fakture/${e.invoiceId}`}
                              style={{ cursor: 'pointer' }}
                            >
                              faktura {e.invoiceNumber}
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td w={80} className="num">
                        <Text size="sm" fw={600}>
                          {e.hours ? `${formatHours(e.hours)} h` : '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td w={140} className="num">
                        <Text size="sm" c={e.billable ? undefined : 'dimmed'}>
                          {formatMoney(e.value ?? 0, e.currency ?? '')}
                        </Text>
                      </Table.Td>
                      <Table.Td w={80}>
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                          <Tooltip label={e.invoiceId ? 'Stavka je na fakturi' : 'Izmeni'}>
                            <ActionIcon variant="subtle" disabled={!!e.invoiceId} onClick={() => setEditing(e)} aria-label="Izmeni">
                              <IconEdit size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label={e.invoiceId ? 'Stavka je na fakturi' : 'Obriši'}>
                            <ActionIcon variant="subtle" color="red" disabled={!!e.invoiceId} onClick={() => confirmDelete(e)} aria-label="Obriši">
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          ))}
        </Stack>
      )}

      <Modal opened={!!editing} onClose={() => setEditing(null)} title="Izmena unosa" size="lg">
        {editing && <EntryForm key={editing.id} entry={editing} compact onSaved={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

function sumByCurrency(entries: Entry[]) {
  const map = new Map<string, number>();
  for (const e of entries) map.set(e.currency ?? '', (map.get(e.currency ?? '') ?? 0) + (e.value ?? 0));
  return [...map].map(([currency, amount]) => ({ currency: currency as Entry['currency'] & string, amount }));
}
