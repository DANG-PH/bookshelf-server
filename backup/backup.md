# Backup — bookshelf-server (postgres1 / book_db)

Hệ thống backup **riêng biệt** cho project bookshelf, tách khỏi hệ thống backup
của Ngọc Rồng Online. Chỉ push lên GitHub (repo riêng), không dùng Google Drive.

## Cấu trúc
```
bookshelf-server/
└── backup/
    ├── .env              # tự tạo, không commit
    ├── .env.example
    ├── setup.sh
    ├── backup.sh
    ├── restore.sh
    └── data/             # file dump local, tự tạo khi chạy
```

## Cài đặt lần đầu

1. **Copy code này vào VPS**, đặt trong `/root/bookshelf-server/backup/`

2. **Repo GitHub backup:** `git@github.com:DANG-PH/book-db-backups.git`
   (repo trống, Private, đã tạo sẵn)

3. **Tạo file .env:**
   ```bash
   cp .env.example .env
   nano .env
   ```
   Điền:
   ```
   GITHUB_BACKUP_DIR=/root/bookshelf-server/backup/github-data/data
   GITHUB_REPO_SSH=git@github.com:DANG-PH/book-db-backups.git
   ```

4. **Chạy setup:**
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```
   Script sẽ tự kiểm tra SSH key GitHub (dùng lại key cũ nếu đã setup cho
   project Ngọc Rồng — không cần tạo key mới), và tự clone repo backup về.

5. **Test backup tay:**
   ```bash
   ./backup.sh
   ```
   Kiểm tra log, vào repo `book-db-backups` trên GitHub xem file `.sql.gz`
   đã xuất hiện trong thư mục `data/` chưa.

## Restore

```bash
./restore.sh bookdb_2026-08-20_0400.sql.gz                # từ local
./restore.sh bookdb_2026-08-20_0400.sql.gz --from-github   # pull từ GitHub trước
```

## Lưu ý

- Cron chạy **cùng khung giờ** với backup project kia (mặc định 4:00 sáng),
  nhưng là cron job riêng, không đụng job cũ.
- `.env` chứa mật khẩu DB thật — **không commit vào git**.
- `pg_dump -d book_db` dump đúng 1 database, nhẹ và restore không cần quyền superuser.
- Nếu SSH key GitHub cũ (dùng cho Ngọc Rồng) chỉ có quyền ghi vào repo cũ, cần
  thêm key đó làm **Deploy key (write access)** cho repo `book-db-backups` mới,
  hoặc tạo SSH key riêng nếu muốn tách biệt hoàn toàn:
  ```bash
  ssh-keygen -t ed25519 -C "backup-bookshelf" -f ~/.ssh/id_ed25519_bookshelf
  cat ~/.ssh/id_ed25519_bookshelf.pub
  # → dán vào: repo book-db-backups → Settings → Deploy keys → Add deploy key
  #   nhớ tick "Allow write access"
  ```
  Nếu tạo key riêng, thêm vào `~/.ssh/config` để git dùng đúng key khi push:
  ```
  Host github.com-bookshelf
      HostName github.com
      User git
      IdentityFile ~/.ssh/id_ed25519_bookshelf
  ```
  và đổi `GITHUB_REPO_SSH` trong `.env` thành:
  ```
  GITHUB_REPO_SSH=git@github.com-bookshelf:DANG-PH/book-db-backups.git
  ```

### Gợi ý `.gitignore` (nếu thư mục `backup/` nằm trong repo code chính của bookshelf-server)
```
backup/.env
backup/data/
backup/backup.log
backup/github-data/
```