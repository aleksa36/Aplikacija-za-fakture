import { useState } from 'react';
import { Button, Center, Paper, PasswordInput, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconReceipt2 } from '@tabler/icons-react';
import { login } from '../api.ts';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  return (
    <Center mih="100vh" p="md" bg="var(--mantine-color-default-hover)">
      <Paper p="xl" w={360} shadow="sm">
        <form onSubmit={submit}>
          <Stack>
            <Stack gap={4} align="center">
              <ThemeIcon variant="light" size={48} radius="xl">
                <IconReceipt2 size={26} />
              </ThemeIcon>
              <Title order={3}>Fakture i sati</Title>
              <Text size="sm" c="dimmed">
                Unesite lozinku za pristup
              </Text>
            </Stack>
            <PasswordInput
              label="Lozinka"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              error={error}
              autoFocus
              autoComplete="current-password"
            />
            <Button type="submit" loading={loading} disabled={!password}>
              Prijavi se
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
