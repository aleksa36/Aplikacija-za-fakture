// Ulazna tačka. Upozorenje o node:sqlite se utišava pre učitavanja ostatka aplikacije,
// zato se aplikacija učitava dinamički (statički importi bi se izvršili pre ovoga).
import './quiet.ts';

await import('./app.ts');
