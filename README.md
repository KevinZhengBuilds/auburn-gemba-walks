# Auburn Gemba Walks

A password-protected page for logging Auburn's Gemba walks: cars past SLA in each zone (Return, Infleet, MQI, Shuttle) on every walk.

- **Site:** GitHub Pages serves `index.html`. It holds no walk data.
- **Data:** a Google Sheet you own. The Apps Script in `apps-script/Code.gs` runs as a web app that reads and writes the Sheet.
- **Password:** stored only in the Apps Script's script properties. The script checks it on every read and write, so the public page shows nothing without it.
- **Same-day lock:** the backend accepts saves and deletes only for today's date, Pacific time. Past walks are locked. To fix an old walk, edit the Walks tab in the Sheet.

## One-time setup (about 5 minutes)

1. Create a new Google Sheet (go to sheets.new) and name it "Auburn Gemba Walks".
2. In the Sheet, open **Extensions > Apps Script**. Delete the starter code, paste in all of `apps-script/Code.gs`, and click Save.
3. Click the gear icon (**Project Settings**). Under **Script properties**, add a property named `GEMBA_PASSWORD` and set its value to the team password.
4. Go back to the editor, pick `setup` in the function dropdown, and click **Run**. Approve the permissions prompt. This creates the Zones and Walks tabs and seeds the 11/9 and 11/11 walks.
5. Click **Deploy > New deployment**. For the type, choose **Web app**. Set **Execute as** to Me and **Who has access** to Anyone, then click **Deploy**.
6. Copy the web app URL (it ends in `/exec`). Paste it into `config.js` as the value of `window.GEMBA_API_URL`, then commit and push.

"Anyone" lets the page reach the script without a Google sign-in. The password check inside the script is what keeps the data private.

## Day-to-day

- **Change the password:** edit `GEMBA_PASSWORD` in Script properties. Everyone gets sent back to the password screen on their next refresh.
- **Add or rename a zone:** edit the Zones tab (`id`, `name`, `sla_hours`, `order`). The script adds a column to the Walks tab the first time someone logs that zone.
- **Update the script:** after editing `Code.gs`, go to **Deploy > Manage deployments**, click the edit icon, choose **New version**, and deploy. The URL stays the same.
