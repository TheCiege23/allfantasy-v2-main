# Connect the isolated tournament test database

This is for the synthetic 64-manager NBA test. It is separate from the production database. You do not need to send the database password or URL in chat.

1. Open the [Neon Console](https://console.neon.tech/) and select project **`sparkling-mountain-37208979`**. Choose branch **`br-dark-pond-b7eumb0l`** and database **`tournament_pilot`**. If you cannot find this exact project and database, stop and ask for help; do not select the production project.
2. On that project dashboard, click **Connect** and copy its full PostgreSQL connection string. The database portion must be `/tournament_pilot`. Either pooled or direct is accepted by the test wrapper, which verifies the exact pilot endpoint before running.
3. Open [AllFantasy's GitHub Actions secrets settings](https://github.com/TheCiege23/allfantasy-v2-main/settings/secrets/actions). Select **New repository secret**, enter **`TOURNAMENT_PILOT_DATABASE_URL`** as the name, paste the connection string as the value, and save it. Do not place it in source code, a GitHub issue, a PR comment, or this chat.
4. Tell Codex **“The tournament pilot secret is set.”** After the workflow is on `main`, Codex can trigger **Tournament pilot database test** from GitHub Actions and review the result. You can also open **Actions → Tournament pilot database test → Run workflow** yourself.

The workflow passes the secret only as a job environment variable. The test wrapper refuses any URL outside the exact isolated pilot host and database, then runs the existing idempotent synthetic registration/opening-setup test. It does not turn on production tournament scoring or draft release.
