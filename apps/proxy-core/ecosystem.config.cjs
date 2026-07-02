const path = require('path')
const os = require('os')

// 统一数据目录：与 src/utils/paths.ts 保持一致（~/.cc-monitoring）
const dataDir = process.env.CC_DATA_DIR || path.join(os.homedir(), '.cc-monitoring')
const logsDir = path.join(dataDir, 'logs')
const configPath = process.env.CONFIG_PATH || path.join(dataDir, 'config.json')

module.exports = {
  apps: [{
    name: 'cc-monitoring',
    script: path.join(__dirname, 'dist/server/index.js'),  // 包内绝对路径，不依赖 cwd
    cwd: dataDir,  // 数据目录
    instances: 1,
    exec_mode: 'fork',  // Use fork mode for ESM compatibility
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    env: {
      NODE_ENV: 'production',
      CONFIG_PATH: configPath,
      // 注意：PATH 从启动 shell 继承，确保在正确的环境中启动
      // 如果版本信息不正确，执行 pm2 kill 后重启
    },
    env_development: {
      NODE_ENV: 'development',
      CONFIG_PATH: configPath
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: path.join(logsDir, 'error.log'),
    out_file: path.join(logsDir, 'out.log'),
    merge_logs: true
  }]
}
