/**
 * `npm run db:migrate`
 *
 * Applies migrations and seeds the bundled pricing registry so the database is
 * immediately usable. Kept separate from src/db/migrate.ts, which stays a pure,
 * side-effect-free library module.
 */
import { runMigrations } from '../db/migrate';
import { seedPricingIfEmpty } from '../lib/settings';

const { applied, dbFile } = runMigrations();
console.log(`Database: ${dbFile}`);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.');

const seeded = seedPricingIfEmpty();
console.log(
  seeded
    ? `Pricing: seeded ${seeded} bundled rows (editable in Settings › Pricing).`
    : 'Pricing: already present.',
);
console.log('\nNext: npm run dev   →   http://127.0.0.1:4783');
