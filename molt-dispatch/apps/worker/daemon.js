const http = require('http');
const shellAdapter = require('../../packages/adapters/shell/index');

const WORKER_ID = 'local-shell-worker-1';
const OWNER_ID = 'system-admin';
const BROKER_URL = 'http://localhost:3000';

function makeRequest(path, method, data) {
  return new Promise((resolve, reject) => {
    const dataString = JSON.stringify(data);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(dataString)
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });

    req.on('error', error => reject(error));
    req.write(dataString);
    req.end();
  });
}

async function register() {
  await makeRequest('/workers/register', 'POST', {
    worker_id: WORKER_ID,
    owner_id: OWNER_ID,
    capabilities: ['code.implementation', 'shell.execute'],
    trust_tier: 2
  });
  console.log('Worker registered');
}

async function poll() {
  try {
    const job = await makeRequest('/jobs/claim', 'POST', {
      worker_id: WORKER_ID,
      available_slots: 1,
      capabilities: ['code.implementation', 'shell.execute'],
      trust_tier: 2
    });

    if (job && job.job_id) {
      console.log(`Claimed job ${job.job_id}`);

      const result = await shellAdapter.executeCommand(job.prompt);

      await makeRequest(`/jobs/${job.job_id}/result`, 'POST', {
        worker_id: WORKER_ID,
        lease_token: job.lease_token,
        status: 'completed',
        summary: result.summary,
        changed_files: result.changed_files
      });

      console.log(`Submitted result for job ${job.job_id}`);
    }
  } catch (err) {
    console.error('Polling error:', err.message);
  }
}

async function startDaemon() {
  await register();
  setInterval(poll, 3000); // Poll every 3 seconds
  console.log('Worker daemon started, polling for jobs...');
}

// Allow module to be run directly or imported
if (require.main === module) {
  startDaemon();
}

module.exports = { startDaemon };
