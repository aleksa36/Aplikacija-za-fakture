# Fakture i sati

Interna aplikacija za evidenciju radnih sati po klijentima, automatska obavezna održavanja, izdavanje faktura i izveštaja o radu u PDF formatu.

Radi na **Netlify-ju sa Supabase bazom**, ali i lokalno na računaru bez ikakve baze.

## Mogućnosti

- **Klijenti**: podaci za fakturu (adresa, PIB, MB), satnica, valuta (RSD/EUR/USD…), rok plaćanja, jezik fakture (srpski/engleski), napomena na fakturi, boja i arhiviranje.
- **Unos sati**: brz unos (klijent, datum, sati, opis). Sati mogu da se kucaju kao `2,5`, `1:30`, `1h30` ili `90m`, a `Ctrl+Enter` čuva unos. Po potrebi možete zadati posebnu satnicu, paušalni iznos ili označiti unos kao nenaplativ. Stavka koja je već na fakturi se zaključava.
- **Obavezna održavanja**: ponavljajuće stavke (mesečno, kvartalno, godišnje…) koje se **automatski upisuju** na zadati dan u mesecu, kao paušal ili kao sati. U opisu možete koristiti `{mesec}` i `{godina}`.
- **Fakture**: automatski povlače nefakturisane sate i održavanja za izabrani period, numerišu se automatski (format se podešava), imaju statuse (nacrt → poslata → plaćena), mogu se stornirati, a stavke se mogu menjati.
- **PDF**: faktura sa logom i akcentnom bojom, instrukcijama za plaćanje (dinarski račun ili IBAN/SWIFT za strane valute), PDV-om (ako ste obveznik) i opcionim **izveštajem o radu** kao drugom stranom. PDF se pravi direktno u browseru.
- **Izveštaji**: pregled po periodu i klijentu, PDF izveštaj o radu za klijenta i izvoz u CSV za Excel.
- **Pregled**: sati ovog meseca, nefakturisano, neplaćene fakture i one kojima je istekao rok, naplaćeno tokom godine.
- **Prijava lozinkom** i **rezervna kopija** (izvoz i uvoz svih podataka u JSON datoteci).

## Postavljanje na Netlify + Supabase

### 1. Supabase baza

1. Na [supabase.com](https://supabase.com) otvorite projekat (besplatan plan je dovoljan).
2. Kliknite **Connect** (gore na stranici projekta) → **Connection string** → izaberite **Transaction pooler** (port `6543`).
   Ne koristite „Direct connection”: ona radi samo preko IPv6, a Netlify je ne može dohvatiti.
3. Kopirajte string i zamenite `[YOUR-PASSWORD]` lozinkom baze (Project Settings → Database → Reset database password ako je ne znate).
   Ako lozinka sadrži posebne znakove (`@`, `#`, `/`…), najlakše je postaviti novu lozinku sa samo slovima i brojevima.

Tabele **ne treba praviti ručno**: aplikacija ih kreira sama pri prvom pokretanju.

### 2. Netlify

1. U Netlify-ju: **Site configuration → Environment variables** dodajte:
   - `DATABASE_URL`: string iz koraka 1;
   - `APP_PASSWORD`: lozinka kojom ćete ulaziti u aplikaciju (izaberite jaku lozinku jer je adresa javna).
2. Pokrenite ponovni deploy (**Deploys → Trigger deploy**). Build komanda, `dist` folder i funkcija su već podešeni u `netlify.toml`.

API radi kao Netlify funkcija (`netlify/functions/api.ts`), a `/api/*` se automatski preusmerava na nju.

> Supabase besplatni projekti se pauziraju posle nedelju dana bez korišćenja. Ako se aplikacija ne učitava, uđite na supabase.com i kliknite „Restore project”.

## Lokalno pokretanje

Potreban je **Node.js 20.12 ili noviji**.

```bash
npm install
npm run dev          # http://localhost:5173
```

Bez `DATABASE_URL` aplikacija lokalno koristi ugrađenu bazu (PGlite) u folderu `data/`, pa ništa ne treba instalirati. Da biste lokalno radili sa Supabase bazom, kopirajte `.env.example` u `.env` i popunite ga.

Produkcija na sopstvenom serveru: `npm run build && npm start` (http://localhost:3001).

| Promenljiva    | Opis                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- |
| `DATABASE_URL` | Postgres/Supabase baza. Ako je prazna, koristi se lokalni PGlite u `DATA_DIR/pglite`. |
| `APP_PASSWORD` | Lozinka za ulazak. Obavezna na Netlify-ju; lokalno opciona.                           |
| `PORT`, `HOST` | Lokalni server (podrazumevano `127.0.0.1:3001`).                                      |
| `DATA_DIR`     | Folder za lokalnu bazu (podrazumevano `./data`).                                      |

## Rezervne kopije i prenos podataka

**Podešavanja → Rezervna kopija** preuzima sve podatke u jednoj JSON datoteci. Istom datotekom (**Vrati iz kopije…**) podaci se vraćaju ili prenose iz jedne baze u drugu, npr. sa lokalnog računara na Supabase.

## Struktura projekta

```
server/              Express API i baza (Postgres preko postgres.js ili PGlite)
  db.ts              konekcija, migracije, izvoz/uvoz
  auth.ts            prijava lozinkom (potpisan kolačić)
  recurring.ts       automatski upis obaveznih održavanja
  invoices.ts        kreiranje faktura i numerisanje
netlify/functions/   Netlify funkcija koja pokreće isti Express API
shared/              tipovi i formatiranje (zajedničko za server i frontend)
src/                 React + Mantine frontend
  pdf/               izgled fakture i izveštaja (pdfmake, sr/en)
```

## Napomena o e-fakturama (SEF)

Fakture koje izdajete domaćim firmama moraju se izdati i kroz Sistem e-faktura (SEF). PDF iz ove aplikacije tada služi kao prateći dokument ili izveštaj. Za strane klijente PDF faktura je sama faktura.
