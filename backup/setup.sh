#!/bin/bash
# Setup script: cài rclone, đăng ký cron job cho backup bookshelf (postgres1)
# Chạy 1 lần khi setup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================"
echo "  Setup backup bookshelf-server"
echo "========================================"
echo ""

# ============ CHECK .env ============
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo "ERROR: Chưa có file $SCRIPT_DIR/.env"
  echo ""
  echo "Hãy chạy:"
  echo "  cp $SCRIPT_DIR/.env.example $SCRIPT_DIR/.env"
  echo "  nano $SCRIPT_DIR/.env       # điền password và config"
  echo ""
  echo "Rồi chạy lại setup.sh"
  exit 1
fi

set -a
source "$SCRIPT_DIR/.env"
set +a

echo "✓ Tìm thấy .env"

# ============ CHECK DOCKER ============
if ! command -v docker &> /dev/null; then
  echo "ERROR: Docker chưa được cài."
  exit 1
fi

echo ""
echo "Kiểm tra container..."
if docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
  echo "  ✓ $POSTGRES_CONTAINER đang chạy"
else
  echo "  ✗ $POSTGRES_CONTAINER KHÔNG chạy"
  exit 1
fi

# ============ CHECK GITHUB ============
echo ""
echo "Kiểm tra GitHub SSH..."
SSH_OUTPUT=$(ssh -T git@github.com 2>&1 || true)
if echo "$SSH_OUTPUT" | grep -q "successfully authenticated"; then
  echo "✓ SSH GitHub OK"
else
  echo "✗ SSH GitHub chưa OK (nếu đã setup cho project kia thì key có thể tái dùng được)"
  echo "  ssh-keygen -t ed25519 -C 'backup-bookshelf' -f ~/.ssh/id_ed25519_github_bookshelf"
  echo "  cat ~/.ssh/id_ed25519_github_bookshelf.pub"
  echo "  → Thêm vào: GitHub → repo bookshelf-db-backups → Settings → Deploy keys (write access)"
  exit 1
fi

# Clone repo data nếu chưa có
if [ ! -d "$GITHUB_BACKUP_DIR" ]; then
  echo "Clone repo backup ($GITHUB_REPO_SSH)..."
  git clone "$GITHUB_REPO_SSH" "$(dirname "$GITHUB_BACKUP_DIR")"
  echo "✓ Clone xong"
else
  echo "✓ Repo backup đã có tại $GITHUB_BACKUP_DIR"
fi

# ============ CẤP QUYỀN SCRIPT ============
chmod +x "$SCRIPT_DIR/backup.sh" "$SCRIPT_DIR/restore.sh"
echo "✓ Đã cấp quyền execute cho scripts"

# ============ ĐĂNG KÝ CRON ============
echo ""
CRON_LINE="${CRON_MINUTE:-0} ${CRON_HOUR:-4} * * * $SCRIPT_DIR/backup.sh >> $SCRIPT_DIR/backup.log 2>&1"
CRON_PATH="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

EXISTING_CRON=$(crontab -l 2>/dev/null || echo "")

if echo "$EXISTING_CRON" | grep -F "$SCRIPT_DIR/backup.sh" > /dev/null; then
  echo "✓ Cron job đã tồn tại, bỏ qua"
else
  if ! echo "$EXISTING_CRON" | grep -q "^PATH="; then
    NEW_CRON="$CRON_PATH
$EXISTING_CRON
# Backup bookshelf-server postgres1 (added by setup.sh)
$CRON_LINE"
  else
    NEW_CRON="$EXISTING_CRON
# Backup bookshelf-server postgres1 (added by setup.sh)
$CRON_LINE"
  fi
  echo "$NEW_CRON" | crontab -
  echo "✓ Đã đăng ký cron: chạy lúc ${CRON_HOUR:-4}:$(printf '%02d' ${CRON_MINUTE:-0}) hàng ngày"
fi

# ============ DONE ============
echo ""
echo "========================================"
echo "  Setup hoàn tất!"
echo "========================================"
echo ""
echo "Các bước tiếp theo:"
echo ""
echo "1. Chạy thử backup tay 1 lần để verify:"
echo "   $SCRIPT_DIR/backup.sh"
echo ""
echo "2. Xem cron đã đăng ký:"
echo "   crontab -l"
echo ""
echo "3. Theo dõi log:"
echo "   tail -f $SCRIPT_DIR/backup.log"
echo ""
echo "4. Khi cần restore:"
echo "   $SCRIPT_DIR/restore.sh <file> [--from-github|--from-drive]"
echo ""