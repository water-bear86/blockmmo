const crypto = require('crypto');
const db = require('./db');

function generateId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

async function createObjective(title, prompt) {
  const id = generateId('O');
  await db.runQuery(
    `INSERT INTO objectives (id, title, prompt, status, created_by) VALUES (?, ?, ?, ?, ?)`,
    [id, title, prompt, 'pending', 'cli']
  );
  return id;
}

async function createJob(objectiveId, type, title, prompt, capabilityRequired, trustRequired = 1) {
  const id = generateId('J');
  await db.runQuery(
    `INSERT INTO jobs (id, objective_id, type, title, prompt, status, priority, trust_required, capability_required, estimated_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, objectiveId, type, title, prompt, 'queued', 1, trustRequired, capabilityRequired, 15]
  );
  return id;
}

async function registerWorker(workerId, ownerId, capabilities, trustTier) {
  const manifest = JSON.stringify({ capabilities });

  const existing = await db.getQuery(`SELECT id FROM workers WHERE id = ?`, [workerId]);
  if (existing) {
    await db.runQuery(
      `UPDATE workers SET last_heartbeat = CURRENT_TIMESTAMP, status = 'online', manifest_json = ? WHERE id = ?`,
      [manifest, workerId]
    );
  } else {
    await db.runQuery(
      `INSERT INTO workers (id, owner_id, status, last_heartbeat, trust_tier, manifest_json, active_slots, max_slots)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)`,
      [workerId, ownerId, 'online', trustTier, manifest, 0, 1]
    );
  }
}

async function heartbeat(workerId) {
  await db.runQuery(`UPDATE workers SET last_heartbeat = CURRENT_TIMESTAMP WHERE id = ?`, [workerId]);
}

async function claimJob(workerId, capabilities, trustTier) {
  // Simple scheduler: find a queued job that matches capabilities (for now, any capability matches if worker has it)
  // In a real system we'd do complex matching

  const allJobs = await db.allQuery(`SELECT * FROM jobs WHERE status = 'queued' AND trust_required <= ?`, [trustTier]);

  let selectedJob = null;
  for (const job of allJobs) {
    if (capabilities.includes(job.capability_required)) {
      selectedJob = job;
      break;
    }
  }

  if (!selectedJob) return null;

  const leaseToken = crypto.randomBytes(16).toString('hex');
  const assignmentId = generateId('A');

  await db.runQuery(`UPDATE jobs SET status = 'assigned', assigned_worker_id = ? WHERE id = ?`, [workerId, selectedJob.id]);
  await db.runQuery(
    `INSERT INTO assignments (id, job_id, worker_id, status, started_at, lease_token) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
    [assignmentId, selectedJob.id, workerId, 'running', leaseToken]
  );

  return {
    job_id: selectedJob.id,
    lease_token: leaseToken,
    lease_seconds: 1800,
    prompt: selectedJob.prompt,
    type: selectedJob.type
  };
}

async function submitResult(jobId, workerId, leaseToken, summary, files) {
  // Validate lease
  const assignment = await db.getQuery(`SELECT * FROM assignments WHERE job_id = ? AND worker_id = ? AND lease_token = ? AND status = 'running'`, [jobId, workerId, leaseToken]);

  if (!assignment) {
    throw new Error('Invalid lease token or assignment not running');
  }

  await db.runQuery(`UPDATE assignments SET status = 'completed', finished_at = CURRENT_TIMESTAMP WHERE id = ?`, [assignment.id]);
  await db.runQuery(`UPDATE jobs SET status = 'completed' WHERE id = ?`, [jobId]);

  // Record artifacts (mock implementation for phase 0)
  if (files && files.length > 0) {
    for (const file of files) {
       await db.runQuery(
         `INSERT INTO artifacts (id, job_id, worker_id, kind, path) VALUES (?, ?, ?, ?, ?)`,
         [generateId('ART'), jobId, workerId, 'file', file]
       );
    }
  }

  return { success: true };
}

module.exports = {
  createObjective,
  createJob,
  registerWorker,
  heartbeat,
  claimJob,
  submitResult
};
