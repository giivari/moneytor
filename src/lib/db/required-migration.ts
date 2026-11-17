/** Migrasi terbaru yang dibutuhkan kode. /api/health melaporkan "incomplete" bila belum terpasang; tests/health-migration.test.mjs menjaga nilainya. */
export const REQUIRED_MIGRATION = "025_read_path_indexes.sql";
