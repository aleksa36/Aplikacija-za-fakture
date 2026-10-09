import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Affix,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
  Transition,
} from '@mantine/core';
import { MonthPickerInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { IconEdit, IconSearch, IconTrash, IconRepeat, IconLock, IconFolder } from '@tabler/icons-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Currency, Entry } from '../../shared/types.ts';
import { currentPeriod, formatDate, formatDateRange, formatHours, formatMoney, monthRange } from '../../shared/format.ts';
import { notifyOk, useDeleteEntries, useEntries } from '../api.ts';
import { ClientBadge, ClientSelect, EmptyState, PageHeader, StatCard } from '../components/common.tsx';
import { EntryForm } from '../components/EntryForm.tsx';
import { countEntries, moneyList, weekday } from '../utils.ts';

function sumByCurrency(entries: Entry[]) {
  const map = new Map<Currency, number>();
  for (const e of entries) map.set(e.currency ?? 'RSD', (map.get(e.currency ?? 'RSD') ?? 0) + (e.value ?? 0));
  return [...map].map(([currency, amount]) => ({ currency, amount }));
}

/** Potvrda brisanja unosa; upozorava ako su neki već na fakturi. */
export function confirmDeleteEntries(entries: Entry[], onConfirm: () => void) {
  const invoiced = entries.filter((e) => e.invoiceId);
  modals.openConfirmModal({
    title: entries.length === 1 ? 'Brisanje unosa' : `Brisanje ${entries.length} unosa`,
    children: (
      <Stack gap="xs">
        <Text size="sm">
          {entries.length === 1
            ? `Obrisati unos od ${formatDate(entries[0].date)}${entries[0].description ? ` („${entries[0].description}”)` : ''}?`
            : `Obrisati izabranih ${entries.length} unosa?`}
        </Text>
        {invoiced.length > 0 && (
          <Text size="sm" c="orange">
            {invoiced.length === 1 ? 'Jedan unos je' : `${invoiced.length} unosa je`} već na fakturi
            ({[...new Set(invoiced.map((e) => e.invoiceNumber))].join(', ')}). Faktura ostaje nepromenjena.
          </Text>
        )}
      </Stack>
    ),
    labels: { confirm: 'Obriši', cancel: 'Otkaži' },
    confirmProps: { color: 'red' },
    onConfirm,
  });
}

export function EntryBadges({ e }: { e: Entry }) {
  return (
    <Group gap={6} mt={4}>
      {e.project && (
        <Badge size="xs" variant="light" color="gray" leftSection={<IconFolder size={10} />} tt="none">
          {e.project}
        </Badge>
      )}
      {e.kind === 'maintenance' && (
        <Badge size="xs" variant="light" color="violet" leftSection={<IconRepeat size={10} />} tt="none">
          održavanje
        </Badge>
      )}
      {e.kind === 'manual' && e.fixedAmount !== null && (
        <Badge size="xs" variant="light" color="gray" tt="none">
          paušal
        </Badge>
      )}
      {e.invoiceId && (
        <Badge
          size="xs"
          variant="light"
          color="teal"
          tt="none"
          leftSection={<IconLock size={10} />}
          component={Link}
          to={`/fakture/${e.invoiceId}`}
          style={{ cursor: 'pointer' }}
        >
          faktura {e.invoiceNumber}
        </Badge>
      )}
    </Group>
  );
}

export function EntriesPage() {
  const [params] = useSearchParams();
  const urlClient = Number(params.get('clientId')) || null;
  const [month, setMonth] = useState<string | null>(`${currentPeriod()}-01`);
  const [clientId, setClientId] = useState<number | null>(urlClient);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Entry | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const range = month ? monthRange(month.slice(0, 7)) : null;
  const entries = useEntries({ clientId, from: range?.from, to: range?.to, search: search.trim() || undefined });
  const del = useDeleteEntries();

  const list = useMemo(() => entries.data ?? [], [entries.data]);
  const byDate = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of list) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return [...map];
  }, [list]);

  const visibleSelected = list.filter((e) => selected.has(e.id));
  const totalHours = list.reduce((s, e) => s + e.hours, 0);
  const unbilled = list.filter((e) => !e.invoiceId);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const remove = (items: Entry[]) =>
    confirmDeleteEntries(items, () =>
      del.mutate(
        items.map((e) => e.id),
        {
          onSuccess: () => {
            notifyOk(items.length === 1 ? 'Unos je obrisan.' : `Obrisano unosa: ${items.length}.`);
            setSelected(new Set());
          },
        },
      ),
    );

  return (
    <>
      <PageHeader title="Unos" description="Ručni unos (sati ili paušal, za jedan dan ili period) i mesečno održavanje." />

      <Paper p="md" mb="lg">
        <Title order={5} mb="sm">
          Novi unos
        </Title>
        <EntryForm defaultClientId={urlClient} />
      </Paper>

      <Group mb="md" gap="sm" wrap="wrap" align="flex-end">
        <MonthPickerInput value={month} onChange={setMonth} valueFormat="MMMM YYYY" placeholder="Svi meseci" clearable w={200} label="Mesec" />
        <ClientSelect value={clientId} onChange={setClientId} clearable placeholder="Svi klijenti" label="Klijent" w={240} includeArchived />
        <TextInput
          label="Pretraga"
          placeholder="Opis ili projekat…"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={220}
        />
        {list.length > 0 && (
          <Checkbox
            mb={8}
            label="Izaberi sve"
            checked={visibleSelected.length === list.length}
            indeterminate={visibleSelected.length > 0 && visibleSelected.length < list.length}
            onChange={(e) => setSelected(e.currentTarget.checked ? new Set(list.map((x) => x.id)) : new Set())}
          />
        )}
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 3 }} mb="md">
        <StatCard label="Ukupno sati" value={`${formatHours(totalHours)} h`} hint={countEntries(list.length)} />
        <StatCard label="Vrednost" value={moneyList(sumByCurrency(list))} />
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
              <Group
                justify="space-between"
                px="md"
                py="xs"
                bg="var(--mantine-color-default-hover)"
                style={{ borderTopLeftRadius: 8, borderTopRightRadius: 8 }}
              >
                <Text fw={600} size="sm">
                  {weekday(date)}, {formatDate(date)}
                </Text>
                <Text fw={600} size="sm" className="num">
                  {formatHours(items.reduce((s, e) => s + e.hours, 0))} h
                </Text>
              </Group>
              <Table.ScrollContainer minWidth={620}>
                <Table verticalSpacing="xs" highlightOnHover>
                  <Table.Tbody>
                    {items.map((e) => (
                      <Table.Tr key={e.id} bg={selected.has(e.id) ? 'var(--mantine-primary-color-light)' : undefined}>
                        <Table.Td w={36}>
                          <Checkbox checked={selected.has(e.id)} onChange={() => toggle(e.id)} aria-label="Izaberi" />
                        </Table.Td>
                        <Table.Td w={190}>
                          <ClientBadge name={e.clientName} color={e.clientColor} />
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                            {e.description || (
                              <Text span c="dimmed">
                                bez opisa
                              </Text>
                            )}
                          </Text>
                          {e.dateTo && (
                            <Text size="xs" c="dimmed">
                              {formatDateRange(e.date, e.dateTo)}
                            </Text>
                          )}
                          <EntryBadges e={e} />
                        </Table.Td>
                        <Table.Td w={80} className="num">
                          <Text size="sm" fw={600}>
                            {e.hours ? `${formatHours(e.hours)} h` : '—'}
                          </Text>
                        </Table.Td>
                        <Table.Td w={140} className="num">
                          <Text size="sm">{formatMoney(e.value ?? 0, e.currency ?? '')}</Text>
                        </Table.Td>
                        <Table.Td w={80}>
                          <Group gap={4} justify="flex-end" wrap="nowrap">
                            <Tooltip label={e.invoiceId ? 'Unos je na fakturi – ne može se menjati' : 'Izmeni'}>
                              <ActionIcon variant="subtle" disabled={!!e.invoiceId} onClick={() => setEditing(e)} aria-label="Izmeni">
                                <IconEdit size={16} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Obriši">
                              <ActionIcon variant="subtle" color="red" onClick={() => remove([e])} aria-label="Obriši">
                                <IconTrash size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          ))}
        </Stack>
      )}

      <SelectionBar
        count={visibleSelected.length}
        onClear={() => setSelected(new Set())}
        onDelete={() => remove(visibleSelected)}
        loading={del.isPending}
      />

      <Modal opened={!!editing} onClose={() => setEditing(null)} title="Izmena unosa" size="lg">
        {editing && <EntryForm key={editing.id} entry={editing} compact onSaved={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

/** Traka na dnu ekrana kad je nešto izabrano. */
export function SelectionBar({
  count,
  onClear,
  onDelete,
  loading,
  label = 'Obriši izabrano',
}: {
  count: number;
  onClear: () => void;
  onDelete: () => void;
  loading?: boolean;
  label?: string;
}) {
  return (
    <Affix position={{ bottom: 20, left: '50%' }} style={{ transform: 'translateX(-50%)' }}>
      <Transition transition="slide-up" mounted={count > 0}>
        {(styles) => (
          <Paper style={styles} shadow="lg" p="sm" px="md" withBorder>
            <Group gap="md" wrap="nowrap">
              <Text size="sm" fw={600}>
                Izabrano: {count}
              </Text>
              <Button size="xs" variant="default" onClick={onClear}>
                Poništi izbor
              </Button>
              <Button size="xs" color="red" leftSection={<IconTrash size={14} />} onClick={onDelete} loading={loading}>
                {label}
              </Button>
            </Group>
          </Paper>
        )}
      </Transition>
    </Affix>
  );
}
