import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Grid,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput, DatePickerInput } from '@mantine/dates';
import { useQuery } from '@tanstack/react-query';
import { IconInfoCircle, IconRepeat } from '@tabler/icons-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, currentPeriod, formatDate, formatHours, formatMoney, monthRange, today } from '../../shared/format.ts';
import { qs, request, useClients, useCreateInvoice, useEntries, useSettings } from '../api.ts';
import { ClientSelect, EmptyState, PageHeader } from '../components/common.tsx';
import { periodPresets } from '../utils.ts';

interface Draft {
  number: string;
  place: string;
  dueDate: string;
  notes: string;
}

export function InvoiceNewPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const clients = useClients();
  const settings = useSettings();
  const create = useCreateInvoice();

  const month = monthRange(currentPeriod());
  const [clientId, setClientId] = useState<number | null>(params.get('clientId') ? Number(params.get('clientId')) : null);
  const [range, setRange] = useState<[string | null, string | null]>([params.get('from') ?? month.from, params.get('to') ?? month.to]);
  const [allUnbilled, setAllUnbilled] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [grouping, setGrouping] = useState<'grouped' | 'detailed'>('grouped');
  const [includeReport, setIncludeReport] = useState(true);

  const [issueDate, setIssueDate] = useState<string | null>(today());
  const [serviceDate, setServiceDate] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [number, setNumber] = useState('');
  const [place, setPlace] = useState('');
  const [notes, setNotes] = useState('');

  const client = clients.data?.find((c) => c.id === clientId);
  const [from, to] = range;
  const entries = useEntries(
    { clientId, from: allUnbilled ? null : from, to: allUnbilled ? today() : to, unbilled: true },
    !!clientId && (allUnbilled || (!!from && !!to)),
  );
  const list = useMemo(() => [...(entries.data ?? [])].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id), [entries.data]);
  // Sve nefakturisane stavke klijenta – da upozorimo ako neke ostaju van izabranog perioda.
  const allOpen = useEntries({ clientId, to: today(), unbilled: true }, !!clientId && !allUnbilled);
  const outside = allUnbilled ? 0 : Math.max(0, (allOpen.data?.length ?? 0) - list.length);

  // Podrazumevano su sve stavke izabrane.
  useEffect(() => {
    setSelected(new Set(list.map((e) => e.id)));
  }, [list]);

  const draft = useQuery({
    queryKey: ['invoice-draft', clientId, issueDate],
    queryFn: () => request<Draft>(`/invoices/draft${qs({ clientId, issueDate })}`),
    enabled: !!issueDate,
  });
  useEffect(() => {
    const d = draft.data;
    if (!d) return;
    setNumber(d.number);
    setPlace((p) => p || d.place);
    setDueDate(d.dueDate);
    setNotes(d.notes);
  }, [draft.data]);

  // Datum prometa: kraj perioda (ako je već prošao), inače datum izdavanja.
  useEffect(() => {
    if (!issueDate) return;
    setServiceDate(!allUnbilled && to && to < issueDate ? to : issueDate);
  }, [to, issueDate, allUnbilled]);

  const chosen = list.filter((e) => selected.has(e.id));
  const totalHours = chosen.reduce((s, e) => s + e.hours, 0);
  const subtotal = chosen.reduce((s, e) => s + (e.value ?? 0), 0);
  const vatRate = settings.data?.vatPayer && client && !client.vatExempt ? settings.data.vatRate : 0;
  const total = subtotal * (1 + vatRate / 100);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const periodFrom = allUnbilled ? (chosen[0]?.date ?? null) : from;
  const periodTo = allUnbilled ? (chosen[chosen.length - 1]?.date ?? null) : to;

  const submit = () => {
    if (!clientId || !issueDate || !serviceDate || !dueDate) return;
    create.mutate(
      {
        clientId,
        number,
        issueDate,
        serviceDate,
        dueDate,
        place,
        periodFrom,
        periodTo,
        entryIds: chosen.map((e) => e.id),
        grouping,
        includeReport,
        notes,
      },
      { onSuccess: (inv) => navigate(`/fakture/${inv.id}`) },
    );
  };

  return (
    <>
      <PageHeader title="Nova faktura" description="Izaberite klijenta i period – nefakturisani sati i održavanja se automatski povlače." />

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Paper p="md" mb="md">
            <Title order={5} mb="sm">
              1. Klijent i period
            </Title>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <ClientSelect label="Klijent" required value={clientId} onChange={setClientId} />
              <DatePickerInput
                type="range"
                label="Period rada"
                value={range}
                onChange={setRange}
                valueFormat="DD.MM.YYYY."
                presets={periodPresets()}
                disabled={allUnbilled}
              />
            </SimpleGrid>
            <Switch
              mt="sm"
              label="Prikaži sve nefakturisane stavke (bez obzira na period)"
              checked={allUnbilled}
              onChange={(e) => setAllUnbilled(e.currentTarget.checked)}
            />
            {outside > 0 && (
              <Alert color="yellow" variant="light" icon={<IconInfoCircle />} mt="sm" p="xs">
                Klijent ima još {outside} nefakturisan{outside === 1 ? 'u stavku' : 'e stavke'} van izabranog perioda.{' '}
                <Anchor component="button" size="sm" onClick={() => setAllUnbilled(true)}>
                  Prikaži sve
                </Anchor>
              </Alert>
            )}
          </Paper>

          <Paper p={0} mb="md">
            <Group justify="space-between" p="md" pb="xs">
              <Title order={5}>2. Stavke za fakturisanje</Title>
              {list.length > 0 && (
                <Checkbox
                  label="Sve"
                  checked={selected.size === list.length}
                  indeterminate={selected.size > 0 && selected.size < list.length}
                  onChange={(e) => setSelected(e.currentTarget.checked ? new Set(list.map((x) => x.id)) : new Set())}
                />
              )}
            </Group>
            {!clientId ? (
              <EmptyState>Izaberite klijenta.</EmptyState>
            ) : list.length === 0 && !entries.isLoading ? (
              <EmptyState>Nema nefakturisanih stavki u ovom periodu. Možete napraviti fakturu i ručno dodati stavke.</EmptyState>
            ) : (
              <Table.ScrollContainer minWidth={520}>
                <Table verticalSpacing="xs" highlightOnHover>
                  <Table.Tbody>
                    {list.map((e) => (
                      <Table.Tr key={e.id} className="clickable-row" onClick={() => toggle(e.id)}>
                        <Table.Td w={36}>
                          <Checkbox checked={selected.has(e.id)} onChange={() => toggle(e.id)} onClick={(ev) => ev.stopPropagation()} />
                        </Table.Td>
                        <Table.Td w={100}>
                          <Text size="sm">{formatDate(e.date)}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{e.description || '—'}</Text>
                          {e.maintenanceId && (
                            <Badge size="xs" variant="light" color="violet" leftSection={<IconRepeat size={10} />}>
                              održavanje
                            </Badge>
                          )}
                        </Table.Td>
                        <Table.Td className="num" w={70}>
                          <Text size="sm">{e.hours ? `${formatHours(e.hours)} h` : '—'}</Text>
                        </Table.Td>
                        <Table.Td className="num" w={130}>
                          <Text size="sm" fw={600}>
                            {formatMoney(e.value ?? 0, e.currency ?? '')}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Paper>

          <Paper p="md">
            <Title order={5} mb="sm">
              3. Prikaz na fakturi
            </Title>
            <Stack gap="sm">
              <SegmentedControl
                value={grouping}
                onChange={(v) => setGrouping(v as 'grouped' | 'detailed')}
                data={[
                  { value: 'grouped', label: 'Grupisano (jedna stavka za sate)' },
                  { value: 'detailed', label: 'Detaljno (svaki unos posebno)' },
                ]}
              />
              <Switch
                label="Priloži izveštaj o radu (spisak sati po danima) kao drugu stranu PDF-a"
                checked={includeReport}
                onChange={(e) => setIncludeReport(e.currentTarget.checked)}
              />
            </Stack>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Paper p="md" style={{ position: 'sticky', top: 72 }}>
            <Title order={5} mb="sm">
              4. Podaci fakture
            </Title>
            <Stack gap="sm">
              <SimpleGrid cols={2}>
                <TextInput label="Broj fakture" value={number} onChange={(e) => setNumber(e.currentTarget.value)} required />
                <TextInput label="Mesto izdavanja" value={place} onChange={(e) => setPlace(e.currentTarget.value)} />
                <DateInput label="Datum izdavanja" value={issueDate} onChange={setIssueDate} valueFormat="DD.MM.YYYY." required />
                <DateInput label="Datum prometa" value={serviceDate} onChange={setServiceDate} valueFormat="DD.MM.YYYY." required />
                <DateInput label="Rok plaćanja" value={dueDate} onChange={setDueDate} valueFormat="DD.MM.YYYY." required />
                <Group gap={4} align="flex-end">
                  {[7, 15, 30].map((d) => (
                    <Button key={d} size="compact-xs" variant="default" onClick={() => issueDate && setDueDate(addDays(issueDate, d))}>
                      {d} dana
                    </Button>
                  ))}
                </Group>
              </SimpleGrid>
              <Textarea label="Napomena" autosize minRows={2} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />

              <Paper p="sm" bg="var(--mantine-color-default-hover)" withBorder={false}>
                <Stack gap={4}>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      Izabrano stavki
                    </Text>
                    <Text size="sm">
                      {chosen.length} ({formatHours(totalHours)} h)
                    </Text>
                  </Group>
                  {vatRate > 0 && (
                    <>
                      <Group justify="space-between">
                        <Text size="sm" c="dimmed">
                          Osnovica
                        </Text>
                        <Text size="sm">{formatMoney(subtotal, client?.currency ?? '')}</Text>
                      </Group>
                      <Group justify="space-between">
                        <Text size="sm" c="dimmed">
                          PDV {vatRate}%
                        </Text>
                        <Text size="sm">{formatMoney(subtotal * (vatRate / 100), client?.currency ?? '')}</Text>
                      </Group>
                    </>
                  )}
                  <Group justify="space-between">
                    <Text fw={700}>Ukupno</Text>
                    <Text fw={700} size="lg">
                      {formatMoney(total, client?.currency ?? '')}
                    </Text>
                  </Group>
                </Stack>
              </Paper>

              {client?.language === 'en' && (
                <Alert color="blue" variant="light" icon={<IconInfoCircle />} p="xs">
                  Faktura će biti na engleskom jeziku.
                </Alert>
              )}

              <Button size="md" onClick={submit} loading={create.isPending} disabled={!clientId || !number || !issueDate || !serviceDate || !dueDate}>
                Kreiraj fakturu
              </Button>
              <Text size="xs" c="dimmed">
                Faktura se kreira kao nacrt – stavke, opise i cene možete još menjati pre slanja.
              </Text>
            </Stack>
          </Paper>
        </Grid.Col>
      </Grid>
    </>
  );
}
