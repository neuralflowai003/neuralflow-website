const https = require('https');

const url = 'https://neuralflowai.io/api/availability';

const req = https.get(url, { timeout: 10000 }, (res) => {
  if (res.statusCode === 200) {
    process.exit(0); // OK
  } else {
    console.error(`Site down — status ${res.statusCode}`);
    process.exit(1);
  }
});

req.on('error', (e) => {
  console.error(`Site unreachable: ${e.message}`);
  process.exit(1);
});

req.on('timeout', () => {
  console.error('Site timeout');
  req.destroy();
  process.exit(1);
});
