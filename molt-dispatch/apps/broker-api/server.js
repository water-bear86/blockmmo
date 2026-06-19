const express = require('express');
const cors = require('cors');
const { initDb } = require('../../packages/broker/db');
const logic = require('../../packages/broker/logic');

const app = express();
app.use(express.json());
app.use(cors());

// Initialize DB on startup
initDb();

app.post('/workers/register', async (req, res) => {
  try {
    const { worker_id, owner_id, capabilities, trust_tier } = req.body;
    await logic.registerWorker(worker_id, owner_id, capabilities, trust_tier);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/workers/heartbeat', async (req, res) => {
  try {
    const { worker_id } = req.body;
    await logic.heartbeat(worker_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/jobs/claim', async (req, res) => {
  try {
    const { worker_id, available_slots, capabilities, trust_tier } = req.body;
    const job = await logic.claimJob(worker_id, capabilities, trust_tier);
    if (job) {
      res.json(job);
    } else {
      res.json({ message: 'No jobs available' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/jobs/:id/result', async (req, res) => {
  try {
    const { id } = req.params;
    const { worker_id, lease_token, status, summary, changed_files } = req.body;
    const result = await logic.submitResult(id, worker_id, lease_token, summary, changed_files);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Broker API running on port ${PORT}`);
});
