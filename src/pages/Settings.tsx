import { useEffect } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  ColorInput,
  Divider,
  FileButton,
  Grid,
  Group,
  Image,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconDatabaseExport, IconDatabaseImport, IconDeviceFloppy, IconPhoto, IconTrash } from '@tabler/icons-react';
import { modals } from '@mantine/modals';
import { useQueryClient } from '@tanstack/react-query';
import type { Settings } from '../../shared/types.ts';
import { CURRENCIES } from '../../shared/types.ts';
import { formatInvoiceNumber, today } from '../../shared/format.ts';
import { notifyError, notifyOk, request, useSaveSettings, useSettings } from '../api.ts';
import { PageHeader } from '../components/common.tsx';
import { normalizeAccount } from '../pdf/ipsQr.ts';
import { downloadUrl } from '../utils.ts';

/** Smanjuje sliku na razumnu veličinu i vraća PNG data URL (da PDF ne bude ogroman). */
function imageToDataUrl(file: File, maxWidth = 600): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Slika ne može da se učita.'));
    };
    img.src = url;
  });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper p="md">
      <Title order={5} mb="sm">
        {title}
      </Title>
      {children}
    </Paper>
  );
}

export function SettingsPage() {
  const settings = useSettings();
  const save = useSaveSettings();
  const form = useForm<Settings>({ initialValues: undefined as unknown as Settings });
  const queryClient = useQueryClient();

  const confirmRestore = (file: File) =>
    modals.openConfirmModal({
      title: 'Vraćanje iz rezervne kopije',
      children: (
        <Text size="sm">
          Svi trenutni podaci biće <b>obrisani</b> i zamenjeni podacima iz datoteke „{file.name}”. Nastaviti?
        </Text>
      ),
      labels: { confirm: 'Vrati podatke', cancel: 'Otkaži' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          const backup = JSON.parse(await file.text());
          const res = await request<{ restored: Record<string, number> }>('/restore', { method: 'POST', body: backup });
          await queryClient.resetQueries();
          const fresh = await request<Settings>('/settings');
          form.setInitialValues(fresh);
          form.setValues(fresh);
          notifyOk(`Podaci su vraćeni (${res.restored.clients ?? 0} klijenata, ${res.restored.entries ?? 0} unosa, ${res.restored.invoices ?? 0} faktura).`);
        } catch (err) {
          notifyError(err instanceof SyntaxError ? new Error('Datoteka nije ispravan JSON.') : err);
        }
      },
    });

  useEffect(() => {
    if (settings.data && !form.initialized) form.initialize(settings.data);
  }, [settings.data, form]);

  if (!form.initialized) return null;
  const v = form.values;

  return (
    <form onSubmit={form.onSubmit((values) => save.mutate(values, { onSuccess: () => form.resetDirty(values) }))}>
      <PageHeader
        title="Podešavanja"
        description="Vaši podaci koji se prikazuju na fakturama i izveštajima."
        actions={
          <Button type="submit" leftSection={<IconDeviceFloppy size={16} />} loading={save.isPending} disabled={!form.isDirty()}>
            Sačuvaj
          </Button>
        }
      />

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Stack gap="lg">
            <Section title="Podaci o firmi / preduzetniku">
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput label="Naziv firme" placeholder="npr. Ime Prezime PR Razvoj softvera" {...form.getInputProps('companyName')} />
                <TextInput label="Ime i prezime vlasnika" {...form.getInputProps('ownerName')} />
                <TextInput label="Adresa" {...form.getInputProps('address')} />
                <Group grow>
                  <TextInput label="Poštanski broj" {...form.getInputProps('zip')} />
                  <TextInput label="Mesto" {...form.getInputProps('city')} />
                </Group>
                <TextInput label="Država" {...form.getInputProps('country')} />
                <TextInput label="Šifra delatnosti" placeholder="npr. 6201" {...form.getInputProps('activityCode')} />
                <TextInput label="PIB" {...form.getInputProps('pib')} />
                <TextInput label="Matični broj" {...form.getInputProps('mb')} />
                <TextInput label="Email" {...form.getInputProps('email')} />
                <TextInput label="Telefon" {...form.getInputProps('phone')} />
                <TextInput label="Web sajt" {...form.getInputProps('website')} />
              </SimpleGrid>
            </Section>

            <Section title="Banka">
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput label="Tekući račun (dinarski)" placeholder="160-0000000000000-00" {...form.getInputProps('bankAccount')} />
                <TextInput label="Naziv banke" {...form.getInputProps('bankName')} />
                <TextInput label="IBAN (devizni)" description="Prikazuje se na fakturama u stranoj valuti" {...form.getInputProps('iban')} />
                <TextInput label="SWIFT / BIC" {...form.getInputProps('swift')} />
              </SimpleGrid>
              <Divider label="IPS QR kod" labelPosition="left" mt="md" mb="xs" />
              <Group align="flex-start" gap="lg">
                <Checkbox
                  mt={4}
                  label="IPS QR kod na dinarskim fakturama"
                  description="Klijent skenira kod u m-banking aplikaciji i plaćanje je popunjeno (račun, iznos, svrha)."
                  style={{ flex: 1 }}
                  {...form.getInputProps('ipsQr', { type: 'checkbox' })}
                />
                {v.ipsQr && (
                  <TextInput
                    label="Šifra plaćanja"
                    description="221 je uobičajena"
                    w={140}
                    {...form.getInputProps('paymentCode')}
                    error={v.paymentCode && !/^[12]\d\d$/.test(v.paymentCode) ? 'Tri cifre (npr. 221)' : undefined}
                  />
                )}
              </Group>
              {v.ipsQr && v.bankAccount && !normalizeAccount(v.bankAccount) && (
                <Alert color="yellow" variant="light" mt="xs" p="xs">
                  Tekući račun nije ispravan (proverite cifre i kontrolni broj), pa se QR kod neće prikazati.
                </Alert>
              )}
            </Section>

            <Section title="Fakture">
              <Stack gap="sm">
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <TextInput
                    label="Format broja fakture"
                    description={`{n} redni broj, {nnn} sa nulama, {yyyy} godina, {mm} mesec. Primer: ${formatInvoiceNumber(v.invoiceNumberFormat || '{n}/{yyyy}', 7, today())}`}
                    {...form.getInputProps('invoiceNumberFormat')}
                  />
                  <TextInput label="Mesto izdavanja" placeholder={v.city} {...form.getInputProps('defaultPlace')} />
                  <NumberInput label="Podrazumevani rok plaćanja (dana)" min={0} {...form.getInputProps('defaultPaymentDays')} />
                  <Group grow>
                    <NumberInput
                      label="Podrazumevana satnica"
                      min={0}
                      decimalSeparator=","
                      thousandSeparator="."
                      hideControls
                      {...form.getInputProps('defaultHourlyRate')}
                    />
                    <Select label="Valuta" data={CURRENCIES} allowDeselect={false} {...form.getInputProps('defaultCurrency')} />
                  </Group>
                </SimpleGrid>
                <Group align="flex-end">
                  <Checkbox label="U sistemu sam PDV-a" {...form.getInputProps('vatPayer', { type: 'checkbox' })} mb={8} />
                  {v.vatPayer && <NumberInput label="Stopa PDV-a (%)" w={140} min={0} max={100} {...form.getInputProps('vatRate')} />}
                </Group>
                <Divider label="Tekstovi na fakturi" labelPosition="left" />
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <TextInput label="Opis grupisane stavke (srpski)" {...form.getInputProps('serviceDescription')} />
                  <TextInput label="Opis grupisane stavke (engleski)" {...form.getInputProps('serviceDescriptionEn')} />
                  <Textarea label="Podrazumevana napomena (srpski)" autosize minRows={3} {...form.getInputProps('defaultInvoiceNote')} />
                  <Textarea label="Podrazumevana napomena (engleski)" autosize minRows={3} {...form.getInputProps('defaultInvoiceNoteEn')} />
                </SimpleGrid>
              </Stack>
            </Section>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Stack gap="lg">
            <Section title="Izgled PDF-a">
              <Stack gap="sm">
                <div>
                  <Text size="sm" fw={500} mb={6}>
                    Logo
                  </Text>
                  {v.logo ? (
                    <Paper p="sm" mb="xs" bg="white">
                      <Image src={v.logo} mah={80} fit="contain" w="auto" alt="Logo" />
                    </Paper>
                  ) : (
                    <Text size="xs" c="dimmed" mb="xs">
                      Bez loga – prikazuje se samo naziv firme.
                    </Text>
                  )}
                  <Group gap="xs">
                    <FileButton
                      accept="image/png,image/jpeg"
                      onChange={async (file) => {
                        if (!file) return;
                        try {
                          form.setFieldValue('logo', await imageToDataUrl(file));
                        } catch (err) {
                          notifyError(err);
                        }
                      }}
                    >
                      {(props) => (
                        <Button {...props} variant="default" size="xs" leftSection={<IconPhoto size={14} />}>
                          {v.logo ? 'Promeni logo' : 'Dodaj logo'}
                        </Button>
                      )}
                    </FileButton>
                    {v.logo && (
                      <Button variant="subtle" color="red" size="xs" leftSection={<IconTrash size={14} />} onClick={() => form.setFieldValue('logo', '')}>
                        Ukloni
                      </Button>
                    )}
                  </Group>
                </div>
                <ColorInput
                  label="Akcentna boja"
                  format="hex"
                  swatches={['#1c7ed6', '#0b7285', '#2b8a3e', '#5f3dc4', '#c2255c', '#e8590c', '#343a40']}
                  {...form.getInputProps('accentColor')}
                />
              </Stack>
            </Section>

            <Section title="Rezervna kopija">
              <Text size="sm" c="dimmed" mb="sm">
                Preuzmite sve podatke (klijente, sate, održavanja, fakture i podešavanja) u jednoj JSON datoteci i čuvajte je na
                sigurnom. Istom datotekom podatke možete vratiti ili ih preneti u drugu bazu (npr. sa računara na Supabase).
              </Text>
              <Group gap="xs">
                <Button variant="default" leftSection={<IconDatabaseExport size={16} />} onClick={() => downloadUrl('/api/backup')}>
                  Preuzmi rezervnu kopiju
                </Button>
                <FileButton accept="application/json,.json" onChange={(file) => file && confirmRestore(file)}>
                  {(props) => (
                    <Button {...props} variant="subtle" color="red" leftSection={<IconDatabaseImport size={16} />}>
                      Vrati iz kopije…
                    </Button>
                  )}
                </FileButton>
              </Group>
            </Section>
          </Stack>
        </Grid.Col>
      </Grid>
    </form>
  );
}
