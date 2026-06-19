const { exec, spawn } = require('child_process');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('Starting broker API...');
  const broker = spawn('node', ['apps/broker-api/server.js'], { cwd: './molt-dispatch', stdio: 'pipe' });

  broker.stdout.on('data', data => console.log(`[Broker]: ${data}`));
  broker.stderr.on('data', data => console.error(`[Broker ERR]: ${data}`));

  await sleep(2000); // Wait for API and DB

  console.log('\nCreating objective...');
  await new Promise((resolve) => {
    exec('node cli/molt.js objective create "Test Objective"', { cwd: './molt-dispatch' }, (err, stdout) => {
      console.log(stdout.trim());

      const objectiveIdMatch = stdout.match(/(O-[a-f0-9]+)/);
      const objectiveId = objectiveIdMatch ? objectiveIdMatch[1] : 'O-mock';

      console.log('\nCreating job...');
      exec(`node cli/molt.js job create --objective ${objectiveId} --type code.implementation --capability shell.execute "Test Job"`, { cwd: './molt-dispatch' }, (err, stdout) => {
        console.log(stdout.trim());
        resolve();
      });
    });
  });

  console.log('\nStarting worker daemon...');
  const worker = spawn('node', ['apps/worker/daemon.js'], { cwd: './molt-dispatch', stdio: 'pipe' });

  worker.stdout.on('data', data => console.log(`[Worker]: ${data}`));
  worker.stderr.on('data', data => console.error(`[Worker ERR]: ${data}`));

  await sleep(5000); // Allow worker to register, poll, execute, and submit

  console.log('\nShutting down processes...');
  worker.kill();
  broker.kill();
  console.log('Test complete.');
}

runTest();
