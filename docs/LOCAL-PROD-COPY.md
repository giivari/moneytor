# Salinan lokal data pengguna (Postgres 18)

Hanya untuk pekerjaan migrasi data pengguna (Tugas 4B). Berisi data pribadi di mesin lokal; dokumen ini tidak memuat data apa pun.
Terpisah dari container tes otomatis (`moneytor-credit-verify`, port 55434), yang hanya untuk fixture sintetis.

- Container `moneytor-prod-copy-18`, image `postgres:18`, hanya `127.0.0.1:55435` (tidak dibuka ke jaringan), volume `moneytor-prod-copy-18-data`.
- Kata sandi bawaan lokal (role `moneytor_local`); jangan dipakai di tempat lain. Database `moneytor_prod_copy`.
- Sumber: `local-data/prod.dump` (pg_dump 18, format custom, gitignored). Restore memakai `pg_restore` 18 di dalam container (dump dipasang read-only di `/d`).
- Skrip dan tes tidak boleh menyentuh Neon; skrip migrasi data pengguna hanya mau jalan ke `127.0.0.1:55435`, DB `moneytor_prod_copy`.

Perintah:

```bash
# buat ulang dari awal
docker volume create moneytor-prod-copy-18-data
docker run -d --name moneytor-prod-copy-18 -p 127.0.0.1:55435:5432 -e POSTGRES_USER=moneytor_local -e POSTGRES_PASSWORD=<kata sandi lokal> \
  -v moneytor-prod-copy-18-data:/var/lib/postgresql -v "<path repo>/local-data:/d:ro" postgres:18
docker exec moneytor-prod-copy-18 psql -U moneytor_local -d postgres -c "CREATE DATABASE moneytor_prod_copy"
docker exec moneytor-prod-copy-18 pg_restore -U moneytor_local -d moneytor_prod_copy --no-owner --no-acl /d/prod.dump
# migrasi skema: DATABASE_URL=postgres://moneytor_local:<kata sandi>@127.0.0.1:55435/moneytor_prod_copy node scripts/migrate.mjs --apply --confirm-db=moneytor_prod_copy

# hentikan
docker stop moneytor-prod-copy-18
# hapus container dan seluruh datanya
docker rm -f moneytor-prod-copy-18 && docker volume rm moneytor-prod-copy-18-data
```

## Cakupan skrip `scripts/user-migrate.mjs`

Hanya memetakan `parent_id` kategori pengguna ke induk katalog, menonaktifkan kategori pengguna yang tidak terpakai, dan membukukan utang awal dari `local-data/opening-debts.csv` bila berisi baris.
Klasifikasi `asset_class`, pembuatan `credit_installments` dari catatan kartu, dan pemecahan akun piutang per orang tidak dikerjakan: inventaris menunjukkan tidak ada data yang memerlukannya
(klasifikasi 015 sudah benar, catatan kartu tanpa entri jadwal, tidak ada transfer ke/dari akun piutang).
Dry-run adalah default; `--apply` wajib `--confirm-db=moneytor_prod_copy`; target hanya `127.0.0.1:55435`.
