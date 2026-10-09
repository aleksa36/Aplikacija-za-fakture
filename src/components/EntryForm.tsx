import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Collapse, Grid, Group, NumberInput, Text, Textarea, TextInput, UnstyledButton } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconChevronDown, IconChevronRight, IconDeviceFloppy, IconPlus } from '@tabler/icons-react';
import type { Entry, EntryInput } from '../../shared/types.ts';
import { formatHours, formatMoney, today } from '../../shared/format.ts';
import { useClients, useSaveEntry } from '../api.ts';
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

function hoursToText(h: number): string {
  return h ? formatHours(h) : '';
}

interface Props {
  entry?: Entry; // ako postoji, forma je u režimu izmene
  onSaved?: () => void;
  compact?: boolean;
}

export function EntryForm({ entry, onSaved, compact }: Props) {
  const clients = useClients();
  const save = useSaveEntry();
  const hoursRef = useRef<HTMLInputElement>(null);

  const [clientId, setClientId] = useState<number | null>(entry?.clientId ?? readLastClient());
  const [date, setDate] = useState<string | null>(entry?.date ?? today());
  const [hoursText, setHoursText] = useState(entry ? hoursToText(entry.hours) : '');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [billable, setBillable] = useState(entry?.billable ?? true);
  const [rate, setRate] = useState<number | string>(entry?.rate ?? '');
  const [fixedAmount, setFixedAmount] = useState<number | string>(entry?.fixedAmount ?? '');
  const [moreOpen, setMoreOpen] = useState(!!(entry && (entry.rate !== null || entry.fixedAmount !== null)));

  const client = clients.data?.find((c) => c.id === clientId);
  // Ako zapamćeni klijent više ne postoji, poništi izbor.
  useEffect(() => {
    if (clients.data && clientId && !client) setClientId(null);
  }, [clients.data, clientId, client]);

  const hours = parseHours(hoursText);
  const hoursInvalid = hoursText.trim() !== '' && (hours === null || hours < 0 || hours > 24);
  const effectiveRate = rate === '' ? (client?.hourlyRate ?? 0) : Number(rate);
  const value = fixedAmount !== '' ? Number(fixedAmount) : (hours ?? 0) * effectiveRate;

  const canSave = !!clientId && !!date && !hoursInvalid && ((hours ?? 0) > 0 || fixedAmount !== '');

  const submit = () => {
    if (!canSave) return;
    const data: EntryInput = {
      clientId: clientId!,
      date: date!,
      description: description.trim(),
      hours: Math.round((hours ?? 0) * 100) / 100,
      rate: rate === '' ? null : Number(rate),
      fixedAmount: fixedAmount === '' ? null : Number(fixedAmount),
      billable,
    };
    save.mutate(
      { id: entry?.id, data },
      {
        onSuccess: () => {
          try {
            localStorage.setItem(LAST_CLIENT_KEY, String(clientId));
          } catch {
            /* nije bitno */
          }
          if (!entry) {
            setHoursText('');
            setDescription('');
            setFixedAmount('');
            hoursRef.current?.focus();
          }
          onSaved?.();
        },
      },
    );
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={onKeyDown}
    >
      <Grid gutter="sm" align="flex-end">
        <Grid.Col span={{ base: 12, sm: compact ? 12 : 4 }}>
          <ClientSelect label="Klijent" value={clientId} onChange={setClientId} required />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: compact ? 6 : 3 }}>
          <DateInput label="Datum" value={date} onChange={setDate} valueFormat="DD.MM.YYYY." required />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: compact ? 6 : 2 }}>
          <TextInput
            ref={hoursRef}
            label="Sati"
            placeholder="npr. 2,5 ili 1:30"
            value={hoursText}
            onChange={(e) => setHoursText(e.currentTarget.value)}
            error={hoursInvalid ? 'Neispravno' : undefined}
            rightSection={<Text size="xs" c="dimmed">h</Text>}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: compact ? 12 : 3 }}>
          <Text size="sm" c="dimmed" ta={compact ? 'left' : 'right'} pb={6}>
            {client ? (
              <>
                Vrednost: <b>{formatMoney(value || 0, client.currency)}</b>
              </>
            ) : (
              ' '
            )}
          </Text>
        </Grid.Col>
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
        <Grid.Col span={12}>
          <UnstyledButton onClick={() => setMoreOpen((o) => !o)}>
            <Group gap={4}>
              {moreOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              <Text size="sm" c="dimmed">
                Više opcija (druga satnica, paušalni iznos, nenaplativo)
              </Text>
            </Group>
          </UnstyledButton>
          <Collapse in={moreOpen}>
            <Grid gutter="sm" mt="xs" align="flex-end">
              <Grid.Col span={{ base: 6, sm: 4 }}>
                <NumberInput
                  label="Satnica za ovu stavku"
                  placeholder={client ? `${client.hourlyRate} (podrazumevano)` : ''}
                  value={rate}
                  onChange={setRate}
                  min={0}
                  decimalSeparator=","
                  thousandSeparator="."
                  hideControls
                  rightSection={<Text size="xs" c="dimmed">{client?.currency}</Text>}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 4 }}>
                <NumberInput
                  label="Paušalni iznos"
                  description="Umesto sati × satnica"
                  value={fixedAmount}
                  onChange={setFixedAmount}
                  min={0}
                  decimalSeparator=","
                  thousandSeparator="."
                  hideControls
                  rightSection={<Text size="xs" c="dimmed">{client?.currency}</Text>}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4 }}>
                <Checkbox
                  label="Naplativo"
                  description="Nenaplativi sati se ne stavljaju na fakturu"
                  checked={billable}
                  onChange={(e) => setBillable(e.currentTarget.checked)}
                />
              </Grid.Col>
            </Grid>
          </Collapse>
        </Grid.Col>
        <Grid.Col span={12}>
          <Group justify="flex-end">
            <Button
              type="submit"
              loading={save.isPending}
              disabled={!canSave}
              leftSection={entry ? <IconDeviceFloppy size={16} /> : <IconPlus size={16} />}
            >
              {entry ? 'Sačuvaj izmene' : 'Dodaj unos'}
            </Button>
          </Group>
        </Grid.Col>
      </Grid>
    </form>
  );
}
