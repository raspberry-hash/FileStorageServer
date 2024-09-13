const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./files.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT,
    path TEXT,
    expiration DATE
  )`);
});

module.exports = db;
