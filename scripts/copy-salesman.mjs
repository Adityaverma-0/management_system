import { cp } from 'node:fs/promises';
await cp(new URL('../salesman-dashboard/dist/', import.meta.url), new URL('../dist/salesman/', import.meta.url), { recursive: true });
