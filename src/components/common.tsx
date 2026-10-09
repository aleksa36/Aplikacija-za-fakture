import type { ReactNode } from 'react';
import { Badge, Box, ColorSwatch, Group, Paper, Select, Stack, Text, Title, useMantineTheme, type SelectProps } from '@mantine/core';
import { useClients } from '../api.ts';

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-end" mb="lg" wrap="wrap" gap="sm">
      <Box>
        <Title order={2}>{title}</Title>
        {description && (
          <Text c="dimmed" size="sm" mt={4}>
            {description}
          </Text>
        )}
      </Box>
      {actions && <Group gap="xs">{actions}</Group>}
    </Group>
  );
}

export function ClientDot({ color, size = 10 }: { color?: string; size?: number }) {
  const theme = useMantineTheme();
  const c = color && theme.colors[color] ? theme.colors[color][6] : theme.colors.gray[5];
  return <ColorSwatch color={c} size={size} withShadow={false} />;
}

export function ClientBadge({ name, color }: { name?: string; color?: string }) {
  return (
    <Badge variant="light" color={color ?? 'gray'} leftSection={<ClientDot color={color} size={8} />} style={{ textTransform: 'none' }}>
      {name}
    </Badge>
  );
}

type ClientSelectProps = Omit<SelectProps, 'data' | 'value' | 'onChange'> & {
  value: number | null;
  onChange: (id: number | null) => void;
  includeArchived?: boolean;
};

export function ClientSelect({ value, onChange, includeArchived, ...rest }: ClientSelectProps) {
  const clients = useClients();
  const list = (clients.data ?? []).filter((c) => includeArchived || !c.archived || c.id === value);
  const colorById = new Map(list.map((c) => [String(c.id), c.color]));
  return (
    <Select
      searchable
      placeholder="Izaberite klijenta"
      nothingFoundMessage="Nema klijenata"
      data={list.map((c) => ({ value: String(c.id), label: c.archived ? `${c.name} (arhiviran)` : c.name }))}
      value={value ? String(value) : null}
      onChange={(v) => onChange(v ? Number(v) : null)}
      leftSection={value ? <ClientDot color={colorById.get(String(value))} /> : undefined}
      renderOption={({ option }) => (
        <Group gap="xs" wrap="nowrap">
          <ClientDot color={colorById.get(option.value)} />
          <Text size="sm">{option.label}</Text>
        </Group>
      )}
      {...rest}
    />
  );
}

export function StatCard({ label, value, hint, icon, color = 'blue' }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; color?: string }) {
  return (
    <Paper p="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={4}>
          <Text size="xs" tt="uppercase" fw={700} c="dimmed">
            {label}
          </Text>
          <Text fw={700} size="xl" className="num" style={{ textAlign: 'left', whiteSpace: 'normal' }}>
            {value}
          </Text>
          {hint && (
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          )}
        </Stack>
        {icon && (
          <Text c={color} style={{ display: 'flex' }}>
            {icon}
          </Text>
        )}
      </Group>
    </Paper>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <Text c="dimmed" ta="center" py="xl" size="sm">
      {children}
    </Text>
  );
}
