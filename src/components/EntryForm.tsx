import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Grid,
  Group,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { DatePickerInput, MonthPickerInput } from '@mantine/dates';
import { IconDeviceFloppy, IconInfoCircle, IconPlus } from '@tabler/icons-react';
import type { Entry, EntryInput, EntryKind } from '../../shared/types.ts';
import { currentPeriod, formatHours, formatMoney, maintenanceTitle, today } from '../../shared/format.ts';
import { notifyOk, useClients, useProjects, useSaveEntry } from '../api.ts';
import { parseHours } from '../utils.ts';
import { ClientSelect } from './common.tsx';

const LAST_CLIENT_KEY = 'fakture:lastClientId';

function readLastClient(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_CLIENT_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

interface Props {
  entry?: Entry; // ako postoji, forma je u režimu izmene
  defaultClientId?: number | null;
  onSaved?: () => void;
  compact?: boolean;
}

export function EntryForm({ entry, defaultClientId, onSaved, compact }: Props) {
  const clients = useClients();
  const save = useSaveEntry();
  const hoursRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<EntryKind>(entry?.kind ?? 'manual');
  const [clientId, setClientId] = useState<number | null>(entry?.clientId ?? defaultClientId ?? readLastClient());
  // Ručni unos
  const [range, setRange] = useState<[string | null, string | null]>([entry?.date ?? today(), entry?.dateTo ?? entry?.date ?? today()]);
  const [mode, setMode] = useState<'hours' | 'fixed'>(entry && entry.kind === 'manual' && entry.fixedAmount !== null ? 'fixed' : 'hours');
  const [hoursText, setHoursText] = useState(entry?.hours ? formatHours(entry.hours) : '');
  const [rate, setRate] = useState<number | string>(entry?.rate ?? '');
  const [amount, setAmount] = useState<number | string>(entry?.fixedAmount ?? '');
  const [project, setProject] = useState(entry?.project ?? '');
  const [description, setDescription] = useState(entry?.description ?? '');
  // Mesečno održavanje
  const [month, setMonth] = useState<string | null>(`${entry?.period ?? currentPeriod()}-01`);
  const [titleTouched, setTitleTouched] = useState(!!entry && entry.kind === 'maintenance');

  const client = clients.data?.find((c) => c.id === clientId);
  const projects = useProjects(clientId);

  useEffect(() => {
    if (clients.data && clientId && !client) setClientId(null);
  }, [clients.data, clientId, client]);

  // Naslov i iznos održavanja se popunjavaju sami dok ih korisnik ne promeni.
  const period = month?.slice(0, 7) ?? null;
  useEffect(() => {
    if (kind !== 'maintenance' || !client || !period || titleTouched) return;
    setDescription(maintenanceTitle(client.maintenanceLabel, period, client.language));
  }, [kind, client, period, titleTouched]);
  // Iznos održavanja se uzima od klijenta (pri izmeni postojećeg unosa ostaje sačuvani iznos).
  useEffect(() => {
    if (!entry && kind === 'maintenance') setAmount(client?.maintenanceAmount || '');
  }, [entry, kind, client?.id, client?.maintenanceAmount]);

  const hours = parseHours(hoursText);
  const hoursInvalid = hoursText.trim() !== '' && (hours === null || hours < 0 || hours > 100000);
  const effectiveRate = rate === '' ? (client?.hourlyRate ?? 0) : Number(rate);
  const value = kind === 'maintenance' || mode === 'fixed' ? Number(amount) || 0 : (hours ?? 0) * effectiveRate;
  const [from, to] = range;

  const canSave =
    !!clientId &&
    (kind === 'maintenance'
      ? !!period && Number(amount) > 0
      : !!from && !hoursInvalid && (mode === 'fixed' ? amount !== '' : (hours ?? 0) > 0));

  const reset = (nextKind: EntryKind = kind) => {
    setHoursText('');
    setDescription('');
    setAmount(nextKind === 'maintenance' ? client?.maintenanceAmount || '' : '');
    setTitleTouched(false);
  };

  const submit = () => {
    if (!canSave) return;
    const data: EntryInput =
      kind === 'maintenance'
        ? {
            kind,
            clientId: clientId!,
            period,
            date: `${period}-01`,
            dateTo: null,
            project: '',
            description: description.trim(),
            hours: 0,
            rate: null,
            fixedAmount: Number(amount),
          }
        : {
            kind,
            clientId: clientId!,
            period: null,
            date: from!,
            dateTo: to && to !== from ? to : null,
            project: project.trim(),
            description: description.trim(),
            hours: mode === 'hours' ? Math.round((hours ?? 0) * 100) / 100 : 0,
            rate: mode === 'hours' && rate !== '' ? Number(rate) : null,
            fixedAmount: mode === 'fixed' ? Number(amount) : null,
          };
    save.mutate(
      { id: entry?.id, data },
      {
        onSuccess: (saved) => {
          try {
            localStorage.setItem(LAST_CLIENT_KEY, String(clientId));
          } catch {
            /* nije bitno */
          }
          notifyOk(entry ? 'Unos je sačuvan.' : `Dodato: ${saved.description || saved.project || 'unos'}`);
          if (!entry) {
            reset();
            hoursRef.current?.focus();
          }
          onSaved?.();
        },
      },
    );
  };

  const half = compact ? 12 : 6;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <Stack gap="sm">
        <SegmentedControl
          value={kind}
          onChange={(v) => {
            setKind(v as EntryKind);
            reset(v as EntryKind);
          }}
          data={[
            { value: 'manual', label: 'Ručni unos' },
            { value: 'maintenance', label: 'Mesečno održavanje' },
          ]}
          disabled={!!entry}
          fullWidth={compact}
          w={compact ? undefined : 'fit-content'}
        />

        <Grid gutter="sm">
          <Grid.Col span={{ base: 12, sm: half }}>
            <ClientSelect label="Klijent" value={clientId} onChange={setClientId} required />
          </Grid.Col>

          {kind === 'maintenance' ? (
            <>
              <Grid.Col span={{ base: 12, sm: half }}>
                <MonthPickerInput label="Mesec" value={month} onChange={setMonth} valueFormat="MMMM YYYY" required />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: compact ? 12 : 8 }}>
                <TextInput
                  label="Naslov"
                  description="Popunjava se sam prema mesecu"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.currentTarget.value);
                    setTitleTouched(true);
                  }}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: compact ? 12 : 4 }}>
                <NumberInput
                  label="Iznos"
                  description={client?.maintenanceAmount ? 'Iz podešavanja klijenta' : ' '}
                  value={amount}
                  onChange={setAmount}
                  min={0}
                  decimalSeparator=","
                  thousandSeparator="."
                  hideControls
                  rightSection={<Text size="xs" c="dimmed">{client?.currency}</Text>}
                  required
                />
              </Grid.Col>
              {client && !client.maintenanceAmount && (
                <Grid.Col span={12}>
                  <Alert color="blue" variant="light" icon={<IconInfoCircle />} p="xs">
                    Ovaj klijent nema podešeno mesečno održavanje. Ako ga podesite kod klijenta, upisivaće se samo svakog meseca.
                  </Alert>
                </Grid.Col>
              )}
            </>
          ) : (
            <>
              <Grid.Col span={{ base: 12, sm: half }}>
                <DatePickerInput
                  type="range"
                  allowSingleDateInRange
                  label="Datum (od – do)"
                  value={range}
                  onChange={setRange}
                  valueFormat="DD.MM.YYYY."
                  required
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: half }}>
                <Autocomplete
                  label="Projekat"
                  placeholder="npr. Web shop (opciono)"
                  data={projects.data ?? []}
                  value={project}
                  onChange={setProject}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: half }}>
                <Text size="sm" fw={500} mb={4}>
                  Naplata
                </Text>
                <SegmentedControl
                  fullWidth
                  value={mode}
                  onChange={(v) => setMode(v as 'hours' | 'fixed')}
                  data={[
                    { value: 'hours', label: 'Po satima' },
                    { value: 'fixed', label: 'Paušalno' },
                  ]}
                />
              </Grid.Col>
              {mode === 'hours' ? (
                <>
                  <Grid.Col span={{ base: 6, sm: compact ? 6 : 3 }}>
                    <TextInput
                      ref={hoursRef}
                      label="Sati"
                      placeholder="npr. 2,5 ili 120"
                      value={hoursText}
                      onChange={(e) => setHoursText(e.currentTarget.value)}
                      error={hoursInvalid ? 'Neispravno' : undefined}
                      rightSection={<Text size="xs" c="dimmed">h</Text>}
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 6, sm: compact ? 6 : 3 }}>
                    <NumberInput
                      label="Satnica"
                      placeholder={client ? String(client.hourlyRate) : ''}
                      value={rate}
                      onChange={setRate}
                      min={0}
                      decimalSeparator=","
                      thousandSeparator="."
                      hideControls
                      rightSection={<Text size="xs" c="dimmed">{client?.currency}</Text>}
                    />
                  </Grid.Col>
                </>
              ) : (
                <Grid.Col span={{ base: 12, sm: compact ? 12 : 6 }}>
                  <NumberInput
                    label="Iznos"
                    value={amount}
                    onChange={setAmount}
                    min={0}
                    decimalSeparator=","
                    thousandSeparator="."
                    hideControls
                    rightSection={<Text size="xs" c="dimmed">{client?.currency}</Text>}
                  />
                </Grid.Col>
              )}
              <Grid.Col span={12}>
                <Textarea
                  label="Opis rada"
                  placeholder="Šta je urađeno… (Ctrl+Enter za čuvanje)"
                  autosize
                  minRows={2}
                  maxRows={6}
                  value={description}
                  onChange={(e) => setDescription(e.currentTarget.value)}
                />
              </Grid.Col>
            </>
          )}
        </Grid>

        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {client && (
              <>
                Vrednost: <b>{formatMoney(value, client.currency)}</b>
              </>
            )}
          </Text>
          <Button
            type="submit"
            loading={save.isPending}
            disabled={!canSave}
            leftSection={entry ? <IconDeviceFloppy size={16} /> : <IconPlus size={16} />}
          >
            {entry ? 'Sačuvaj izmene' : 'Dodaj'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
