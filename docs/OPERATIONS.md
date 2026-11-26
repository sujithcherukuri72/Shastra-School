# Operations — deploying and running Shastra Connect

## Server

- **Size:** any Ubuntu 24.04 / 26.04 LTS VPS with 2 vCPU, 4 GB RAM and 40 GB SSD comfortably serves 3,000 students.
  An Indian region such as Mumbai or Hyderabad gives the best latency.
- **DNS:** point an A record for `connect.yourschool.in` at the server.

```bash
# 1. Harden the server
sudo apt update && sudo apt -y upgrade
sudo apt -y install ufw fail2ban unattended-upgrades
sudo ufw default deny incoming && sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp && sudo ufw enable
# Disable SSH password login (keys only)
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && sudo systemctl reload ssh

# 2. Docker Engine + Compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# 3. Get the code and configure it
git clone <your-repo-url> shastra-connect && cd shastra-connect
cp .env.example .env && chmod 600 .env
# Generate secrets (run once per value):
openssl rand -base64 48 | tr -d '\n=/+' ; echo     # for POSTGRES_SUPERUSER_PASSWORD, DB_APP_PASSWORD, SESSION_SECRET, MFA_ENCRYPTION_KEY, WHATSAPP_VERIFY_TOKEN, RAZORPAY_WEBHOOK_SECRET
nano .env   # fill every [YOU] value and set the 4 PRODUCTION SWITCHES (section 1)
npm run preflight -- --online   # needs Node 24+; or: docker run --rm -v $PWD:/app -w /app node:26-alpine node scripts/preflight.mjs --online

# 4. Start everything (database, API, worker, Caddy with HTTPS, nightly backups)
docker compose -f docker-compose.prod.yml --env-file .env up -d --build

# 5. Create the first Principal (prints a one-time password)
docker compose -f docker-compose.prod.yml exec api node src/db/create-principal.ts --email principal@yourschool.in --name "Principal Name"
```

Open `https://connect.yourschool.in`, sign in as the Principal, then:
1. Under **Staff & classes**, add classes, subjects, staff, class teachers and subject teachers.
2. Have the Office import students using **Students → Import CSV**.
3. Have the Office set the fee structure under **Fee setup**.

## Day-to-day

| Task | Command |
| --- | --- |
| Status | `docker compose -f docker-compose.prod.yml ps` |
| Logs | `docker compose -f docker-compose.prod.yml logs -f api worker` |
| Update to a new version | `git pull && docker compose -f docker-compose.prod.yml up -d --build` (migrations run on start) |
| Staff lost phone **and** recovery codes | `docker compose -f docker-compose.prod.yml exec api node src/db/reset-mfa.ts --email person@school.in` |
| Restart | `docker compose -f docker-compose.prod.yml restart api worker` |
| Manual backup | `docker compose -f docker-compose.prod.yml exec backup sh -c 'pg_dump -h db -U $DB_APP_USER -d $DB_NAME -Fc -f /backups/manual.dump'` |
| Restore | `docker compose -f docker-compose.prod.yml exec -T db pg_restore -U postgres -d shastra --clean --if-exists < backups/shastra_YYYY-MM-DD_HHMM.dump` |

**Backups** are written nightly to `./backups` and kept for 14 days. Copy them off the server, for example with a
daily `rclone copy ./backups remote:shastra-backups`, and **test a restore** once per term.

**Uploaded files** (textbooks, worksheets, answer sheets) live in the `storage` Docker volume. Back it up too:
`docker run --rm -v shastra_storage:/s -v $PWD/backups:/b alpine tar czf /b/storage_$(date +%F).tgz -C /s .`

## Pilot rollout (from the overview deck)

1. **Set up.** Load the students, teachers, classes, subjects and fee structure.
2. **Try it with a few classes.** Run it for a month and collect feedback from teachers and parents.
3. **Whole school.** Open it to all 3,000 students, with a short training session for staff.
