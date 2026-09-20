#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');
const config = require('../src/config');

async function runFile(file) {
  const sql = fs.readFileSync(path.join(config.root, 'db', file), 'utf8');
  await pool.query(sql);
  console.log(`  applied db/${file}`);
}

(async () => {
  console.log(`Migrating database "${config.db.database}" …`);
  try {
    await runFile('schema.sql');
    await runFile('seed.sql');
    console.log('Schema and reference data are ready.');
    console.log('Next: npm run seed   (creates demo accounts and sample listings)');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
