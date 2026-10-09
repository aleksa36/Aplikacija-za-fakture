# Fakture i sati

Interna aplikacija za evidenciju radnih sati po klijentima, automatska obavezna održavanja, izdavanje faktura i izveštaja o radu u PDF formatu.

## Mogućnosti

- **Klijenti**: podaci za fakturu (adresa, PIB, MB), satnica, valuta (RSD/EUR/USD…), rok plaćanja, jezik fakture (srpski/engleski), napomena na fakturi, boja i arhiviranje.
- **Unos sati**: brz unos (klijent, datum, sati, opis). Sati mogu da se kucaju kao `2,5`, `1:30`, `1h30` ili `90m`, a `Ctrl+Enter` čuva unos. Po potrebi možete zadati posebnu satnicu, paušalni iznos ili označiti unos kao nenaplativ. Stavka koja je već na fakturi se zaključava.
- **Obavezna održavanja**: ponavljajuće stavke (mesečno, kvartalno, godišnje…) koje se **automatski upisuju** na zadati dan u mesecu, kao paušal ili kao sati. U opisu možete koristiti `{mesec}` i `{godina}`. Pauzirano održavanje se po ponovnom uključivanju ne upisuje unazad.
- **Fakture**:
  - automatski povlače sve nefakturisane sate i održavanja za izabrani period;
  - stavke mogu biti grupisane (jedna stavka za sate) ili detaljne (svaki unos posebno);
  - automatsko numerisanje (format se podešava, npr. `{n}/{yyyy}` ili `{yyyy}-{nnn}`);
  - statusi: nacrt → poslata → plaćena (sa datumom uplate), kao i storniranje;
  - stavke se mogu menjati, a pregled PDF-a je dostupan direktno u aplikaciji;
  - podaci o klijentu i izdavaocu čuvaju se kakvi su bili u trenutku izdavanja fakture.
- **PDF**: uredno formatirana faktura sa logom i akcentnom bojom, instrukcijama za plaćanje (dinarski račun ili IBAN/SWIFT za strane valute), PDV-om (ako ste obveznik) i opcionim **izveštajem o radu** kao drugom stranom.
- **Izveštaji**: pregled po periodu i klijentu, PDF izveštaj o radu za klijenta (sa iznosima ili bez njih) i izvoz u CSV koji se otvara u Excel-u.
- **Pregled**: sati ovog meseca, iznos koji još nije fakturisan, fakture koje čekaju uplatu i one kojima je istekao rok, naplaćeno tokom godine.
- **Rezervna kopija**: preuzimanje cele baze jednim klikom (Podešavanja → Rezervna kopija).

## Pokretanje

Potreban je **Node.js 22.13 ili noviji** (zbog ugrađenog `node:sqlite`, pa nije potrebna nikakva posebna baza).

```bash
npm install

# razvoj: frontend na http://localhost:5173, API na :3001
npm run dev

# produkcija: jedan server na http://localhost:3001
npm run build
npm start
```

Pri prvom pokretanju otvorite **Podešavanja** i unesite podatke o firmi, račun i, po želji, logo.

### Podešavanja preko promenljivih okruženja

| Promenljiva    | Podrazumevano | Opis                                                                              |
| -------------- | ------------- | --------------------------------------------------------------------------------- |
| `PORT`         | `3001`        | Port servera                                                                      |
| `HOST`         | `127.0.0.1`   | Za pristup sa drugih uređaja stavite `0.0.0.0` (obavezno uz `APP_PASSWORD`)       |
| `DATA_DIR`     | `./data`      | Folder u kome se nalazi baza `fakture.db`                                         |
| `APP_PASSWORD` | _(prazno)_    | Ako je postavljena, aplikacija traži prijavu (korisnik `APP_USER`, podrazumevano `admin`) |

## Podaci i rezervne kopije

Svi podaci se nalaze u datoteci `data/fakture.db` (SQLite). Za vraćanje podataka iz rezervne kopije zaustavite server i zamenite tu datoteku preuzetom kopijom.

## Struktura projekta

```
server/          Express API, SQLite baza, PDF generisanje (pdfmake)
  db.ts          šema i migracije
  recurring.ts   automatski upis obaveznih održavanja
  invoices.ts    kreiranje faktura i numerisanje
  pdf/           izgled fakture i izveštaja (sr/en)
shared/          tipovi i formatiranje (zajedničko za server i frontend)
src/             React + Mantine frontend
```

## Napomena o e-fakturama (SEF)

Fakture koje izdajete domaćim firmama moraju se izdati i kroz Sistem e-faktura (SEF). PDF iz ove aplikacije tada služi kao prateći dokument ili izveštaj. Za strane klijente PDF faktura je sama faktura.
