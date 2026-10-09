import express, { type ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { api } from './api.ts';
import { authRoutes, requireAuth } from './auth.ts';
import { HttpError } from './invoices.ts';

export interface AppOptions {
  /** true na Netlify-ju: obavezni DATABASE_URL i APP_PASSWORD, bez serviranja frontenda. */
  serverless?: boolean;
}

export function createApp({ serverless = false }: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '5mb' }));
  // Na Netlify-ju (serverless-http) telo zahteva stiže kao gotov Buffer koji express.json() preskače.
  app.use((req, _res, next) => {
    if (!Buffer.isBuffer(req.body)) return next();
    const text = req.body.toString('utf8');
    try {
      req.body = text && /json/i.test(req.headers['content-type'] ?? '') ? JSON.parse(text) : {};
    } catch {
      return next(new HttpError(400, 'Neispravan JSON u zahtevu.'));
    }
    next();
  });

  const apiRouter = express.Router();
  apiRouter.use(authRoutes(serverless));
  apiRouter.use(requireAuth(serverless));
  apiRouter.use(api);
  apiRouter.use((_req, res) => {
    res.status(404).json({ error: 'Nepostojeća ruta.' });
  });
  // Netlify prosleđuje /api/* funkciji; za svaki slučaj prihvatamo i njenu internu putanju.
  app.use(['/api', '/.netlify/functions/api'], apiRouter);

  // Lokalno/produkcija na sopstvenom serveru: servira se izbildovan frontend iz dist/.
  const distDir = path.resolve('dist');
  if (!serverless && existsSync(path.join(distDir, 'index.html'))) {
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
  return app;
}
