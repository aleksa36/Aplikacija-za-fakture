// Pokretanje na sopstvenom računaru/serveru (npm run dev / npm start).
import { createApp } from './app.ts';
import { describeDatabase, getDb } from './db.ts';
import { syncMaintenance } from './recurring.ts';

// Učitaj .env ako postoji (DATABASE_URL, APP_PASSWORD…).
try {
  process.loadEnvFile();
} catch {
  /* nema .env datoteke */
}

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '127.0.0.1';

const db = await getDb();
const created = await syncMaintenance(db);
// Proveri održavanja jednom na sat (za slučaj da aplikacija radi danima bez prekida).
setInterval(() => void syncMaintenance(db).catch(console.error), 60 * 60 * 1000).unref();

createApp().listen(PORT, HOST, () => {
  console.log(`Fakture rade na http://${HOST}:${PORT}  (baza: ${describeDatabase()})`);
  if (created) console.log(`Automatski upisano održavanja: ${created}`);
  if (!process.env.APP_PASSWORD && HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.warn('UPOZORENJE: server je dostupan na mreži bez lozinke. Postavite APP_PASSWORD.');
  }
});
