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
  createdAt: string;
}

export type ClientInput = Omit<Client, 'id' | 'createdAt'>;

export interface Entry {
  id: number;
  clientId: number;
  date: string; // YYYY-MM-DD
  description: string;
  hours: number;
  rate: number | null; // ako je null koristi se satnica klijenta
  fixedAmount: number | null; // paušalni iznos umesto sati × satnica
  billable: boolean;
  maintenanceId: number | null;
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

export type EntryInput = Pick<
  Entry,
  'clientId' | 'date' | 'description' | 'hours' | 'rate' | 'fixedAmount' | 'billable'
>;

export interface Maintenance {
  id: number;
  clientId: number;
  description: string;
  hours: number;
  fixedAmount: number | null;
  intervalMonths: number; // 1 = mesečno, 3 = kvartalno, 12 = godišnje
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  active: boolean;
  createdAt: string;
  clientName?: string;
  lastPeriod?: string | null;
}

export type MaintenanceInput = Omit<Maintenance, 'id' | 'createdAt' | 'clientName' | 'lastPeriod'>;

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
}
