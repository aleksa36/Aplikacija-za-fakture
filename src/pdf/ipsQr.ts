// IPS QR kod (NBS standard) za plaćanje dinarske fakture skeniranjem u m-banking aplikaciji.
// Format: K:PR|V:01|C:1|R:<račun 18 cifara>|N:<primalac>|I:RSD<iznos>|SF:<šifra plaćanja>|S:<svrha>

/** Pretvara račun "160-12345-67" u 18 cifara i proverava kontrolni broj (mod 97). */
export function normalizeAccount(account: string): string | null {
  const clean = account.replace(/\s/g, '');
  const parts = clean.split('-');
  let digits: string;
  if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
    if (parts[0].length !== 3 || parts[2].length !== 2 || parts[1].length > 13) return null;
    digits = parts[0] + parts[1].padStart(13, '0') + parts[2];
  } else {
    digits = clean.replace(/\D/g, '');
  }
  if (!/^\d{18}$/.test(digits)) return null;
  return BigInt(digits) % 97n === 1n ? digits : null;
}

function clean(s: string, max: number): string {
  return s.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

export interface IpsQrInput {
  account: string;
  payeeName: string;
  payeeAddress: string;
  amount: number;
  paymentCode: string;
  purpose: string;
}

export function ipsQrString(input: IpsQrInput): string | null {
  const account = normalizeAccount(input.account);
  if (!account || !(input.amount > 0) || input.amount > 999_999_999_999.99) return null;
  const name = clean(input.payeeName, 70);
  if (!name) return null;
  const address = clean(input.payeeAddress, Math.max(0, 70 - name.length - 2));
  const code = /^[12]\d\d$/.test(input.paymentCode.trim()) ? input.paymentCode.trim() : '221';
  const parts = [
    'K:PR',
    'V:01',
    'C:1',
    `R:${account}`,
    `N:${address ? `${name}\r\n${address}` : name}`,
    `I:RSD${input.amount.toFixed(2).replace('.', ',')}`,
    `SF:${code}`,
  ];
  const purpose = clean(input.purpose, 35);
  if (purpose) parts.push(`S:${purpose}`);
  return parts.join('|');
}
