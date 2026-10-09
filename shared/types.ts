// Tipovi koje dele server i klijent.

export type Currency = 'RSD' | 'EUR' | 'USD' | 'CHF' | 'GBP';
export const CURRENCIES: Currency[] = ['RSD', 'EUR', 'USD', 'CHF', 'GBP'];

export type Lang = 'sr' | 'en';

export interface Settings {
  companyName: string;
  ownerName: string;
  address: string;
  city: string;
  zip: string;
  country: string;
  pib: string;
  mb: string;
  activityCode: string;
  email: string;
  phone: string;
  website: string;
  bankAccount: string;
  bankName: string;
  iban: string;
  swift: string;
  logo: string; // data URL (PNG/JPEG) ili prazno
  accentColor: string;
  invoiceNumberFormat: string; // npr. "{n}/{yyyy}" ili "{yyyy}-{nnn}"
  defaultPlace: string;
  defaultPaymentDays: number;
  defaultHourlyRate: number;
  defaultCurrency: Currency;
  vatPayer: boolean;
  vatRate: number;
  defaultInvoiceNote: string;
  defaultInvoiceNoteEn: string;
  serviceDescription: string; // opis grupisane stavke na fakturi (sr)
  serviceDescriptionEn: string;
  ipsQr: boolean; // IPS QR kod za plaćanje na dinarskim fakturama
  paymentCode: string; // šifra plaćanja za IPS QR (npr. 221)
}

export interface Client {
  id: number;
  name: string;
  address: string;
  city: string;
  zip: string;
  country: string;
  pib: string;
  mb: string;
  email: string;
  phone: string;
  contactPerson: string;
  hourlyRate: number;
  currency: Currency;
  paymentDays: number;
  language: Lang;
  vatExempt: boolean;
  invoiceNote: string;
  notes: string;
  color: string;
  archived: boolean;
  /** Mesečno održavanje: iznos koji se automatski upisuje svakog meseca (0 = nema). */
  maintenanceAmount: number;
  maintenanceLabel: string;
  /** Prvi mesec održavanja, "YYYY-MM". */
  maintenanceStart: string | null;
  createdAt: string;
  openTodos?: number;
}

export type ClientInput = Omit<Client, 'id' | 'createdAt' | 'openTodos'>;

/** manual = ručni unos (sati ili paušal, od–do), maintenance = mesečno održavanje. */
export type EntryKind = 'manual' | 'maintenance';

export interface Entry {
  id: number;
  clientId: number;
  kind: EntryKind;
  date: string; // YYYY-MM-DD (početak)
  dateTo: string | null; // kraj perioda za ručni unos (ako je duži od jednog dana)
  period: string | null; // "YYYY-MM" za mesečno održavanje
  project: string;
  description: string;
  hours: number;
  rate: number | null; // ako je null koristi se satnica klijenta
  fixedAmount: number | null; // paušalni iznos umesto sati × satnica
  billable: boolean;
  invoiceId: number | null;
  invoiceNumber?: string | null;
  createdAt: string;
  // izračunato na serveru
  effectiveRate?: number;
  value?: number;
  currency?: Currency;
  clientName?: string;
  clientColor?: string;
}

export interface EntryInput {
  kind: EntryKind;
  clientId: number;
  date: string;
  dateTo: string | null;
  period: string | null;
  project: string;
  description: string;
  hours: number;
  rate: number | null;
  fixedAmount: number | null;
}

export interface Todo {
  id: number;
  clientId: number;
  text: string;
  done: boolean;
  createdAt: string;
  doneAt: string | null;
  clientName?: string;
  clientColor?: string;
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'cancelled';

export interface InvoiceItem {
  id?: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount?: number;
}

export interface Invoice {
  id: number;
  number: string;
  year: number;
  seq: number;
  clientId: number;
  issueDate: string;
  serviceDate: string;
  dueDate: string;
  place: string;
  currency: Currency;
  language: Lang;
  vatRate: number;
  notes: string;
  status: InvoiceStatus;
  paidDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  includeReport: boolean;
  client: Client; // snimak klijenta u trenutku izdavanja
  seller: Settings; // snimak podataka izdavaoca
  createdAt: string;
  items: InvoiceItem[];
  subtotal: number;
  vatAmount: number;
  total: number;
  clientName?: string;
  entryCount?: number;
}

export interface InvoiceCreateInput {
  clientId: number;
  number: string;
  issueDate: string;
  serviceDate: string;
  dueDate: string;
  place: string;
  periodFrom: string | null;
  periodTo: string | null;
  entryIds: number[];
  grouping: 'grouped' | 'detailed';
  includeReport: boolean;
  notes: string;
}

export interface InvoiceUpdateInput {
  number: string;
  issueDate: string;
  serviceDate: string;
  dueDate: string;
  place: string;
  notes: string;
  status: InvoiceStatus;
  paidDate: string | null;
  includeReport: boolean;
  vatRate: number;
  items: InvoiceItem[];
}

export interface MoneyByCurrency {
  currency: Currency;
  amount: number;
}

export interface Dashboard {
  month: string;
  hoursThisMonth: number;
  hoursLastMonth: number;
  unbilled: MoneyByCurrency[];
  unbilledHours: number;
  unpaid: MoneyByCurrency[];
  unpaidCount: number;
  overdueCount: number;
  paidThisYear: MoneyByCurrency[];
  perClient: { clientId: number; name: string; color: string; hours: number; value: number; currency: Currency }[];
  recentEntries: Entry[];
  overdueInvoices: Invoice[];
  openTodos: Todo[];
}

export interface StatsRow {
  hours: number;
  value: number;
  currency: Currency;
  entries: number;
}

export interface Stats {
  from: string;
  to: string;
  totalHours: number;
  totalEntries: number;
  value: MoneyByCurrency[];
  invoiced: MoneyByCurrency[];
  byMonth: { month: string; hours: number; byClient: { clientId: number; hours: number }[] }[];
  byClient: (StatsRow & { clientId: number; name: string; color: string })[];
  byProject: (StatsRow & { clientId: number; clientName: string; color: string; project: string; firstDate: string; lastDate: string })[];
}
