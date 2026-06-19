const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../../data/molt.db');
const db = new sqlite3.Database(dbPath);

function initDb() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS objectives (
        id TEXT PRIMARY KEY,
        title TEXT,
        prompt TEXT,
        status TEXT,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        objective_id TEXT,
        type TEXT,
        title TEXT,
        prompt TEXT,
        status TEXT,
        priority INTEGER,
        trust_required INTEGER,
        capability_required TEXT,
        estimated_minutes INTEGER,
        lease_until DATETIME,
        assigned_worker_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY,
        owner_id TEXT,
        status TEXT,
        last_heartbeat DATETIME,
        trust_tier INTEGER,
        manifest_json TEXT,
        active_slots INTEGER,
        max_slots INTEGER
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        worker_id TEXT,
        status TEXT,
        started_at DATETIME,
        finished_at DATETIME,
        lease_token TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        worker_id TEXT,
        kind TEXT,
        path TEXT,
        hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });
}

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = {
  db,
  initDb,
  runQuery,
  getQuery,
  allQuery
};
