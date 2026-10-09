import { AppShell, Burger, Group, NavLink, Text, ThemeIcon, ActionIcon, useMantineColorScheme, Stack, Alert } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconLayoutDashboard,
  IconClockHour4,
  IconUsers,
  IconRepeat,
  IconFileInvoice,
  IconReportAnalytics,
  IconSettings,
  IconSun,
  IconMoon,
  IconReceipt2,
} from '@tabler/icons-react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { DashboardPage } from './pages/Dashboard.tsx';
import { EntriesPage } from './pages/Entries.tsx';
import { ClientsPage } from './pages/Clients.tsx';
import { MaintenancePage } from './pages/Maintenance.tsx';
import { InvoicesPage } from './pages/Invoices.tsx';
import { InvoiceNewPage } from './pages/InvoiceNew.tsx';
import { InvoiceDetailPage } from './pages/InvoiceDetail.tsx';
import { ReportsPage } from './pages/Reports.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { useSettings } from './api.ts';

const NAV = [
  { to: '/', label: 'Pregled', icon: IconLayoutDashboard },
  { to: '/sati', label: 'Unos sati', icon: IconClockHour4 },
  { to: '/klijenti', label: 'Klijenti', icon: IconUsers },
  { to: '/odrzavanja', label: 'Obavezna održavanja', icon: IconRepeat },
  { to: '/fakture', label: 'Fakture', icon: IconFileInvoice },
  { to: '/izvestaji', label: 'Izveštaji', icon: IconReportAnalytics },
  { to: '/podesavanja', label: 'Podešavanja', icon: IconSettings },
];

export function App() {
  const [opened, { toggle, close }] = useDisclosure();
  const location = useLocation();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const settings = useSettings();
  const missingCompany = settings.data && !settings.data.companyName && !settings.data.ownerName;

  const isActive = (to: string) => (to === '/' ? location.pathname === '/' : location.pathname.startsWith(to));

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <ThemeIcon variant="light" size="lg">
              <IconReceipt2 size={20} />
            </ThemeIcon>
            <Text fw={700}>Fakture i sati</Text>
          </Group>
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Promeni temu"
            onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
          >
            {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
          </ActionIcon>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <Stack gap={2}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              component={Link}
              to={item.to}
              label={item.label}
              className="nav-link"
              leftSection={<item.icon size={18} stroke={1.6} />}
              active={isActive(item.to)}
              onClick={close}
            />
          ))}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        {missingCompany && location.pathname !== '/podesavanja' && (
          <Alert color="yellow" mb="md" title="Dobrodošli!">
            Prvo unesite podatke o svojoj firmi (naziv, PIB, račun...) u{' '}
            <Link to="/podesavanja">Podešavanjima</Link> – oni se prikazuju na fakturama.
          </Alert>
        )}
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/sati" element={<EntriesPage />} />
          <Route path="/klijenti" element={<ClientsPage />} />
          <Route path="/odrzavanja" element={<MaintenancePage />} />
          <Route path="/fakture" element={<InvoicesPage />} />
          <Route path="/fakture/nova" element={<InvoiceNewPage />} />
          <Route path="/fakture/:id" element={<InvoiceDetailPage />} />
          <Route path="/izvestaji" element={<ReportsPage />} />
          <Route path="/podesavanja" element={<SettingsPage />} />
          <Route path="*" element={<Text>Stranica ne postoji.</Text>} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
