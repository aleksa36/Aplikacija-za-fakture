// Netlify funkcija: ceo API (Express) radi kao jedna serverless funkcija.
// netlify.toml preusmerava /api/* ovde. Baza je Supabase (DATABASE_URL).
import serverless from 'serverless-http';
import { createApp } from '../../server/app.ts';

export const handler = serverless(createApp({ serverless: true }));
