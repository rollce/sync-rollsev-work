import { spawn } from 'node:child_process';

const service = process.env.RAILWAY_SERVICE_NAME?.toLowerCase() ?? '';
const port = process.env.PORT ?? '3000';

function run(command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    env: process.env
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

if (service === 'api') {
  run('npm', ['run', 'start', '--workspace', '@sync/api']);
} else if (service === 'web') {
  run('npm', ['run', 'preview', '--workspace', '@sync/web', '--', '--host', '0.0.0.0', '--port', port]);
} else {
  console.error(`Unsupported RAILWAY_SERVICE_NAME: ${service || 'undefined'}`);
  process.exit(1);
}
