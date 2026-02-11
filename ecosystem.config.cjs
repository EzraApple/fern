module.exports = {
  apps: [
    {
      name: "fern",
      script: "dist/index.js",
      node_args: "--env-file=.env",
      autorestart: true,
      max_restarts: 15,
      min_uptime: "10s",
      restart_delay: 5000,
      error_file: "logs/fern-error.log",
      out_file: "logs/fern-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS",
      merge_logs: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
