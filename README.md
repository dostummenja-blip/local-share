# Local Share

The website UI is a static site for GitHub Pages. Your computer runs the Node.js API and temporarily stores files. Devices communicate through that API.

## How it works

1. Open the GitHub Pages site and create a room.
2. The API creates a random room code and a QR link back to the GitHub Pages URL.
3. The second device scans the QR and opens that room.
4. Either device can send text or choose a local file. The file picker opens on the device where the button was pressed. A room can also be joined by typing its code.
5. The file is uploaded to the computer running this server. Once a download finishes, a three-minute timer starts. The server copy is deleted after that. If no one downloads it, it is deleted after 30 minutes. Rooms expire after one hour.

The server cannot delete a copy already downloaded to someone's device. Rooms and transfers are kept in memory, so restarting the server invalidates active rooms. On startup, the app removes files left in its own `uploads/` folder from the previous run.

## Publish the website on GitHub Pages

1. Push `index.html`, `style.css`, `style-extra.css`, `app.js`, and `config.js` to a GitHub repository.
2. In `config.js`, set `window.LOCAL_SHARE_API` to the HTTPS URL that reaches your computer, for example `https://api.example.com`.
3. Enable GitHub Pages for the repository. Set `FRONTEND_URL` on the API server to the exact published page URL, without a trailing slash. For a project site this can be `https://USERNAME.github.io/REPOSITORY`.

## Run the API on your computer

Install Node.js, then open PowerShell in this directory:

```powershell
npm install
```

Set these environment variables before starting it. In PowerShell, for example:

```powershell
$env:FRONTEND_URL = "https://USERNAME.github.io/REPOSITORY"
$env:CORS_ORIGIN = "https://USERNAME.github.io"
npm start
```

For a custom domain, use that site's URL and origin instead. These variables apply only to that PowerShell window.

Options:

- `FRONTEND_URL` — your published GitHub Pages URL.
- `CORS_ORIGIN` — its origin only, such as `https://USERNAME.github.io` (no repository path).
- `PORT` — optional; defaults to `8787`.
- `MAX_FILE_MB` — optional; defaults to `200`.

The API listens on port 8787 on all network interfaces. For access from outside your home, expose it through a secure HTTPS tunnel or configure HTTPS and networking yourself. Point `LOCAL_SHARE_API` in `config.js` at that HTTPS URL. A tunnel keeps the file storage on your computer, but your computer and tunnel must stay running. Do not expose the API over plain HTTP on the public internet.

## Limits and privacy

- This is a starter implementation, not an audited secure file-transfer product.
- The browser-to-server link must use HTTPS for internet access. The server stores uploaded files as ordinary files while they wait to be downloaded; anyone with access to the computer can read them.
- Anyone who gets the room link can join and see or download the room's items. Share it only with the intended recipient.
- The current room and item index is in memory. Do not use it for confidential files until authentication, encryption at rest, rate limits, and restart-safe cleanup are added.
- GitHub Pages hosts only the interface; the transfer server and storage remain on your computer.
