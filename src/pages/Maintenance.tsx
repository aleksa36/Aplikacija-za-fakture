import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconEdit, IconInfoCircle, IconPlus, IconTrash } from '@tabler/icons-react';
import type { Maintenance, MaintenanceInput } from '../../shared/types.ts';
import { currentPeriod, formatDate, formatHours, formatMoney, formatMonth } from '../../shared/format.ts';
import { notifyOk, useClients, useDeleteMaintenance, useMaintenance, useSaveMaintenance } from '../api.ts';
import { ClientBadge, ClientSelect, EmptyState, PageHeader } from '../components/common.tsx';
import { INTERVAL_LABEL } from '../utils.ts';

export function MaintenancePage() {
  const items = useMaintenance();
  const clients = useClients();
  const save = useSaveMaintenance();
  const del = useDeleteMaintenance();
  const [editing, setEditing] = useState<Maintenance | 'new' | null>(null);

  const clientById = new Map((clients.data ?? []).map((c) => [c.id, c]));

  const confirmDelete = (m: Maintenance) =>
    modals.openConfirmModal({
      title: 'Brisanje održavanja',
      children: (
        <Text size="sm">
          Obrisati pravilo „{m.description}”? Već upisane stavke ostaju u evidenciji, ali se nove više neće generisati.
        </Text>
      ),
      labels: { confirm: 'Obriši', cancel: 'Otkaži' },
      confirmProps: { color: 'red' },
      onConfirm: () => del.mutate(m.id),
    });

  return (
    <>
      <PageHeader
        title="Obavezna održavanja"
        description="Ponavljajuće stavke koje se automatski upisuju svakog meseca (ili kvartala/godine)."
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            Novo održavanje
          </Button>
        }
      />

      <Alert icon={<IconInfoCircle />} color="blue" variant="light" mb="md">
        Na zadati dan u mesecu aplikacija sama dodaje stavku u <b>Unos sati</b> – kao paušalni iznos ili kao sate po satnici
        klijenta. Te stavke se zatim automatski nalaze na sledećoj fakturi. U opisu možete koristiti <code>{'{mesec}'}</code>{' '}
        i <code>{'{godina}'}</code> (npr. „Održavanje sajta – {'{mesec}'} {'{godina}'}”).
      </Alert>

      <Paper p={0}>
        {(items.data ?? []).length === 0 && !items.isLoading ? (
          <EmptyState>Nema definisanih održavanja.</EmptyState>
        ) : (
          <Table.ScrollContainer minWidth={760}>
            <Table verticalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Klijent</Table.Th>
                  <Table.Th>Opis</Table.Th>
                  <Table.Th className="num">Iznos</Table.Th>
                  <Table.Th>Učestalost</Table.Th>
                  <Table.Th>Poslednje upisano</Table.Th>
                  <Table.Th>Aktivno</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(items.data ?? []).map((m) => {
                  const client = clientById.get(m.clientId);
                  return (
                    <Table.Tr key={m.id} opacity={m.active ? 1 : 0.55}>
                      <Table.Td>
                        <ClientBadge name={m.clientName} color={client?.color} />
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{m.description}</Text>
                        <Text size="xs" c="dimmed">
                          od {formatDate(m.startDate)}
                          {m.endDate ? ` do ${formatDate(m.endDate)}` : ''}
                        </Text>
                      </Table.Td>
                      <Table.Td className="num">
                        <Text size="sm" fw={600}>
                          {m.fixedAmount !== null
                            ? formatMoney(m.fixedAmount, client?.currency ?? '')
                            : `${formatHours(m.hours)} h × ${formatMoney(client?.hourlyRate ?? 0, client?.currency ?? '')}`}
                        </Text>
                        {m.fixedAmount !== null && m.hours > 0 && (
                          <Text size="xs" c="dimmed">
                            ({formatHours(m.hours)} h u izveštaju)
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{INTERVAL_LABEL[m.intervalMonths] ?? `${m.intervalMonths} mes.`}</Text>
                        <Text size="xs" c="dimmed">
                          {m.dayOfMonth}. u mesecu
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {m.lastPeriod ? (
                          <Badge variant="light" color={m.lastPeriod === currentPeriod() ? 'teal' : 'gray'}>
                            {formatMonth(m.lastPeriod)}
                          </Badge>
                        ) : (
                          <Text size="xs" c="dimmed">
                            još nije
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Switch
                          checked={m.active}
                          onChange={(e) => save.mutate({ id: m.id, data: { ...m, active: e.currentTarget.checked } })}
                          aria-label="Aktivno"
                        />
                      </Table.Td>
                      <Table.Td w={80}>
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          <Tooltip label="Izmeni">
                            <ActionIcon variant="subtle" onClick={() => setEditing(m)} aria-label="Izmeni">
                              <IconEdit size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Obriši">
                            <ActionIcon variant="subtle" color="red" onClick={() => confirmDelete(m)} aria-label="Obriši">
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Paper>

      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Novo održavanje' : 'Izmena održavanja'} size="lg">
        {editing !== null && (
          <MaintenanceForm key={editing === 'new' ? 'new' : editing.id} item={editing === 'new' ? undefined : editing} onSaved={() => setEditing(null)} />
        )}
      </Modal>
    </>
  );
}

type FormValues = Omit<MaintenanceInput, 'fixedAmount' | 'clientId'> & {
  clientId: number | null;
  mode: 'fixed' | 'hours';
  fixedAmount: number | string;
};

function MaintenanceForm({ item, onSaved }: { item?: Maintenance; onSaved: () => void }) {
  const save = useSaveMaintenance();
  const clients = useClients();
  const form = useForm<FormValues>({
    initialValues: {
      clientId: item?.clientId ?? null,
      description: item?.description ?? 'Mesečno održavanje – {mesec} {godina}',
      mode: item && item.fixedAmount === null ? 'hours' : 'fixed',
      hours: item?.hours ?? 0,
      fixedAmount: item?.fixedAmount ?? '',
      intervalMonths: item?.intervalMonths ?? 1,
      dayOfMonth: item?.dayOfMonth ?? 1,
      startDate: item?.startDate ?? `${currentPeriod()}-01`,
      endDate: item?.endDate ?? null,
      active: item?.active ?? true,
    },
    validate: {
      clientId: (v) => (v ? null : 'Izaberite klijenta'),
      description: (v) => (v.trim() ? null : 'Opis je obavezan'),
      fixedAmount: (v, values) => (values.mode === 'fixed' && (v === '' || Number(v) <= 0) ? 'Unesite iznos' : null),
      hours: (v, values) => (values.mode === 'hours' && !(v > 0) ? 'Unesite broj sati' : null),
      startDate: (v) => (v ? null : 'Obavezno'),
    },
  });
  const client = clients.data?.find((c) => c.id === form.values.clientId);

  const submit = form.onSubmit((v) => {
    const data: MaintenanceInput = {
      clientId: v.clientId!,
      description: v.description,
      hours: Number(v.hours) || 0,
      fixedAmount: v.mode === 'fixed' ? Number(v.fixedAmount) : null,
      intervalMonths: Number(v.intervalMonths),
      dayOfMonth: Number(v.dayOfMonth),
      startDate: v.startDate,
      endDate: v.endDate || null,
      active: v.active,
    };
    save.mutate(
      { id: item?.id, data },
      {
        onSuccess: (res) => {
          notifyOk(res.createdEntries ? `Sačuvano. Automatski upisano stavki: ${res.createdEntries}.` : 'Održavanje je sačuvano.');
          onSaved();
        },
      },
    );
  });

  return (
    <form onSubmit={submit}>
      <Stack gap="sm">
        <ClientSelect label="Klijent" required value={form.values.clientId} onChange={(id) => form.setFieldValue('clientId', id)} error={form.errors.clientId} />
        <TextInput
          label="Opis (prikazuje se na fakturi)"
          description="{mesec} i {godina} se zamenjuju nazivom meseca i godinom"
          required
          {...form.getInputProps('description')}
        />
        <SegmentedControl
          data={[
            { value: 'fixed', label: 'Paušalni iznos' },
            { value: 'hours', label: 'Po satima (satnica klijenta)' },
          ]}
          {...form.getInputProps('mode')}
        />
        <SimpleGrid cols={2}>
          {form.values.mode === 'fixed' ? (
            <NumberInput
              label="Iznos"
              min={0}
              decimalSeparator=","
              thousandSeparator="."
              hideControls
              rightSection={<Text size="xs" c="dimmed">{client?.currency}</Text>}
              {...form.getInputProps('fixedAmount')}
            />
          ) : null}
          <NumberInput
            label={form.values.mode === 'fixed' ? 'Sati (informativno, za izveštaj)' : 'Broj sati'}
            min={0}
            max={744}
            step={0.5}
            decimalScale={2}
            decimalSeparator=","
            {...form.getInputProps('hours')}
          />
        </SimpleGrid>
        <SimpleGrid cols={2}>
          <Select
            label="Učestalost"
            data={Object.entries(INTERVAL_LABEL).map(([value, label]) => ({ value, label }))}
            value={String(form.values.intervalMonths)}
            onChange={(v) => form.setFieldValue('intervalMonths', Number(v ?? 1))}
            allowDeselect={false}
          />
          <NumberInput label="Dan u mesecu" min={1} max={31} description="31 = poslednji dan u mesecu" {...form.getInputProps('dayOfMonth')} />
        </SimpleGrid>
        <SimpleGrid cols={2}>
          <DateInput
            label="Počinje od"
            valueFormat="DD.MM.YYYY."
            description="Za ranije mesece se upisuje unazad"
            {...form.getInputProps('startDate')}
          />
          <DateInput label="Završava se (opciono)" valueFormat="DD.MM.YYYY." clearable {...form.getInputProps('endDate')} />
        </SimpleGrid>
        <Switch label="Aktivno" {...form.getInputProps('active', { type: 'checkbox' })} />
        <Group justify="flex-end" mt="md">
          <Button type="submit" loading={save.isPending}>
            Sačuvaj
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
