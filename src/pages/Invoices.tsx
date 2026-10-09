import { useState } from 'react';
import { ActionIcon, Badge, Button, Group, Menu, Paper, Select, SimpleGrid, Table, Text, Tooltip } from '@mantine/core';
import { IconCheck, IconDots, IconDownload, IconEye, IconFileInvoice, IconPlus, IconSend } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import type { Invoice, InvoiceStatus, MoneyByCurrency } from '../../shared/types.ts';
import { formatDate, formatMoney, today } from '../../shared/format.ts';
import { useInvoiceStatus, useInvoices } from '../api.ts';
import { ClientSelect, EmptyState, PageHeader, StatCard } from '../components/common.tsx';
import { downloadUrl, moneyList, STATUS_COLOR, STATUS_LABEL } from '../utils.ts';

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

export function InvoicesPage() {
  const navigate = useNavigate();
  const thisYear = Number(today().slice(0, 4));
  const [year, setYear] = useState<string | null>(String(thisYear));
  const [status, setStatus] = useState<string | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const invoices = useInvoices({ year: year ? Number(year) : null, status, clientId });
  const setInvoiceStatus = useInvoiceStatus();

  const list = invoices.data ?? [];
  const active = list.filter((i) => i.status !== 'cancelled');
  const unpaid = list.filter((i) => i.status === 'sent');
  const years = Array.from({ length: 6 }, (_, i) => String(thisYear - i));

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
        <StatCard label="Ukupno fakturisano" value={moneyList(sum(active))} hint={`${active.length} faktura`} />
        <StatCard label="Plaćeno" value={moneyList(sum(list.filter((i) => i.status === 'paid')))} />
        <StatCard label="Čeka uplatu" value={moneyList(sum(unpaid))} hint={`${unpaid.length} faktura`} />
      </SimpleGrid>

      <Paper p={0}>
        {list.length === 0 && !invoices.isLoading ? (
          <EmptyState>Nema faktura za izabrane filtere.</EmptyState>
        ) : (
          <Table.ScrollContainer minWidth={760}>
            <Table verticalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
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
                  <Table.Tr key={inv.id} className="clickable-row" onClick={() => navigate(`/fakture/${inv.id}`)}>
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
                          <ActionIcon variant="subtle" component="a" href={`/api/invoices/${inv.id}/pdf`} target="_blank" aria-label="PDF">
                            <IconEye size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Preuzmi PDF">
                          <ActionIcon variant="subtle" onClick={() => downloadUrl(`/api/invoices/${inv.id}/pdf?download=1`)} aria-label="Preuzmi">
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
    </>
  );
}
