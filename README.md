# IDEA

IDEA is a local-first distribution management application for NFRDI Library Information, Education, and Communication (IEC) exhibits.

It provides:

- A central dashboard for institution-wide and exhibit-specific statistics
- Exhibit session and IEC material management
- A mobile visitor material-request form
- QR-code access to active exhibits
- SQLite-backed distribution records
- Staff, patron, correction, void, and audit history
- XLSX export compatible with the library distribution sheet
- Local storage for uploaded IEC images

## Requirements

- macOS or another supported desktop operating system
- Node.js 22 or newer
- npm
- Devices used by visitors must be able to join the host laptop's local Wi-Fi network

## Installation

From the project directory:

```bash
npm install
```

## Start the application

For development and use at an exhibit:

```bash
npm run dev
```

This starts:

- The visitor and administration interface on port `5173`
- The local API on port `3001`

Open the administration interface on the host laptop:

```text
http://localhost:5173
```

Do not use `localhost` addresses on visitor phones. IDEA generates QR codes using a reachable LAN address.

## Local network setup

1. Connect the host laptop and visitor phones to the same Wi-Fi network.
2. Start IDEA from the project directory.
3. Use the laptop's LAN IPv4 address in the terminal or QR code.
4. Confirm this address is reachable:

```text
http://<laptop-lan-ip>:5173
```

5. Keep the application terminal open during the exhibit.

If a QR code cannot be opened:

- Confirm every device is on the same Wi-Fi network.
- Disable Wi-Fi client isolation or guest-network isolation.
- Allow Node.js and the IDE/Terminal app through the macOS firewall.
- Reopen or regenerate the QR code after network or laptop IP changes.

The QR code endpoint uses `IDEA_PUBLIC_URL` when configured. Otherwise, it selects a LAN IPv4 address automatically.

## Create a staff directory

1. Open **Staff**.
2. Add authorized librarian or distribution staff names.
3. Keep inactive staff out of active exhibit selections.

The staff member assigned to a session is used for every distribution in that session.

## Prepare the IEC catalog

1. Open **IEC catalog**.
2. Select **Add material**.
3. Enter:
   - IEC title
   - Author / Editor
   - Identifying details, if needed
4. Upload a JPG, JPEG, PNG, or WebP image.
5. Replace or remove images later using **Edit material**.
6. Deactivate catalog entries that should no longer be available.

Uploaded images are stored locally and not in SQLite.

## Create an exhibit session

1. Open **Sessions**.
2. Select **Create session**.
3. Enter the event name and optional details.
4. Select exactly one distributor for the session.
5. Select the IEC materials brought and made available for the exhibit.
6. Create the session.

IDEA permits one active exhibit. Creating or activating another session completes the previous active session.

Use **QR code** to display the visitor link. Complete or activate sessions from the session list.

To delete a session, select **Delete** and type `DELETE SESSION` exactly. Deleting a session permanently removes:

- The session
- Its distribution records
- Its distribution entries
- Session-material selections

Unreferenced patron records are removed when possible. Use this action carefully.

## Visitor material requests

Visitors can:

1. Scan the session QR code.
2. Enter their name.
3. Select **Female** or **Male**.
4. Select one or more IEC materials and quantities.
5. Submit the request.

The submit button remains unavailable until a name, sex, and at least one IEC quantity are provided.

Visitor names are normalized before storage:

- `JUAN D. IBARRA`
- `juan d. ibarra`

both become:

- `Juan D. Ibarra`

## Distribution records

Open **Records** to:

- Filter distribution records by session
- Search patron, staff, or IEC information
- Review transaction entries
- Void a distribution with a recorded reason
- Correct a distribution through a new superseding transaction
- Export a session as XLSX

Corrections and voids preserve the original audit trail. Exports contain only active, non-voided distribution entries.

## Dashboard

The dashboard contains:

- Institution-wide totals
- A selectable exhibit overview
- Male and female patron counts and percentages
- Distribution trends
- Most-distributed IEC materials
- Distribution by exhibit
- Distribution by staff
- Recent distribution activity

Sex percentages use patrons with `Male` or `Female` recorded sex as the known-sex denominator.

## Excel export

Session exports preserve these headers:

| Section | Column |
|---|---|
| Event Information | Date Distributed |
| Patron Information | Name |
| Patron Information | Sex |
| IEC Information | Author / Editor |
| IEC Information | No. of Physical Copies Distributed |
| IEC Information | Distributed By |

The `Author / Editor` export column currently contains the IEC material title, while retaining the established institutional column label.

## Local data and backups

Local runtime data is stored outside Git:

| Data | Location |
|---|---|
| SQLite database | `data/idea.sqlite3` |
| Uploaded IEC images | `uploads/` |
| Database backups | `backups/` |

Back up the `data/` and `uploads/` directories together at least once after setup and at the end of each exhibit.

Do not commit:

- `data/`
- `uploads/`
- `backups/`
- Patron records
- Environment files
- Credentials or secrets

## Environment variables

Optional variables:

```bash
PORT=3001
HOST=0.0.0.0
IDEA_DATA_DIR=data
IDEA_UPLOAD_DIR=uploads
IDEA_PUBLIC_URL=http://192.168.1.100:5173
IDEA_PUBLIC_PORT=5173
```

`IDEA_PUBLIC_URL` is useful when a fixed LAN address or a production host is known.

## Development commands

```bash
npm run dev       # Start frontend and API
npm run dev:web   # Start frontend only
npm run dev:api   # Start API only
npm run build     # Type-check and build production frontend
npm run lint      # Run ESLint
npm run preview   # Preview the production frontend
```

For a production-style local run, build the frontend and start the API:

```bash
npm run build
npm run start
```
