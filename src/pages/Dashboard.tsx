import { Alert, Button, Grid, Group, Paper, Progress, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconClockHour4, IconCoin, IconFileInvoice, IconPlus, IconReceipt } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { formatDate, formatHours, formatMoney, formatMonth } from '../../shared/format.ts';
import { useDashboard } from '../api.ts';
import { ClientBadge, ClientDot, EmptyState, PageHeader, StatCard } from '../components/common.tsx';
import { moneyList } from '../utils.ts';

export function DashboardPage() {
  const navigate = useNavigate();
  const { data, error } = useDashboard();
  if (error) return <Alert color="red" title="Pregled nije mogao da se učita">{error.message}</Alert>;
  if (!data) return null;

  const maxHours = Math.max(1, ...data.perClient.map((p) => p.hours));
  const diff = data.hoursThisMonth - data.hoursLastMonth;

  return (
    <>
      <PageHeader
        title="Pregled"
        description={`Stanje za ${formatMonth(data.month)}`}
        actions={
          <>
            <Button leftSection={<IconPlus size={16} />} onClick={() => navigate('/sati')}>
              Unesi sate
            </Button>
            <Button variant="default" leftSection={<IconFileInvoice size={16} />} onClick={() => navigate('/fakture/nova')}>
              Nova faktura
            </Button>
          </>
        }
      />

      <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} mb="lg">
        <StatCard
          label="Sati ovog meseca"
          value={`${formatHours(data.hoursThisMonth)} h`}
          hint={`Prošli mesec: ${formatHours(data.hoursLastMonth)} h (${diff >= 0 ? '+' : ''}${formatHours(diff)})`}
          icon={<IconClockHour4 size={22} />}
        />
        <StatCard
          label="Nefakturisano"
          value={moneyList(data.unbilled)}
          hint={`${formatHours(data.unbilledHours)} h čeka fakturisanje`}
          icon={<IconReceipt size={22} />}
          color="orange"
        />
        <StatCard
          label="Čeka uplatu"
          value={moneyList(data.unpaid)}
          hint={
            data.overdueCount ? (
              <Text span c="red" size="xs" fw={600}>
                {data.overdueCount} faktura kasni sa uplatom
              </Text>
            ) : (
              `${data.unpaidCount} poslatih faktura`
            )
          }
          icon={<IconFileInvoice size={22} />}
          color={data.overdueCount ? 'red' : 'blue'}
        />
        <StatCard label="Naplaćeno ove godine" value={moneyList(data.paidThisYear)} icon={<IconCoin size={22} />} color="teal" />
      </SimpleGrid>

      {data.overdueInvoices.length > 0 && (
        <Paper p="md" mb="lg" style={{ borderColor: 'var(--mantine-color-red-5)' }}>
          <Group gap="xs" mb="xs">
            <IconAlertTriangle size={18} color="var(--mantine-color-red-6)" />
            <Title order={5}>Fakture kojima je istekao rok</Title>
          </Group>
          <Table verticalSpacing={6}>
            <Table.Tbody>
              {data.overdueInvoices.map((inv) => (
                <Table.Tr key={inv.id} className="clickable-row" onClick={() => navigate(`/fakture/${inv.id}`)}>
                  <Table.Td fw={600}>{inv.number}</Table.Td>
                  <Table.Td>{inv.client.name}</Table.Td>
                  <Table.Td c="red">rok {formatDate(inv.dueDate)}</Table.Td>
                  <Table.Td className="num" fw={600}>
                    {formatMoney(inv.total, inv.currency)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Paper p="md" h="100%">
            <Title order={5} mb="md">
              Ovaj mesec po klijentima
            </Title>
            {data.perClient.length === 0 ? (
              <EmptyState>Još nema unosa ovog meseca.</EmptyState>
            ) : (
              <Stack gap="md">
                {data.perClient.map((p) => (
                  <div key={p.clientId}>
                    <Group justify="space-between" mb={4}>
                      <Group gap={8}>
                        <ClientDot color={p.color} />
                        <Text size="sm" fw={500}>
                          {p.name}
                        </Text>
                      </Group>
                      <Text size="sm" className="num">
                        <b>{formatHours(p.hours)} h</b> · {formatMoney(p.value, p.currency)}
                      </Text>
                    </Group>
                    <Progress value={(p.hours / maxHours) * 100} color={p.color} size="sm" />
                  </div>
                ))}
              </Stack>
            )}
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Paper p="md" h="100%">
            <Group justify="space-between" mb="xs">
              <Title order={5}>Poslednji unosi</Title>
              <Button variant="subtle" size="compact-sm" onClick={() => navigate('/sati')}>
                Svi unosi
              </Button>
            </Group>
            {data.recentEntries.length === 0 ? (
              <EmptyState>Nema unosa.</EmptyState>
            ) : (
              <Table verticalSpacing={6}>
                <Table.Tbody>
                  {data.recentEntries.map((e) => (
                    <Table.Tr key={e.id}>
                      <Table.Td w={95}>
                        <Text size="xs" c="dimmed">
                          {formatDate(e.date)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <ClientBadge name={e.clientName} color={e.clientColor} />
                        <Text size="sm" lineClamp={1}>
                          {e.description}
                        </Text>
                      </Table.Td>
                      <Table.Td className="num">
                        <Text size="sm" fw={600}>
                          {e.hours ? `${formatHours(e.hours)} h` : formatMoney(e.value ?? 0, e.currency ?? '')}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Paper>
        </Grid.Col>
      </Grid>
    </>
  );
}
