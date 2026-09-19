const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'mess_card.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      scholar_no TEXT UNIQUE NOT NULL,
      name TEXT,
      photo_url TEXT,
      photo_locked INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add photo_locked column if upgrading existing DB
  db.run(`ALTER TABLE users ADD COLUMN photo_locked INTEGER DEFAULT 0`, () => {});

  // Photo change requests (student requests, admin approves/rejects)
  db.run(`
    CREATE TABLE IF NOT EXISTS photo_change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      new_photo_url TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // OTP table
  db.run(`
    CREATE TABLE IF NOT EXISTS otps (
      email TEXT PRIMARY KEY,
      otp TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  // Tokens / Claims table
  // UNIQUE(user_id, meal_slot, claim_date) guarantees no duplicate item claim per slot
  db.run(`
    CREATE TABLE IF NOT EXISTS token_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      meal_slot TEXT NOT NULL,
      claim_date TEXT NOT NULL,
      item_name TEXT NOT NULL,
      status TEXT NOT NULL, -- 'CLAIMED' or 'BURNT'
      claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      burnt_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, meal_slot, claim_date)
    )
  `);

  // Mess Settings table (to allow changing active items like Ice cream, Rasgulla, etc.)
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Default initial settings
  db.run(`
    INSERT OR IGNORE INTO settings (key, value) VALUES ('current_special_item', 'Ice Cream')
  `);

  // Weekly Menu Table (allows Admin to modify any day's menu)
  db.run(`
    CREATE TABLE IF NOT EXISTS weekly_menu (
      day TEXT PRIMARY KEY,
      snacks_items TEXT NOT NULL,       -- JSON array of limited snack items
      dinner_special_items TEXT NOT NULL -- JSON array of limited dinner items
    )
  `);

  const initialMenu = {
    monday: {
      snacks: ['2 Samosa / 2 Kachori', 'Green Chutney'],
      dinner_special: []
    },
    tuesday: {
      snacks: ['Aaloo Tikki Chat'],
      dinner_special: ['Kheer']
    },
    wednesday: {
      snacks: ['Pakora / Bhajiya'],
      dinner_special: ['Custard / Ice Cream']
    },
    thursday: {
      snacks: ['Pani Puri (8 pc)'],
      dinner_special: []
    },
    friday: {
      snacks: ['Chowmin'],
      dinner_special: ['Gulab Jamun']
    },
    saturday: {
      snacks: ['Bhel'],
      dinner_special: ['Fryums']
    },
    sunday: {
      snacks: ['Bada Pao', 'Green Chutney'],
      dinner_special: []
    }
  };

  Object.entries(initialMenu).forEach(([day, menu]) => {
    db.run(
      `INSERT OR IGNORE INTO weekly_menu (day, snacks_items, dinner_special_items) VALUES (?, ?, ?)`,
      [day, JSON.stringify(menu.snacks), JSON.stringify(menu.dinner_special)]
    );
  });
});

module.exports = db;
