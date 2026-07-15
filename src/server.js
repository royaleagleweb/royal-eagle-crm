// Friendly pre-flight checks before loading anything that could crash cryptically.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Royal Eagle CRM needs Node.js 22.13 or newer — you are running ${process.version}.`);
  console.error('Download the LTS version from https://nodejs.org, install it, then run "npm start" again.');
  process.exit(1);
}

const app = require('./app');
const config = require('./config');

const server = app.listen(config.port, () => {
  console.log('Royal Eagle CRM is running.');
  console.log(`Open http://localhost:${config.port} in your browser to log in.`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use by another program.`);
    console.error(`Close that program, or start on a different port:  PORT=3001 npm start`);
    process.exit(1);
  }
  throw err;
});

// Only run the background notification poller when this file is the entry point
// (e.g. `npm start`) — not when it's required, which is how the test suite loads
// src/app.js directly without ever touching src/server.js.
if (require.main === module) {
  const { checkAndNotify } = require('./services/notifier');
  const FIFTEEN_MINUTES = 15 * 60 * 1000;
  setInterval(() => {
    checkAndNotify().catch((err) => console.error('[notifier] checkAndNotify failed:', err.message));
  }, FIFTEEN_MINUTES).unref();
}
