import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';

// Jednostavna prijava jednom lozinkom (APP_PASSWORD). Posle prijave server postavlja
// potpisan HttpOnly kolačić koji važi 30 dana. Promena lozinke poništava sve sesije.

const COOKIE = 'fakture_session';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function password(): string {
  return process.env.APP_PASSWORD ?? '';
}

function secret(): string {
  return `${process.env.SESSION_SECRET ?? 'fakture'}:${password()}`;
}

function sign(expires: number): string {
  return createHmac('sha256', secret()).update(String(expires)).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  // Poređenje heševa jednake dužine, otporno na merenje vremena.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function isAuthenticated(req: Request): boolean {
  if (!password()) return true;
  const value = readCookie(req, COOKIE);
  if (!value) return false;
  const [exp, sig] = value.split('.');
  const expires = Number(exp);
  return Number.isFinite(expires) && expires > Date.now() / 1000 && !!sig && safeEqual(sig, sign(expires));
}

function setCookie(req: Request, res: Response, value: string, maxAge: number) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`,
  );
}

/** Problemi sa podešavanjem zbog kojih aplikacija ne sme da radi (npr. na Netlify-ju bez lozinke). */
export function configProblem(serverless: boolean): string | null {
  if (!serverless) return null;
  if (!process.env.DATABASE_URL) {
    return 'Nije podešena baza. U Netlify podešavanjima (Environment variables) dodajte DATABASE_URL sa Supabase connection string-om.';
  }
  if (!password()) {
    return 'Nije podešena lozinka. U Netlify podešavanjima (Environment variables) dodajte APP_PASSWORD.';
  }
  return null;
}

export function authRoutes(serverless: boolean): Router {
  const router = Router();

  router.get('/session', (req, res) => {
    const problem = configProblem(serverless);
    if (problem) {
      res.status(503).json({ error: problem });
      return;
    }
    res.json({ required: !!password(), authenticated: isAuthenticated(req) });
  });

  router.post('/login', async (req, res) => {
    const given = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password() || safeEqual(given, password())) {
      const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
      setCookie(req, res, `${expires}.${sign(expires)}`, MAX_AGE_SECONDS);
      res.json({ ok: true });
      return;
    }
    // Usporavanje pogađanja lozinke.
    await new Promise((r) => setTimeout(r, 1000));
    res.status(401).json({ error: 'Pogrešna lozinka.' });
  });

  router.post('/logout', (req, res) => {
    setCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  return router;
}

export function requireAuth(serverless: boolean): RequestHandler {
  return (req, res, next) => {
    const problem = configProblem(serverless);
    if (problem) {
      res.status(503).json({ error: problem });
      return;
    }
    if (isAuthenticated(req)) return next();
    res.status(401).json({ error: 'Potrebna je prijava.' });
  };
}
