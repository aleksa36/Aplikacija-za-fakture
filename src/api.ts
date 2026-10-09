import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { queryClient } from './queryClient.ts';
import type {
  Client,
  ClientInput,
  Dashboard,
  Entry,
  EntryInput,
  Invoice,
  InvoiceCreateInput,
  InvoiceStatus,
  InvoiceUpdateInput,
  Maintenance,
  MaintenanceInput,
  Settings,
} from '../shared/types.ts';

/** Greška kada je sesija istekla ili korisnik nije prijavljen. */
export class AuthError extends Error {}

export async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (res.status === 401 && path !== '/login') {
    // Sesija je istekla: ponovo proveri stanje prijave, aplikacija će prikazati ekran za prijavu.
    void queryClient.invalidateQueries({ queryKey: ['session'] });
    throw new AuthError('Potrebna je prijava.');
  }
  if (!res.ok || data === null) {
    const message = (data as { error?: string } | null)?.error;
    throw new Error(
      message ??
        (res.status === 404
          ? 'API nije dostupan (404). Proverite da li server/Netlify funkcija radi.'
          : `Greška ${res.status}`),
    );
  }
  return data as T;
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '' || v === false) continue;
    sp.set(k, v === true ? '1' : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function notifyError(err: unknown) {
  if (err instanceof AuthError) return;
  notifications.show({ color: 'red', title: 'Greška', message: err instanceof Error ? err.message : String(err) });
}

export function notifyOk(message: string) {
  notifications.show({ color: 'teal', message });
}

// ---------- Upiti ----------

export interface Session {
  required: boolean;
  authenticated: boolean;
}

export const useSession = () =>
  useQuery({ queryKey: ['session'], queryFn: () => request<Session>('/session'), retry: false, staleTime: 60_000 });

export async function login(password: string) {
  await request('/login', { method: 'POST', body: { password } });
  await queryClient.resetQueries();
}

export async function logout() {
  await request('/logout', { method: 'POST', body: {} });
  // Prvo prikaži ekran za prijavu, pa tek onda obriši keširane podatke (bez nepotrebnih 401 zahteva).
  queryClient.setQueryData<Session>(['session'], (s) => ({ required: s?.required ?? true, authenticated: false }));
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
}

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => request<Settings>('/settings') });

export const useClients = () => useQuery({ queryKey: ['clients'], queryFn: () => request<Client[]>('/clients') });

export interface EntryFilter {
  clientId?: number | null;
  from?: string | null;
  to?: string | null;
  unbilled?: boolean;
  search?: string;
}

export const useEntries = (filter: EntryFilter, enabled = true) =>
  useQuery({
    queryKey: ['entries', filter],
    queryFn: () => request<Entry[]>(`/entries${qs({ ...filter })}`),
    enabled,
  });

export const useMaintenance = () =>
  useQuery({ queryKey: ['maintenance'], queryFn: () => request<Maintenance[]>('/maintenance') });

export const useInvoices = (filter: { clientId?: number | null; status?: string | null; year?: number | null }) =>
  useQuery({ queryKey: ['invoices', filter], queryFn: () => request<Invoice[]>(`/invoices${qs(filter)}`) });

export type InvoiceWithEntries = Invoice & { entries: Entry[] };

export const useInvoice = (id: number) =>
  useQuery({ queryKey: ['invoice', id], queryFn: () => request<InvoiceWithEntries>(`/invoices/${id}`) });

export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => request<Dashboard>('/dashboard') });

// ---------- Izmene ----------

/** Posle svake izmene osvežavamo sve upite – aplikacija je mala pa je to najjednostavnije i najsigurnije. */
function useApiMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>, success?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries();
      if (success) notifyOk(success);
    },
    onError: notifyError,
  });
}

export const useSaveSettings = () =>
  useApiMutation((s: Partial<Settings>) => request<Settings>('/settings', { method: 'PUT', body: s }), 'Podešavanja su sačuvana.');

export const useSaveClient = () =>
  useApiMutation(
    ({ id, data }: { id?: number; data: ClientInput }) =>
      request<Client>(id ? `/clients/${id}` : '/clients', { method: id ? 'PUT' : 'POST', body: data }),
    'Klijent je sačuvan.',
  );

export const useDeleteClient = () =>
  useApiMutation((id: number) => request<void>(`/clients/${id}`, { method: 'DELETE' }), 'Klijent je obrisan.');

export const useSaveEntry = () =>
  useApiMutation(({ id, data }: { id?: number; data: EntryInput }) =>
    request<Entry>(id ? `/entries/${id}` : '/entries', { method: id ? 'PUT' : 'POST', body: data }),
  );

export const useDeleteEntry = () =>
  useApiMutation((id: number) => request<void>(`/entries/${id}`, { method: 'DELETE' }), 'Stavka je obrisana.');

export const useSaveMaintenance = () =>
  useApiMutation(({ id, data }: { id?: number; data: MaintenanceInput }) =>
    request<Maintenance & { createdEntries: number }>(id ? `/maintenance/${id}` : '/maintenance', {
      method: id ? 'PUT' : 'POST',
      body: data,
    }),
  );

export const useDeleteMaintenance = () =>
  useApiMutation((id: number) => request<void>(`/maintenance/${id}`, { method: 'DELETE' }), 'Održavanje je obrisano.');

export const useCreateInvoice = () =>
  useApiMutation((data: InvoiceCreateInput) => request<Invoice>('/invoices', { method: 'POST', body: data }), 'Faktura je kreirana.');

export const useUpdateInvoice = () =>
  useApiMutation(
    ({ id, data }: { id: number; data: InvoiceUpdateInput }) => request<Invoice>(`/invoices/${id}`, { method: 'PUT', body: data }),
    'Faktura je sačuvana.',
  );

export const useInvoiceStatus = () =>
  useApiMutation(({ id, status }: { id: number; status: InvoiceStatus }) =>
    request<Invoice>(`/invoices/${id}/status`, { method: 'PATCH', body: { status } }),
  );

export const useDeleteInvoice = () =>
  useApiMutation((id: number) => request<void>(`/invoices/${id}`, { method: 'DELETE' }), 'Faktura je obrisana.');
