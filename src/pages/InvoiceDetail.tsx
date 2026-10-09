import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Grid,
  Group,
  Loader,
  Menu,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import {
  IconArrowLeft,
  IconCheck,
  IconChevronDown,
  IconDeviceFloppy,
  IconDownload,
  IconExternalLink,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { InvoiceItem, InvoiceStatus, InvoiceUpdateInput } from '../../shared/types.ts';
import { formatDate, formatHours, formatMoney, today } from '../../shared/format.ts';
import { type InvoiceWithEntries, notifyError, useDeleteInvoice, useInvoice, useInvoiceStatus, useUpdateInvoice } from '../api.ts';
import { downloadInvoicePdf, invoiceDocument, openInvoicePdf, usePdfUrl } from '../pdf/index.ts';
import { EmptyState, PageHeader } from '../components/common.tsx';
import { STATUS_LABEL } from '../utils.ts';
import { StatusBadge } from './Invoices.tsx';

export function InvoiceDetailPage() {
  const { id } = useParams();
  const invoiceId = Number(id);
  const navigate = useNavigate();
  const invoice = useInvoice(invoiceId);
  const update = useUpdateInvoice();
  const setStatus = useInvoiceStatus();
  const del = useDeleteInvoice();
  const [form, setForm] = useState<InvoiceUpdateInput | null>(null);
  const [tab, setTab] = useState<string | null>('edit');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!invoice.data || dirty) return;
    const d = invoice.data;
    setForm({
      number: d.number,
      issueDate: d.issueDate,
      serviceDate: d.serviceDate,
      dueDate: d.dueDate,
      place: d.place,
      notes: d.notes,
      status: d.status,
      paidDate: d.paidDate,
      includeReport: d.includeReport,
      vatRate: d.vatRate,
      items: d.items.map((it) => ({ description: it.description, quantity: it.quantity, unit: it.unit, unitPrice: it.unitPrice })),
    });
  }, [invoice.data, dirty]);

  if (invoice.isError) return <EmptyState>Faktura nije pronađena.</EmptyState>;
  if (!invoice.data || !form) return null;
  const inv = invoice.data;
  const cur = inv.currency;

  const patch = (p: Partial<InvoiceUpdateInput>) => {
    setForm({ ...form, ...p });
    setDirty(true);
  };
  const patchItem = (index: number, p: Partial<InvoiceItem>) =>
    patch({ items: form.items.map((it, i) => (i === index ? { ...it, ...p } : it)) });

  const subtotal = form.items.reduce((s, it) => s + Math.round(Number(it.quantity) * Number(it.unitPrice) * 100) / 100, 0);
  const vat = Math.round(subtotal * Number(form.vatRate)) / 100;

  const saveForm = () =>
    update.mutate(
      { id: invoiceId, data: form },
      {
        onSuccess: () => setDirty(false),
      },
    );

  const changeStatus = (status: InvoiceStatus) => {
    const run = () =>
      setStatus.mutate(
        { id: invoiceId, status },
        {
          onSuccess: () => setDirty(false),
        },
      );
    if (status === 'cancelled') {
      modals.openConfirmModal({
        title: 'Storniranje fakture',
        children: (
          <Text size="sm">
            Faktura ostaje u evidenciji sa oznakom „STORNIRANO”, a njene stavke rada se oslobađaju da mogu ponovo da se fakturišu.
          </Text>
        ),
        labels: { confirm: 'Storniraj', cancel: 'Otkaži' },
        confirmProps: { color: 'red' },
        onConfirm: run,
      });
    } else run();
  };

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: 'Brisanje fakture',
      children: (
        <Text size="sm">
          Trajno obrisati fakturu <b>{inv.number}</b>? Stavke rada se vraćaju u nefakturisane. Ako je faktura već poslata
          klijentu, bolje je da je stornirate.
        </Text>
      ),
      labels: { confirm: 'Obriši', cancel: 'Otkaži' },
      confirmProps: { color: 'red' },
      onConfirm: () => del.mutate(invoiceId, { onSuccess: () => navigate('/fakture') }),
    });


  return (
    <>
      <Anchor component={Link} to="/fakture" size="sm" mb="xs" display="inline-flex" style={{ alignItems: 'center', gap: 4 }}>
        <IconArrowLeft size={14} /> Sve fakture
      </Anchor>
      <PageHeader
        title={`Faktura ${inv.number}`}
        description={
          <Group gap="xs" component="span">
            <StatusBadge invoice={inv} />
            <span>
              {inv.client.name} · {formatMoney(inv.total, cur)}
              {inv.paidDate && ` · plaćeno ${formatDate(inv.paidDate)}`}
            </span>
          </Group>
        }
        actions={
          <>
            <Button
              variant="default"
              onClick={() => openInvoicePdf(invoiceId, inv).catch(notifyError)}
              leftSection={<IconExternalLink size={16} />}
              disabled={dirty}
            >
              Otvori PDF
            </Button>
            <Button
              variant="default"
              onClick={() => downloadInvoicePdf(invoiceId, inv).catch(notifyError)}
              leftSection={<IconDownload size={16} />}
              disabled={dirty}
            >
              Preuzmi
            </Button>
            {inv.status !== 'paid' && inv.status !== 'cancelled' && (
              <Button color="teal" leftSection={<IconCheck size={16} />} onClick={() => changeStatus('paid')} disabled={dirty}>
                Plaćeno
              </Button>
            )}
            <Menu position="bottom-end">
              <Menu.Target>
                <Button variant="default" rightSection={<IconChevronDown size={14} />} disabled={dirty}>
                  Status
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                {(Object.keys(STATUS_LABEL) as InvoiceStatus[]).map((s) => (
                  <Menu.Item key={s} disabled={s === inv.status} onClick={() => changeStatus(s)} color={s === 'cancelled' ? 'red' : undefined}>
                    {STATUS_LABEL[s]}
                  </Menu.Item>
                ))}
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={confirmDelete}>
                  Obriši fakturu
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </>
        }
      />

      {dirty && (
        <Alert color="yellow" mb="md" p="xs">
          <Group justify="space-between">
            <Text size="sm">Imate nesačuvane izmene.</Text>
            <Group gap="xs">
              <Button size="xs" variant="default" onClick={() => setDirty(false)}>
                Poništi
              </Button>
              <Button size="xs" leftSection={<IconDeviceFloppy size={14} />} onClick={saveForm} loading={update.isPending}>
                Sačuvaj
              </Button>
            </Group>
          </Group>
        </Alert>
      )}

      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="edit">Podaci i stavke</Tabs.Tab>
          <Tabs.Tab value="preview" disabled={dirty}>
            Pregled PDF-a
          </Tabs.Tab>
          <Tabs.Tab value="entries">Stavke rada ({inv.entries.length})</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="edit">
          <Grid gutter="lg">
            <Grid.Col span={{ base: 12, lg: 8 }}>
              <Paper p={0}>
                <Title order={5} p="md" pb="xs">
                  Stavke fakture
                </Title>
                <Table.ScrollContainer minWidth={640}>
                  <Table verticalSpacing="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Opis</Table.Th>
                        <Table.Th w={90}>Količina</Table.Th>
                        <Table.Th w={85}>Jed.</Table.Th>
                        <Table.Th w={120}>Cena ({cur})</Table.Th>
                        <Table.Th w={120} className="num">
                          Iznos
                        </Table.Th>
                        <Table.Th w={40} />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {form.items.map((it, i) => (
                        <Table.Tr key={i}>
                          <Table.Td>
                            <Textarea
                              autosize
                              minRows={1}
                              value={it.description}
                              onChange={(e) => patchItem(i, { description: e.currentTarget.value })}
                            />
                          </Table.Td>
                          <Table.Td>
                            <NumberInput
                              value={it.quantity}
                              onChange={(v) => patchItem(i, { quantity: Number(v) || 0 })}
                              decimalScale={2}
                              decimalSeparator=","
                              hideControls
                            />
                          </Table.Td>
                          <Table.Td>
                            <TextInput value={it.unit} onChange={(e) => patchItem(i, { unit: e.currentTarget.value })} />
                          </Table.Td>
                          <Table.Td>
                            <NumberInput
                              value={it.unitPrice}
                              onChange={(v) => patchItem(i, { unitPrice: Number(v) || 0 })}
                              decimalScale={2}
                              decimalSeparator=","
                              thousandSeparator="."
                              hideControls
                            />
                          </Table.Td>
                          <Table.Td className="num">
                            <Text size="sm" fw={600}>
                              {formatMoney(it.quantity * it.unitPrice, cur)}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              onClick={() => patch({ items: form.items.filter((_, j) => j !== i) })}
                              aria-label="Ukloni stavku"
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
                <Group justify="space-between" p="md" align="flex-start">
                  <Button
                    variant="light"
                    size="xs"
                    leftSection={<IconPlus size={14} />}
                    onClick={() =>
                      patch({
                        items: [
                          ...form.items,
                          { description: '', quantity: 1, unit: inv.language === 'en' ? 'pcs' : 'kom', unitPrice: 0 },
                        ],
                      })
                    }
                  >
                    Dodaj stavku
                  </Button>
                  <Stack gap={2} align="flex-end">
                    {Number(form.vatRate) > 0 && (
                      <>
                        <Text size="sm" c="dimmed">
                          Osnovica: {formatMoney(subtotal, cur)}
                        </Text>
                        <Text size="sm" c="dimmed">
                          PDV {form.vatRate}%: {formatMoney(vat, cur)}
                        </Text>
                      </>
                    )}
                    <Text fw={700} size="lg">
                      Ukupno: {formatMoney(subtotal + vat, cur)}
                    </Text>
                  </Stack>
                </Group>
              </Paper>
            </Grid.Col>

            <Grid.Col span={{ base: 12, lg: 4 }}>
              <Paper p="md">
                <Stack gap="sm">
                  <TextInput label="Broj fakture" value={form.number} onChange={(e) => patch({ number: e.currentTarget.value })} />
                  <SimpleGrid cols={2}>
                    <DateInput
                      label="Datum izdavanja"
                      valueFormat="DD.MM.YYYY."
                      value={form.issueDate}
                      onChange={(v) => v && patch({ issueDate: v })}
                    />
                    <DateInput
                      label="Datum prometa"
                      valueFormat="DD.MM.YYYY."
                      value={form.serviceDate}
                      onChange={(v) => v && patch({ serviceDate: v })}
                    />
                    <DateInput label="Rok plaćanja" valueFormat="DD.MM.YYYY." value={form.dueDate} onChange={(v) => v && patch({ dueDate: v })} />
                    <TextInput label="Mesto izdavanja" value={form.place} onChange={(e) => patch({ place: e.currentTarget.value })} />
                  </SimpleGrid>
                  {form.status === 'paid' && (
                    <DateInput
                      label="Datum uplate"
                      valueFormat="DD.MM.YYYY."
                      value={form.paidDate}
                      onChange={(v) => patch({ paidDate: v ?? today() })}
                    />
                  )}
                  <NumberInput
                    label="PDV stopa (%)"
                    value={form.vatRate}
                    onChange={(v) => patch({ vatRate: Number(v) || 0 })}
                    min={0}
                    max={100}
                  />
                  <Textarea label="Napomena" autosize minRows={3} value={form.notes} onChange={(e) => patch({ notes: e.currentTarget.value })} />
                  <Switch
                    label="Priloži izveštaj o radu u PDF"
                    checked={form.includeReport}
                    onChange={(e) => patch({ includeReport: e.currentTarget.checked })}
                  />
                  <Button onClick={saveForm} loading={update.isPending} disabled={!dirty} leftSection={<IconDeviceFloppy size={16} />}>
                    Sačuvaj izmene
                  </Button>
                </Stack>
              </Paper>
            </Grid.Col>
          </Grid>
        </Tabs.Panel>

        <Tabs.Panel value="preview">
          <PdfPreview invoice={tab === 'preview' ? inv : null} />
        </Tabs.Panel>

        <Tabs.Panel value="entries">
          <Paper p={0}>
            {inv.entries.length === 0 ? (
              <EmptyState>Faktura nema povezanih stavki rada.</EmptyState>
            ) : (
              <Table verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Datum</Table.Th>
                    <Table.Th>Opis</Table.Th>
                    <Table.Th className="num">Sati</Table.Th>
                    <Table.Th className="num">Iznos</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {inv.entries.map((e) => (
                    <Table.Tr key={e.id}>
                      <Table.Td>{formatDate(e.date)}</Table.Td>
                      <Table.Td>{e.description}</Table.Td>
                      <Table.Td className="num">{e.hours ? formatHours(e.hours) : '—'}</Table.Td>
                      <Table.Td className="num">{formatMoney(e.value ?? 0, cur)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Paper>
        </Tabs.Panel>
      </Tabs>
    </>
  );
}

function PdfPreview({ invoice }: { invoice: InvoiceWithEntries | null }) {
  const doc = useMemo(() => (invoice ? invoiceDocument(invoice, invoice.entries) : null), [invoice]);
  const { url, error } = usePdfUrl(doc);
  if (error) return <Alert color="red">PDF nije mogao da se napravi: {error}</Alert>;
  if (!url) return <Group justify="center" py="xl"><Loader /></Group>;
  return <iframe className="pdf-frame" src={url} title="Pregled fakture" />;
}
