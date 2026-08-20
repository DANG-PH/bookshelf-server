#!/bin/bash
# Restore script cho bookshelf-server (postgres1 / book_db)
# Usage: ./restore.sh <backup_file> [--from-github|--from-drive]
set -euo pipefail

# ============ ĐỊNH VỊ ============
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/data"

# ============ LOAD CONFIG ============
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo "ERROR: Không tìm thấy file $SCRIPT_DIR/.env"
  exit 1
fi
set -a
source "$SCRIPT_DIR/.env"
set +a

FILE="${1:-}"
SOURCE="${2:-}"

if [ -z "$FILE" ]; then
  echo "Usage: $0 <backup_file> [--from-github]"
  echo ""
  echo "Backup có sẵn local trong $BACKUP_DIR:"
  ls -1 "$BACKUP_DIR" 2>/dev/null || echo "  (trống)"
  echo ""
  echo "Ví dụ:"
  echo "  $0 bookdb_2026-08-20_0400.sql.gz"
  echo "  $0 bookdb_2026-08-20_0400.sql.gz --from-github"
  exit 1
fi

# ============ TẢI FILE NẾU CẦN ============
case "$SOURCE" in
  --from-github)
    echo "Đang pull từ GitHub..."
    cd "$GITHUB_BACKUP_DIR/.."
    git pull origin main
    echo "✓ Pull xong"
    if [ -f "$GITHUB_BACKUP_DIR/$FILE" ]; then
      cp "$GITHUB_BACKUP_DIR/$FILE" "$BACKUP_DIR/"
      echo "✓ Copy từ GitHub về local: $FILE"
    else
      echo "Lỗi: không tìm thấy $FILE trong GitHub repo"
      echo "Các file có sẵn:"
      ls -1 "$GITHUB_BACKUP_DIR" 2>/dev/null || echo "  (trống)"
      exit 1
    fi
    ;;
  "")
    ;;
  *)
    echo "Option không hợp lệ: $SOURCE (phải là --from-github hoặc --from-drive)"
    exit 1
    ;;
esac

# ============ TÌM FILE LOCAL ============
if [ ! -f "$FILE" ]; then
  if [ -f "$BACKUP_DIR/$FILE" ]; then
    FILE="$BACKUP_DIR/$FILE"
  else
    echo "Lỗi: không tìm thấy file $FILE"
    echo ""
    echo "Thử tải từ GitHub:"
    echo "  $0 $FILE --from-github"
    exit 1
  fi
fi

# ============ CONFIRM ============
echo ""
echo "Sắp restore book_db (postgres1) từ: $FILE"
echo "⚠️  CẢNH BÁO: Dữ liệu hiện tại trong book_db sẽ bị ghi đè."
read -p "Tiếp tục? (gõ 'yes' để xác nhận): " confirm
if [ "$confirm" != "yes" ]; then
  echo "Đã huỷ."
  exit 0
fi

# ============ RESTORE ============
gunzip < "$FILE" | docker exec -i -e PGPASSWORD="$PG_PASS" "$POSTGRES_CONTAINER" \
  sh -c "exec psql -U $PG_USER -d $PG_DB"

echo "✓ Restore xong."