import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// Generar tipos para tests no requiere cargar .env ni resolver una conexión.
export default defineConfig({ schema: resolve('prisma/schema.prisma') });
