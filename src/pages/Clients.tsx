import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  ColorSwatch,
  Divider,
  Group,
  Menu,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  useMantineTheme,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { MonthPickerInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { IconArchive, IconArchiveOff, IconDots, IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import type { Client, ClientInput } from '../../shared/types.ts';
import { CURRENCIES } from '../../shared/types.ts';
import { formatMoney } from '../../shared/format.ts';
import { useClients, useDeleteClient, useSaveClient, useSettings } from '../api.ts';
import { ClientDot, EmptyState, PageHeader } from '../components/common.tsx';
import { CLIENT_COLORS, count } from '../utils.ts';

export function ClientsPage() {
  const clients = useClients();
  const save = useSaveClient();
  const del = useDeleteClient();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Client | 'new' | null>(null);
  const navigate = useNavigate();

  const list = (clients.data ?? []).filter((c) => showArchived || !c.archived);

  const toggleArchive = (c: Client) => save.mutate({ id: c.id, data: { ...c, archived: !c.archived } });

  const confirmDelete = (c: Client) =>
    modals.openConfirmModal({
      title: 'Brisanje klijenta',
      children: (
        <Text size="sm">
          Obrisati klijenta <b>{c.name}</b> zajedno sa svim njegovim unosima sati i održavanjima? Ova akcija se ne može
          poništiti. Klijenti koji imaju fakture ne mogu se brisati – njih arhivirajte.
        </Text>
      ),
      labels: { confirm: 'Obriši', cancel: 'Otkaži' },
      confirmProps: { color: 'red' },
      onConfirm: () => del.mutate(c.id),
    });

  return (
    <>
      <PageHeader
        title="Klijenti"
        description="Podaci o klijentima, satnice, valuta i jezik fakture."
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            Novi klijent
          </Button>
        }
      />
      <Group mb="sm">
        <Switch label="Prikaži arhivirane" checked={showArchived} onChange={(e) => setShowArchived(e.currentTarget.checked)} />
      </Group>

      <Paper p={0}>
        {list.length === 0 && !clients.isLoading ? (
          <EmptyState>Još nema klijenata. Dodajte prvog klijenta.</EmptyState>
        ) : (
          <Table.ScrollContainer minWidth={700}>
            <Table verticalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Naziv</Table.Th>
                  <Table.Th>Mesto</Table.Th>
                  <Table.Th>PIB</Table.Th>
                  <Table.Th className="num">Satnica / održavanje</Table.Th>
                  <Table.Th>Rok</Table.Th>
                  <Table.Th>Jezik</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {list.map((c) => (
                  <Table.Tr key={c.id} className="clickable-row" onClick={() => navigate(`/klijenti/${c.id}`)} opacity={c.archived ? 0.55 : 1}>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <ClientDot color={c.color} />
                        <div>
                          <Text fw={600} size="sm">
                            {c.name}
                          </Text>
                          {(c.contactPerson || c.email) && (
                            <Text size="xs" c="dimmed">
                              {[c.contactPerson, c.email].filter(Boolean).join(' · ')}
                            </Text>
                          )}
                        </div>
                        {c.archived && <Badge size="xs" color="gray">arhiviran</Badge>}
                        {!!c.openTodos && (
                          <Badge size="xs" variant="light" color="orange" tt="none">
                            {count(c.openTodos, 'zadatak', 'zadatka', 'zadataka')}
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{[c.city, c.country].filter(Boolean).join(', ')}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{c.pib}</Text>
                    </Table.Td>
                    <Table.Td className="num">
                      <Text size="sm">{formatMoney(c.hourlyRate, c.currency)}/h</Text>
                      {c.maintenanceAmount > 0 && (
                        <Text size="xs" c="dimmed">
                          održavanje {formatMoney(c.maintenanceAmount, c.currency)}/mes.
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{c.paymentDays} dana</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="outline" size="sm">
                        {c.language}
                      </Badge>
                    </Table.Td>
                    <Table.Td onClick={(e) => e.stopPropagation()} w={50}>
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon variant="subtle" aria-label="Akcije">
                            <IconDots size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => setEditing(c)}>
                            Izmeni
                          </Menu.Item>
                          <Menu.Item
                            leftSection={c.archived ? <IconArchiveOff size={14} /> : <IconArchive size={14} />}
                            onClick={() => toggleArchive(c)}
                          >
                            {c.archived ? 'Vrati iz arhive' : 'Arhiviraj'}
                          </Menu.Item>
                          <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => confirmDelete(c)}>
                            Obriši
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Paper>

      <Modal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Novi klijent' : 'Izmena klijenta'}
        size="xl"
      >
        {editing !== null && (
          <ClientForm
            key={editing === 'new' ? 'new' : editing.id}
            client={editing === 'new' ? undefined : editing}
            onSaved={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  );
}

export function ClientForm({ client, onSaved }: { client?: Client; onSaved: () => void }) {
  const settings = useSettings();
  const save = useSaveClient();
  const theme = useMantineTheme();
  const form = useForm<ClientInput>({
    initialValues: client
      ? { ...client }
      : {
          name: '',
          address: '',
          city: '',
          zip: '',
          country: 'Srbija',
          pib: '',
          mb: '',
          email: '',
          phone: '',
          contactPerson: '',
          hourlyRate: settings.data?.defaultHourlyRate ?? 0,
          currency: settings.data?.defaultCurrency ?? 'RSD',
          paymentDays: settings.data?.defaultPaymentDays ?? 15,
          language: 'sr',
          vatExempt: false,
          invoiceNote: '',
          notes: '',
          color: CLIENT_COLORS[Math.floor(Math.random() * CLIENT_COLORS.length)],
          archived: false,
          maintenanceAmount: 0,
          maintenanceLabel: 'Mesečno održavanje',
          maintenanceStart: null,
        },
    validate: {
      name: (v) => (v.trim() ? null : 'Naziv je obavezan'),
      email: (v) => (!v || /^\S+@\S+\.\S+$/.test(v) ? null : 'Neispravan email'),
    },
  });

  return (
    <form onSubmit={form.onSubmit((values) => save.mutate({ id: client?.id, data: values }, { onSuccess: onSaved }))}>
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Naziv firme / ime" required data-autofocus {...form.getInputProps('name')} />
          <TextInput label="Kontakt osoba" {...form.getInputProps('contactPerson')} />
          <TextInput label="Email" {...form.getInputProps('email')} />
          <TextInput label="Telefon" {...form.getInputProps('phone')} />
        </SimpleGrid>

        <Divider label="Adresa i identifikacija" labelPosition="left" mt="xs" />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Adresa" {...form.getInputProps('address')} />
          <Group grow>
            <TextInput label="Poštanski broj" {...form.getInputProps('zip')} />
            <TextInput label="Mesto" {...form.getInputProps('city')} />
          </Group>
          <TextInput label="Država" {...form.getInputProps('country')} />
          <Group grow>
            <TextInput label="PIB / VAT ID" {...form.getInputProps('pib')} />
            <TextInput label="Matični broj" {...form.getInputProps('mb')} />
          </Group>
        </SimpleGrid>

        <Divider label="Naplata" labelPosition="left" mt="xs" />
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <NumberInput
            label="Satnica"
            min={0}
            decimalSeparator=","
            thousandSeparator="."
            hideControls
            {...form.getInputProps('hourlyRate')}
          />
          <Select label="Valuta" data={CURRENCIES} allowDeselect={false} {...form.getInputProps('currency')} />
          <NumberInput label="Rok plaćanja (dana)" min={0} max={365} {...form.getInputProps('paymentDays')} />
          <Select
            label="Jezik fakture"
            data={[
              { value: 'sr', label: 'Srpski' },
              { value: 'en', label: 'Engleski' },
            ]}
            allowDeselect={false}
            {...form.getInputProps('language')}
          />
        </SimpleGrid>
        <Checkbox
          label="Bez PDV-a za ovog klijenta (npr. inostrani klijent)"
          description="Važi samo ako ste u sistemu PDV-a."
          {...form.getInputProps('vatExempt', { type: 'checkbox' })}
        />
        <Divider label="Mesečno održavanje" labelPosition="left" mt="xs" />
        <Text size="xs" c="dimmed" mt={-6}>
          Ako unesete iznos, održavanje se automatski upisuje svakog meseca sa naslovom „{form.values.maintenanceLabel || 'Mesečno održavanje'} – mesec godina”.
          Ostavite 0 ako klijent nema održavanje.
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <NumberInput
            label="Iznos mesečno"
            min={0}
            decimalSeparator=","
            thousandSeparator="."
            hideControls
            rightSection={<Text size="xs" c="dimmed">{form.values.currency}</Text>}
            {...form.getInputProps('maintenanceAmount')}
          />
          <TextInput label="Naziv na fakturi" {...form.getInputProps('maintenanceLabel')} />
          <MonthPickerInput
            label="Upisuje se od meseca"
            valueFormat="MMMM YYYY"
            placeholder="tekući mesec"
            disabled={!(Number(form.values.maintenanceAmount) > 0)}
            value={form.values.maintenanceStart ? `${form.values.maintenanceStart}-01` : null}
            onChange={(v) => form.setFieldValue('maintenanceStart', v ? v.slice(0, 7) : null)}
            clearable
          />
        </SimpleGrid>

        <Textarea
          label="Napomena na fakturi"
          description="Dodaje se iznad podrazumevane napomene (npr. broj ugovora, poziv na broj, reverse charge…)"
          autosize
          minRows={2}
          {...form.getInputProps('invoiceNote')}
        />
        <Textarea label="Interne beleške" description="Ne prikazuju se na fakturi" autosize minRows={2} {...form.getInputProps('notes')} />

        <div>
          <Text size="sm" fw={500} mb={6}>
            Boja
          </Text>
          <Group gap={6}>
            {CLIENT_COLORS.map((c) => (
              <ColorSwatch
                key={c}
                component="button"
                type="button"
                color={theme.colors[c][6]}
                onClick={() => form.setFieldValue('color', c)}
                style={{ cursor: 'pointer', outline: form.values.color === c ? `2px solid ${theme.colors[c][6]}` : undefined, outlineOffset: 2 }}
                aria-label={c}
              />
            ))}
          </Group>
        </div>

        <Group justify="flex-end" mt="md">
          <Button type="submit" loading={save.isPending}>
            Sačuvaj
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
