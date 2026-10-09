import { useState } from 'react';
import { Group, SegmentedControl, Stack, Table, Text, Tooltip } from '@mantine/core';
import type { Stats } from '../../shared/types.ts';
import { formatHours, formatMonth, MONTHS } from '../../shared/format.ts';
import { ClientDot } from './common.tsx';

/** "Lepa" gornja granica ose (1, 2, 5 × 10^n). */
function niceMax(v: number): number {
  if (v <= 0) return 10;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

interface Props {
  months: Stats['byMonth'];
  clients: Map<number, { name: string; color: string }>;
}

/** Stubičasti grafikon sati po mesecima, sa tabelarnim prikazom kao alternativom. */
export function HoursChart({ months, clients }: Props) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const max = niceMax(Math.max(0, ...months.map((m) => m.hours)));
  const ticks = [0, max / 2, max];
  const peak = months.reduce((best, m) => (m.hours > (best?.hours ?? 0) ? m : best), null as Stats['byMonth'][number] | null);
  const last = months[months.length - 1];

  return (
    <Stack gap="xs">
      <Group justify="flex-end">
        <SegmentedControl
          size="xs"
          value={view}
          onChange={(v) => setView(v as 'chart' | 'table')}
          data={[
            { value: 'chart', label: 'Grafikon' },
            { value: 'table', label: 'Tabela' },
          ]}
        />
      </Group>

      {view === 'chart' ? (
        <div className="hours-chart" role="img" aria-label="Sati po mesecima">
          <div className="hours-chart__axis">
            {ticks.map((t) => (
              <span key={t} style={{ bottom: `${(t / max) * 100}%` }}>
                {formatHours(t)}
              </span>
            ))}
          </div>
          <div className="hours-chart__plot">
            {ticks.map((t) => (
              <div key={t} className="hours-chart__grid" style={{ bottom: `${(t / max) * 100}%` }} />
            ))}
            {months.map((m) => {
              const height = (m.hours / max) * 100;
              // Vrednost se ispisuje samo na najvećem i poslednjem mesecu; ostalo je u tooltipu i tabeli.
              const labeled = m.hours > 0 && (m === peak || m === last);
              return (
                <Tooltip
                  key={m.month}
                  withArrow
                  label={
                    <Stack gap={2}>
                      <Text size="sm" fw={700}>
                        {formatHours(m.hours)} h
                      </Text>
                      <Text size="xs" c="dimmed">
                        {formatMonth(m.month)}
                      </Text>
                      {m.byClient
                        .slice()
                        .sort((a, b) => b.hours - a.hours)
                        .map((c) => (
                          <Group key={c.clientId} gap={6} wrap="nowrap">
                            <ClientDot color={clients.get(c.clientId)?.color} size={8} />
                            <Text size="xs">
                              <b>{formatHours(c.hours)} h</b> {clients.get(c.clientId)?.name}
                            </Text>
                          </Group>
                        ))}
                    </Stack>
                  }
                >
                  <button type="button" className="hours-chart__slot" aria-label={`${formatMonth(m.month)}: ${formatHours(m.hours)} sati`}>
                    {labeled && (
                      <span className="hours-chart__cap" style={{ bottom: `${height}%` }}>
                        {formatHours(m.hours)}
                      </span>
                    )}
                    <div className="hours-chart__bar" style={{ height: `${height}%`, minHeight: m.hours > 0 ? 2 : 0 }} />
                  </button>
                </Tooltip>
              );
            })}
          </div>
          <div className="hours-chart__labels">
            {months.map((m, i) => {
              const [y, mo] = m.month.split('-');
              const showYear = i === 0 || mo === '01';
              return (
                <span key={m.month}>
                  {MONTHS.sr[Number(mo) - 1].slice(0, 3)}
                  {showYear ? ` ${y.slice(2)}` : ''}
                </span>
              );
            })}
          </div>
        </div>
      ) : (
        <Table verticalSpacing={4} striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Mesec</Table.Th>
              <Table.Th className="num">Sati</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {months.map((m) => (
              <Table.Tr key={m.month}>
                <Table.Td>{formatMonth(m.month)}</Table.Td>
                <Table.Td className="num">{formatHours(m.hours)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

/** Tanka traka za poređenje veličina u tabelama. */
export function Meter({ value, max }: { value: number; max: number }) {
  return (
    <div className="meter" aria-hidden>
      <div style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }} />
    </div>
  );
}
