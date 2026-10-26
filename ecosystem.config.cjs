module.exports = {
  apps: [
    {
      name: 'brandself-app',
      script: '.output/server/index.mjs',
      instances: 1,
      exec_mode: 'fork',
      // Variables lues depuis .env (DATABASE_URL, REDIS_URL, secrets...) au lancement.
      node_args: '--env-file=.env',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
    {
      name: 'brandself-worker',
      script: 'worker/index.ts',
      interpreter: './node_modules/.bin/tsx',
      instances: 1,
      exec_mode: 'fork',
      // tsx est lancé par node : --env-file charge .env avant le démarrage du worker.
      node_args: '--env-file=.env',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
