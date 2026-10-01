# Super Amber

Super Amber is a web toolkit for class seating, schedules, daily reports, and related teacher workflows. This repository contains the application source. It is a clean public snapshot; the private production repository and its Git history are not included.

## Run locally

Requirements: Node.js, npm, and Python 3 with `openpyxl` for the workbook export tests. Browser-based exports also need a compatible Chromium installation.

```bash
npm run install:all
NODE_ENV=test npm run verify
```

For local development, copy `config/runtime.env.example` to a file outside the repository and replace the example values. Start the API with `node --env-file=/absolute/private/runtime.env backend/server.js`, then start the Vite frontend with `npm --prefix frontend run dev`. The default school API host is deliberately invalid; configure `CNFADMIN_BASE_URL` only for a service you are authorized to access.

## Data boundaries

No production credentials, tokens, sessions, student rosters, class schedules, reports, imported workbooks, runtime logs, or private camp content belong in Git. The public build contains an empty schedule manifest and generic camp content. Import your own data through the application or supply private deployment data outside this repository. The neutral illustration stands in for organization-owned brand art.

The backend integrations for school data and report exports require organization-specific configuration and external report scripts. Without those, local use is limited to flows that do not depend on those integrations.

## License and security

Application code: MIT. Bundled Smiley Sans font files have a separate SIL Open Font License 1.1; see `third_party/smiley-sans/LICENSE`. The application license does not grant rights to third-party brands or curriculum that are not in this repository.

See `SECURITY.md` for reporting and dependency status.
