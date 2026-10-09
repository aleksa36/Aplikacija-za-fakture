import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { api } from './api.ts';
import { HttpError } from './invoices.ts';
import { syncMaintenance } from './recurring.ts';
import { DB_PATH } from './db.ts';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '127.0.0.1';
const APP_USER = process.env.APP_USER ?? 'admin';
const APP_PASSWORD = process.env.APP_PASSWORD ?? '';

const app = express();
app.disable('x-powered-by');

// Ako je postavljena lozinka (APP_PASSWORD), cela aplikacija traži prijavu (HTTP Basic).
if (APP_PASSWORD) {
  const expected = Buffer.from(`${APP_USER}:${APP_PASSWORD}`);
  const auth: RequestHandler = (req, res, next) => {
    const header = req.headers.authorization ?? '';
    const given = Buffer.from(header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString() : '');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="Fakture", charset="UTF-8"');
    res.status(401).send('Potrebna je prijava.');
  };
  app.use(auth);
}

app.use(express.json({ limit: '5mb' }));
app.use('/api', api);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Nepostojeća ruta.' });
});

// Produkcija: server servira izbildovan frontend iz dist/.
const distDir = path.resolve('dist');
if (existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Greška na serveru: ' + (err instanceof Error ? err.message : String(err)) });
};
app.use(errorHandler);

const created = syncMaintenance();
// Proveri održavanja jednom na sat (za slučaj da aplikacija radi danima bez prekida).
setInterval(() => syncMaintenance(), 60 * 60 * 1000).unref();

app.listen(PORT, HOST, () => {
  console.log(`Fakture API radi na http://${HOST}:${PORT}  (baza: ${DB_PATH})`);
  if (created) console.log(`Automatski upisano održavanja: ${created}`);
  if (!APP_PASSWORD && HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.warn('UPOZORENJE: server je dostupan na mreži bez lozinke. Postavite APP_PASSWORD.');
  }
});
