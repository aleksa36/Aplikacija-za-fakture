import { useState } from 'react';
import {
  Anchor,
  Badge,
  Button,
  Grid,
  Group,
  Menu,
  Modal,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconArchive,
  IconArchiveOff,
  IconArrowLeft,
  IconDots,
  IconEdit,
  IconFileInvoice,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { addMonths, currentPeriod, formatDate, formatDateRange, formatHours, formatMoney, monthRange, today } from '../../shared/format.ts';
import { useClient, useDeleteClient, useEntries, useInvoices, useSaveClient, useStats } from '../api.ts';
import { ClientDot, EmptyState, PageHeader, StatCard } from '../components/common.tsx';
import { HoursChart, Meter } from '../components/HoursChart.tsx';
import { TodoList } from '../components/TodoList.tsx';
import { countEntries, moneyList, projectLabel } from '../utils.ts';
import { ClientForm } from './Clients.tsx';
import { StatusBadge } from './Invoices.tsx';

type Range = '12m' | 'year' | 'lastYear';

function rangeDates(r: Range): { from: string; to: string } {
  const year = Number(today().slice(0, 4));
  if (r === 'year') return { from: `${year}-01-01`, to: `${year}-12-31` };
  if (r === 'lastYear') return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  const cur = currentPeriod();
  return { from: `${addMonths(cur, -11)}-01`, to: monthRange(cur).to };
}

export function ClientDetailPage() {
  const clientId = Number(useParams().id);
  const navigate = useNavigate();
  const client = useClient(clientId);
  const save = useSaveClient();
  const del = useDeleteClient();
  const [editing, setEditing] = useState(false);
  const [range, setRange] = useState<Range>('12m');
  const { from, to } = rangeDates(range);
  const stats = useStats({ from, to, clientId });
  const unbilled = useEntries({ clientId, unbilled: true, to: today() });
  const invoices = useInvoices({ clientId });

  if (client.isError) return <EmptyState>Klijent ne postoji.</EmptyState>;
  const c = client.data;
  if (!c) return null;

  const unbilledList = unbilled.data ?? [];
  const unbilledValue = unbilledList.reduce((s, e) => s + (e.value ?? 0), 0);
  const projects = stats.data?.byProject ?? [];
  const maxProjectHours = Math.max(0, ...projects.map((p) => p.hours));

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: 'Brisanje klijenta',
      children: (
        <Text size="sm">
          Obrisati klijenta <b>{c.name}</b> zajedno sa svim unosima i zadacima? Klijent koji ima fakture ne može se obrisati
          dok se fakture ne obrišu – tada ga možete arhivirati.
        </Text>
      ),
      labels: { confirm: 'Obriši', cancel: 'Otkaži' },
      confirmProps: { color: 'red' },
      onConfirm: () => del.mutate(c.id, { onSuccess: () => navigate('/klijenti') }),
    });

  return (
    <>
      <Anchor component={Link} to="/klijenti" size="sm" mb="xs" display="inline-flex" style={{ alignItems: 'center', gap: 4 }}>
        <IconArrowLeft size={14} /> Svi klijenti
      </Anchor>
      <PageHeader
        title={c.name}
        description={
          <Group gap="xs" component="span">
            <ClientDot color={c.color} />
            <span>
              {[c.city, `${formatMoney(c.hourlyRate, c.currency)}/h`].filter(Boolean).join(' · ')}
              {c.maintenanceAmount > 0 && ` · održavanje ${formatMoney(c.maintenanceAmount, c.currency)}/mes.`}
            </span>
            {c.archived && <Badge color="gray">arhiviran</Badge>}
          </Group>
        }
        actions={
          <>
            <Button leftSection={<IconPlus size={16} />} onClick={() => navigate(`/sati?clientId=${c.id}`)}>
              Unesi
            </Button>
            <Button variant="default" leftSection={<IconFileInvoice size={16} />} onClick={() => navigate(`/fakture/nova?clientId=${c.id}`)}>
              Nova faktura
            </Button>
            <Button variant="default" leftSection={<IconEdit size={16} />} onClick={() => setEditing(true)}>
              Izmeni
            </Button>
            <Menu position="bottom-end">
              <Menu.Target>
                <Button variant="default" px="xs" aria-label="Još">
                  <IconDots size={16} />
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={c.archived ? <IconArchiveOff size={14} /> : <IconArchive size={14} />}
                  onClick={() => save.mutate({ id: c.id, data: { ...c, archived: !c.archived } })}
                >
                  {c.archived ? 'Vrati iz arhive' : 'Arhiviraj'}
                </Menu.Item>
                <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={confirmDelete}>
                  Obriši klijenta
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </>
        }
      />

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Stack gap="lg">
            <Paper p="md">
              <Title order={5} mb="sm">
                Zadaci
              </Title>
              <TodoList clientId={c.id} />
            </Paper>
            <Paper p="md">
              <Title order={5} mb="sm">
                Podaci
              </Title>
              <Stack gap={4}>
                {[
                  ['Adresa', [c.address, [c.zip, c.city].filter(Boolean).join(' '), c.country].filter(Boolean).join(', ')],
                  ['PIB', c.pib],
                  ['Matični broj', c.mb],
                  ['Kontakt', c.contactPerson],
                  ['Email', c.email],
                  ['Telefon', c.phone],
                  ['Rok plaćanja', `${c.paymentDays} dana`],
                  ['Jezik fakture', c.language === 'en' ? 'engleski' : 'srpski'],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <Group key={k} gap="xs" wrap="nowrap" align="flex-start">
                      <Text size="sm" c="dimmed" w={110} style={{ flexShrink: 0 }}>
                        {k}
                      </Text>
                      <Text size="sm">{v}</Text>
                    </Group>
                  ))}
                {c.notes && (
                  <Text size="sm" mt="xs" style={{ whiteSpace: 'pre-wrap' }}>
                    {c.notes}
                  </Text>
                )}
              </Stack>
            </Paper>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack gap="lg">
            <Group justify="space-between">
              <Title order={5}>Statistika</Title>
              <SegmentedControl
                size="xs"
                value={range}
                onChange={(v) => setRange(v as Range)}
                data={[
                  { value: '12m', label: '12 meseci' },
                  { value: 'year', label: 'Ova godina' },
                  { value: 'lastYear', label: 'Prošla godina' },
                ]}
              />
            </Group>
            <SimpleGrid cols={{ base: 1, xs: 3 }}>
              <StatCard label="Sati" value={`${formatHours(stats.data?.totalHours ?? 0)} h`} hint={countEntries(stats.data?.totalEntries ?? 0)} />
              <StatCard label="Vrednost rada" value={moneyList(stats.data?.value ?? [])} />
              <StatCard label="Nefakturisano" value={formatMoney(unbilledValue, c.currency)} hint={countEntries(unbilledList.length)} />
            </SimpleGrid>

            <Paper p="md" style={{ opacity: stats.isFetching ? 0.6 : 1 }}>
              <Text fw={600} mb="xs">
                Sati po mesecima
              </Text>
              {stats.data && <HoursChart months={stats.data.byMonth} clients={new Map([[c.id, { name: c.name, color: c.color }]])} />}
            </Paper>

            <Paper p={0}>
              <Text fw={600} p="md" pb="xs">
                Projekti
              </Text>
              {projects.length === 0 ? (
                <EmptyState>Nema unosa u ovom periodu.</EmptyState>
              ) : (
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Projekat</Table.Th>
                      <Table.Th w="30%" />
                      <Table.Th className="num">Sati</Table.Th>
                      <Table.Th className="num">Vrednost</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {projects.map((p) => (
                      <Table.Tr key={p.project}>
                        <Table.Td>
                          <Text size="sm" fw={500}>
                            {projectLabel(p.project)}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {formatDateRange(p.firstDate, p.lastDate)} · {countEntries(p.entries)}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Meter value={p.hours} max={maxProjectHours} />
                        </Table.Td>
                        <Table.Td className="num">{formatHours(p.hours)} h</Table.Td>
                        <Table.Td className="num">{formatMoney(p.value, p.currency)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Paper>

            <Paper p={0}>
              <Group justify="space-between" p="md" pb="xs">
                <Text fw={600}>Fakture</Text>
                <Anchor component={Link} to="/fakture" size="sm">
                  Sve fakture
                </Anchor>
              </Group>
              {(invoices.data ?? []).length === 0 ? (
                <EmptyState>Nema faktura.</EmptyState>
              ) : (
                <Table verticalSpacing="xs" highlightOnHover>
                  <Table.Tbody>
                    {(invoices.data ?? []).slice(0, 8).map((inv) => (
                      <Table.Tr key={inv.id} className="clickable-row" onClick={() => navigate(`/fakture/${inv.id}`)}>
                        <Table.Td fw={600}>{inv.number}</Table.Td>
                        <Table.Td>{formatDate(inv.issueDate)}</Table.Td>
                        <Table.Td className="num">{formatMoney(inv.total, inv.currency)}</Table.Td>
                        <Table.Td w={110}>
                          <StatusBadge invoice={inv} />
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Paper>
          </Stack>
        </Grid.Col>
      </Grid>

      <Modal opened={editing} onClose={() => setEditing(false)} title="Izmena klijenta" size="xl">
        {editing && <ClientForm client={c} onSaved={() => setEditing(false)} />}
      </Modal>
    </>
  );
}
