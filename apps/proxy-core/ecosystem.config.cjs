const path = require('path')

module.exports = {
  apps: [{
    name: 'cc-monitoring',
    script: './apps/proxy-core/dist/server/index.js',
    cwd: path.resolve(__dirname, '../..'),  // Project root directory (two levels up from proxy-core)
    instances: 1,
    exec_mode: 'fork',  // Use fork mode for ESM compatibility
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    env: {
      NODE_ENV: 'production',
      CONFIG_PATH: './config.json',  // Root config.json
      // 注意：PATH 从启动 shell 继承，确保在正确的环境中启动
      // 如果版本信息不正确，执行 pm2 kill 后重启
    },
    env_development: {
      NODE_ENV: 'development',
      CONFIG_PATH: './config.json'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: './logs/error.log',  // Root logs directory
    out_file: './logs/out.log',
    merge_logs: true
  }]
}
