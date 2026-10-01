`npm test` 只运行 `*.test.js` 文件。

手工探测/联调用脚本已经移到 `backend/tools/probes/`，不计入自动化回归。

需要时请显式执行，例如 `node tools/probes/probe-live.js`。
