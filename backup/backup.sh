#!/bin/bash
# Backup script: dump book_db (postgres1) → local → upload Drive + GitHub
# Chạy hàng ngày qua cron
set -euo pipefail

# ============ ĐỊNH VỊ ============
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$SCRIPT_DIR/data"

# ============ LOAD CONFIG ============
if [ ! -f "$REPO_ROOT/.env" ]; then
  echo "ERROR: Không tìm thấy file $REPO_ROOT/.env"
  echo "Hãy copy .env.example thành .env và điền thông tin."
  exit 1
fi
set -a
source "$REPO_ROOT/.env"
set +a

DATE=$(date +%F_%H%M)
LOG_PREFIX="[$(date '+%F %T')]"

# ============ KHỞI ĐỘNG ============
mkdir -p "$BACKUP_DIR"
echo "$LOG_PREFIX === Bắt đầu backup bookshelf (book_db) ==="

# ============ POSTGRESQL (postgres1 / book_db) ============
echo "$LOG_PREFIX [Postgres] Đang dump..."
docker exec -e PGPASSWORD="$PG_PASS" "$POSTGRES_CONTAINER" \
  sh -c "exec pg_dump -U $PG_USER -d $PG_DB" \
  | gzip > "$BACKUP_DIR/bookdb_$DATE.sql.gz"
echo "$LOG_PREFIX [Postgres] Done. Size: $(du -h "$BACKUP_DIR/bookdb_$DATE.sql.gz" | cut -f1)"

# ============ PUSH GITHUB ============
echo "$LOG_PREFIX [GitHub] Đang copy & push..."
mkdir -p "$GITHUB_BACKUP_DIR"
cp "$BACKUP_DIR"/*_$DATE.* "$GITHUB_BACKUP_DIR/"
cd "$GITHUB_BACKUP_DIR/.."
git add data/
git commit -m "backup: $DATE"
git push origin main
echo "$LOG_PREFIX [GitHub] Done."

# ============ DỌN FILE CŨ ============
echo "$LOG_PREFIX [Cleanup] Xoá file cũ..."
find "$BACKUP_DIR" -type f -mtime +"$LOCAL_RETENTION_DAYS" -delete
find "$GITHUB_BACKUP_DIR" -type f -name "*.gz" -mtime +"$LOCAL_RETENTION_DAYS" -delete
cd "$GITHUB_BACKUP_DIR/.."
git add data/
git commit -m "cleanup: remove backups older than $LOCAL_RETENTION_DAYS days" --allow-empty
git push origin main
echo "$LOG_PREFIX [Cleanup] Done."

echo "$LOG_PREFIX === Hoàn tất ==="