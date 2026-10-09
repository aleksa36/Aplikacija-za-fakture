import { useState } from 'react';
import { ActionIcon, Badge, Button, Checkbox, Group, Menu, Paper, Select, SimpleGrid, Stack, Table, Text, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconCheck, IconDots, IconDownload, IconEye, IconFileInvoice, IconPlus, IconSend, IconTrash } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import type { Invoice, InvoiceStatus, MoneyByCurrency } from '../../shared/types.ts';
import { formatDate, formatMoney, today } from '../../shared/format.ts';
import { notifyError, useDeleteInvoices, useInvoiceStatus, useInvoices } from '../api.ts';
import { SelectionBar } from './Entries.tsx';
import { downloadInvoicePdf, openInvoicePdf } from '../pdf/index.ts';
import { ClientSelect, EmptyState, PageHeader, StatCard } from '../components/common.tsx';
import { count, moneyList, STATUS_COLOR, STATUS_LABEL } from '../utils.ts';

function sum(list: Invoice[]): MoneyByCurrency[] {
  const map = new Map<Invoice['currency'], number>();
  for (const i of list) map.set(i.currency, (map.get(i.currency) ?? 0) + i.total);
  return [...map].map(([currency, amount]) => ({ currency, amount }));
}

export function StatusBadge({ invoice }: { invoice: Pick<Invoice, 'status' | 'dueDate'> }) {
  const overdue = invoice.status === 'sent' && invoice.dueDate < today();
  return (
    <Badge color={overdue ? 'red' : STATUS_COLOR[invoice.status]} variant={overdue ? 'filled' : 'light'}>
      {overdue ? 'Kasni' : STATUS_LABEL[invoice.status]}
    </Badge>
  );
}

/** Dijalog za brisanje faktura: uz fakture se brišu i unosi ili se vraćaju u nefakturisane. */
export function openDeleteInvoices(list: Pick<Invoice, 'number'>[], run: (entries: 'delete' | 'release') => void) {
  const id = modals.open({
    title: list.length === 1 ? `Brisanje fakture ${list[0].number}` : `Brisanje ${list.length} faktura`,
    children: (
      <Stack gap="sm">
        <Text size="sm">Šta da se uradi sa unosima (sati, održavanja) koji su na {list.length === 1 ? 'ovoj fakturi' : 'ovim fakturama'}?</Text>
        <Button
          color="red"
          leftSection={<IconTrash size={16} />}
          onClick={() => {
            modals.close(id);
            run('delete');
          }}
        >
          Obriši {list.length === 1 ? 'fakturu' : 'fakture'} i unose
        </Button>
        <Text size="xs" c="dimmed" mt={-6}>
          Za čišćenje starih, već naplaćenih faktura.
        </Text>
        <Button
          variant="default"
          onClick={() => {
            modals.close(id);
            run('release');
          }}
        >
          Obriši samo {list.length === 1 ? 'fakturu' : 'fakture'}
        </Button>
        <Text size="xs" c="dimmed" mt={-6}>
          Unosi se vraćaju u nefakturisane (npr. ako fakturu pravite ponovo).
        </Text>
        <Button variant="subtle" color="gray" onClick={() => modals.close(id)}>
          Otkaži
        </Button>
      </Stack>
    ),
  });
}

