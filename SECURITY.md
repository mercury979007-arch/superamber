# Security

Do not commit credentials, tokens, environment files, student data, report exports, session stores, logs, or private schedules. Use environment variables and private runtime storage. `config/runtime.env.example` contains placeholders only.

The public release is built from a fresh source snapshot so prior private commits are not exposed. A secret scan of the private source history and the public snapshot should be repeated before each release. The source scan does not inspect secrets held outside Git; rotate any credential known to have been shared elsewhere.

Known dependency advisories remain in the pinned `xlsx` package and Puppeteer-related packages. `npm audit fix` reduced other advisories, but do not treat the remaining results as cleared. Review them before exposing an installation to untrusted users and test any dependency replacement against workbook import/export and browser rendering.

Please report suspected vulnerabilities privately to the repository owner rather than posting credentials or exploit details in a public issue.
