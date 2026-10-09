# Fakture i sati

Interna aplikacija za evidenciju radnih sati po klijentima, automatska obavezna održavanja, izdavanje faktura i izveštaja o radu u PDF formatu.

Radi na **Netlify-ju sa Supabase bazom**, ali i lokalno na računaru bez ikakve baze.

## Mogućnosti

- **Dve vrste unosa**:
  - **Ručni unos**: klijent, datum ili period (od–do), opcioni projekat i opis, pa **po satima** (bez ograničenja, npr. 120 h) ili **paušalno** (iznos).
  - **Mesečno održavanje**: iznos se podešava kod klijenta i **sam se upisuje svakog meseca** sa naslovom „Mesečno održavanje – oktobar 2026”. Može se dodati i ručno za izabrani mesec, a naslov se popunjava sam.
- **Klijenti**: podaci za fakturu (adresa, PIB, MB), satnica, valuta, rok plaćanja, jezik fakture (srpski/engleski) i mesečno održavanje. Svaki klijent ima svoju stranicu sa **todo listom** (šta treba uraditi), statistikom, projektima i fakturama.
- **Statistika**: sati po mesecima (grafikon i tabela), po klijentima i po projektima, za izabrani period.
- **Fakture**: automatski povlače nefakturisane unose za period, numerišu se automatski, imaju statuse (nacrt → poslata → plaćena) i storno, a stavke se mogu menjati.
- **PDF**: faktura sa logom, instrukcijama za plaćanje, **IPS QR kodom** za dinarske fakture (klijent skenira kod u m-banking aplikaciji), PDV-om (ako ste obveznik) i opcionim izveštajem o radu.
- **Brisanje starih podataka**: fakture i unosi se mogu brisati pojedinačno ili grupno (izbor više stavki). Pri brisanju fakture birate da li se brišu i njeni unosi.
- **Izveštaji**: PDF izveštaj o radu za klijenta i izvoz u CSV za Excel.
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
  recurring.ts       automatski upis mesečnog održavanja
  invoices.ts        kreiranje faktura i numerisanje
netlify/functions/   Netlify funkcija koja pokreće isti Express API
shared/              tipovi i formatiranje (zajedničko za server i frontend)
src/                 React + Mantine frontend
  pdf/               izgled fakture i izveštaja (pdfmake, sr/en), IPS QR kod
```

## Napomena o e-fakturama (SEF)

Fakture koje izdajete domaćim firmama moraju se izdati i kroz Sistem e-faktura (SEF). PDF iz ove aplikacije tada služi kao prateći dokument ili izveštaj. Za strane klijente PDF faktura je sama faktura.
