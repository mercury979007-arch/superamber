# Deployment

This repository is a source snapshot, not a live service checkout. Keep environment files, school API access, report scripts, Chromium, session stores, student data, logs, and imported schedules outside the repository. Configure the example environment file for your own infrastructure.

Run `npm run install:all` and `NODE_ENV=test npm run verify` before building. The included deployment scripts reflect the original project's release workflow and require local review and configuration before use on another host. Never run them against an existing production service without confirming their paths and service names.
