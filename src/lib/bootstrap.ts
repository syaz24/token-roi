import { runMigrations } from '@/db/migrate';
import { seedPricingIfEmpty } from './settings';

let done = false;

/** Idempotent first-boot setup so the app works after a bare `npm run dev`. */
export function bootstrap(): void {
  if (done) return;
  runMigrations();
  seedPricingIfEmpty();
  done = true;
}
