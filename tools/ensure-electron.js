'use strict';
/**
 * 保证脚本跑在真正的 Electron 主进程里。
 * 某些托管环境会设置 ELECTRON_RUN_AS_NODE=1，此时 electron.exe 会退化成纯 Node，
 * require('electron') 只返回可执行文件路径，app 为 undefined。
 * 这里检测到就重新拉起自己（子进程里去掉该变量）。
 */
function ensureElectron() {
  if (process.versions.electron) return true;
  const { spawnSync } = require('child_process');
  const electronPath = require('electron'); // 纯 Node 下返回 exe 路径字符串
  if (typeof electronPath !== 'string') return false;

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const r = spawnSync(electronPath, [process.argv[1], ...process.argv.slice(2)], {
    stdio: 'inherit',
    env
  });
  process.exit(r.status === null ? 1 : r.status);
}

module.exports = { ensureElectron };