export function InvoicesPage() {
  const navigate = useNavigate();
  const thisYear = Number(today().slice(0, 4));
  const [year, setYear] = useState<string | null>(String(thisYear));
  const [status, setStatus] = useState<string | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const invoices = useInvoices({ year: year ? Number(year) : null, status, clientId });
  const setInvoiceStatus = useInvoiceStatus();
  const del = useDeleteInvoices();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggle = (invId: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(invId)) next.delete(invId);
      else next.add(invId);
      return next;
    });
  const remove = (items: Invoice[]) =>
    openDeleteInvoices(items, (entries) =>
      del.mutate({ ids: items.map((i) => i.id), entries }, { onSuccess: () => setSelected(new Set()) }),
    );

  const list = invoices.data ?? [];
  const active = list.filter((i) => i.status !== 'cancelled');
  const unpaid = list.filter((i) => i.status === 'sent');
  const years = Array.from({ length: 6 }, (_, i) => String(thisYear - i));
  const chosen = list.filter((i) => selected.has(i.id));

  return (
    <>
      <PageHeader
        title="Fakture"
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => navigate('/fakture/nova')}>
            Nova faktura
          </Button>
        }
      />

      <Group mb="md" gap="sm" wrap="wrap">
        <Select label="Godina" data={years} value={year} onChange={setYear} clearable placeholder="Sve" w={120} />
        <Select
          label="Status"
          data={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
          value={status}
          onChange={setStatus}
          clearable
          placeholder="Svi"
          w={160}
        />
        <ClientSelect label="Klijent" value={clientId} onChange={setClientId} clearable placeholder="Svi klijenti" w={240} includeArchived />
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 3 }} mb="md">
        <StatCard label="Ukupno fakturisano" value={moneyList(sum(active))} hint={count(active.length, 'faktura', 'fakture', 'faktura')} />
        <StatCard label="Plaćeno" value={moneyList(sum(list.filter((i) => i.status === 'paid')))} />
        <StatCard label="Čeka uplatu" value={moneyList(sum(unpaid))} hint={count(unpaid.length, 'faktura', 'fakture', 'faktura')} />
      </SimpleGrid>

      <Paper p={0}>
        {list.length === 0 && !invoices.isLoading ? (
          <EmptyState>Nema faktura za izabrane filtere.</EmptyState>
        ) : (
          <Table.ScrollContainer minWidth={760}>
            <Table verticalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={36}>
                    <Checkbox
                      aria-label="Izaberi sve"
                      checked={list.length > 0 && chosen.length === list.length}
                      indeterminate={chosen.length > 0 && chosen.length < list.length}
                      onChange={(e) => setSelected(e.currentTarget.checked ? new Set(list.map((i) => i.id)) : new Set())}
                    />
                  </Table.Th>
                  <Table.Th>Broj</Table.Th>
                  <Table.Th>Klijent</Table.Th>
                  <Table.Th>Datum</Table.Th>
                  <Table.Th>Rok</Table.Th>
                  <Table.Th className="num">Iznos</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {list.map((inv) => (
                  <Table.Tr
                    key={inv.id}
                    className="clickable-row"
                    onClick={() => navigate(`/fakture/${inv.id}`)}
                    bg={selected.has(inv.id) ? 'var(--mantine-primary-color-light)' : undefined}
                  >
                    <Table.Td onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(inv.id)} onChange={() => toggle(inv.id)} aria-label="Izaberi" />
                    </Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <IconFileInvoice size={16} opacity={0.6} />
                        <Text fw={600} size="sm">
                          {inv.number}
                        </Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{inv.client.name}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatDate(inv.issueDate)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c={inv.status === 'sent' && inv.dueDate < today() ? 'red' : undefined}>
                        {formatDate(inv.dueDate)}
                      </Text>
                    </Table.Td>
                    <Table.Td className="num">
                      <Text size="sm" fw={600} td={inv.status === 'cancelled' ? 'line-through' : undefined}>
                        {formatMoney(inv.total, inv.currency)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge invoice={inv} />
                    </Table.Td>
                    <Table.Td onClick={(e) => e.stopPropagation()} w={110}>
                      <Group gap={4} wrap="nowrap" justify="flex-end">
                        <Tooltip label="Otvori PDF">
                          <ActionIcon variant="subtle" onClick={() => openInvoicePdf(inv.id).catch(notifyError)} aria-label="PDF">
                            <IconEye size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Preuzmi PDF">
                          <ActionIcon variant="subtle" onClick={() => downloadInvoicePdf(inv.id).catch(notifyError)} aria-label="Preuzmi">
                            <IconDownload size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target>
                            <ActionIcon variant="subtle" aria-label="Status">
                              <IconDots size={16} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            {inv.status === 'draft' && (
                              <Menu.Item leftSection={<IconSend size={14} />} onClick={() => setInvoiceStatus.mutate({ id: inv.id, status: 'sent' })}>
                                Označi kao poslatu
                              </Menu.Item>
                            )}
                            {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                              <Menu.Item
                                color="teal"
                                leftSection={<IconCheck size={14} />}
                                onClick={() => setInvoiceStatus.mutate({ id: inv.id, status: 'paid' as InvoiceStatus })}
                              >
                                Označi kao plaćenu
                              </Menu.Item>
                            )}
                            <Menu.Item onClick={() => navigate(`/fakture/${inv.id}`)}>Otvori detalje</Menu.Item>
                            <Menu.Divider />
                            <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => remove([inv])}>
                              Obriši
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Paper>

      <SelectionBar count={chosen.length} onClear={() => setSelected(new Set())} onDelete={() => remove(chosen)} loading={del.isPending} />
    </>
  );
}
