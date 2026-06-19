#!/usr/bin/env node

const logic = require('../packages/broker/logic');
const { initDb } = require('../packages/broker/db');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage:');
    console.log('  molt objective create "<title>"');
    console.log('  molt job create --objective <id> --type <type> --capability <capability> "<title>"');
    process.exit(1);
  }

  // Ensure DB is initialized
  initDb();

  // Quick hack to wait for DB tables to create
  await new Promise(resolve => setTimeout(resolve, 500));

  const command = args[0];
  const subcommand = args[1];

  if (command === 'objective' && subcommand === 'create') {
    const title = args[2];
    if (!title) {
      console.error('Missing objective title');
      process.exit(1);
    }
    try {
      const id = await logic.createObjective(title, title);
      console.log(`Created objective: ${id}`);
    } catch (err) {
      console.error('Error:', err.message);
    }
  }
  else if (command === 'job' && subcommand === 'create') {
    // Parse naive args: --objective O-123 --type code.implementation --capability code.typescript "title"
    let objectiveId = null;
    let type = 'general';
    let capability = 'general';
    let title = null;

    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--objective') objectiveId = args[++i];
      else if (args[i] === '--type') type = args[++i];
      else if (args[i] === '--capability') capability = args[++i];
      else title = args[i];
    }

    if (!objectiveId || !title) {
      console.error('Missing required arguments: --objective <id> and title');
      process.exit(1);
    }

    try {
      const id = await logic.createJob(objectiveId, type, title, title, capability);
      console.log(`Created job: ${id}`);
    } catch (err) {
      console.error('Error:', err.message);
    }
  } else {
    console.log('Unknown command');
  }
}

main();
