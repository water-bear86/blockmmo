const { exec } = require('child_process');

async function executeCommand(prompt) {
  return new Promise((resolve, reject) => {
    // In MVP phase 0, we just echo the prompt to simulate work and create a dummy patch
    const script = `
      echo "Simulating work for prompt: ${prompt}"
      echo "const fakePatch = true;" > artifacts/patch.diff
      echo "Job done."
    `;
    exec(script, { shell: '/bin/bash' }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({
        output: stdout,
        summary: "Simulated task completion via shell adapter",
        changed_files: ["artifacts/patch.diff"]
      });
    });
  });
}

module.exports = {
  executeCommand
};
