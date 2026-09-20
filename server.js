require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const db = require('./database');
const { getMealSlot, getTodayDateString } = require('./slots');
const { sendOtpEmail, initTransporter, testSmtpConnection, getLastDispatchInfo } = require('./mailer');
const { getMenuForDayFromDb, getAllWeeklyMenuFromDb, getDayName, DAYS } = require('./menu');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage for student profile photos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `student_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// 1. AUTHENTICATION & OTP ENDPOINTS
// -------------------------------------------------------------

// Strict MANIT student credential validation (Format: <scholar_no>@stu.manit.ac.in)
function validateManitCredentials(scholar_no, email) {
  const cleanScholar = (scholar_no || '').toString().trim();
  const cleanEmail = (email || '').toString().trim().toLowerCase();

  if (!cleanScholar) {
    return { valid: false, error: 'MANIT Scholar Number is required.' };
  }

  // Scholar Number must be 8 to 12 digits (e.g. 26112011312)
  if (!/^\d{8,12}$/.test(cleanScholar)) {
    return {
      valid: false,
      error: 'Invalid Scholar Number. Must be your 8 to 12 digit MANIT Scholar Number (e.g. 26112011312).'
    };
  }

  // Official student email must strictly be <scholar_no>@stu.manit.ac.in
  const expectedEmail = `${cleanScholar}@stu.manit.ac.in`;
  if (cleanEmail !== expectedEmail) {
    return {
      valid: false,
      error: `Invalid Student ID. For Scholar Number ${cleanScholar}, institutional email must be ${expectedEmail}. No fake IDs or personal emails are allowed.`
    };
  }

  return { valid: true, cleanScholar, cleanEmail };
}

// Step 1: Request OTP
app.post('/api/auth/request-otp', (req, res) => {
  const { email, scholar_no } = req.body;

  const validation = validateManitCredentials(scholar_no, email);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const { cleanScholar, cleanEmail } = validation;

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  // Store in DB
  db.run(
    `INSERT INTO otps (email, otp, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET otp = excluded.otp, expires_at = excluded.expires_at`,
    [cleanEmail, otp, expiresAt],
    async (err) => {
      if (err) {
        return res.status(500).json({ error: 'Database error generating OTP.' });
      }

      // Check if user exists or check scholar consistency
      db.get(`SELECT * FROM users WHERE email = ?`, [cleanEmail], async (userErr, existingUser) => {
        if (existingUser && existingUser.scholar_no !== cleanScholar) {
          return res.status(400).json({ error: 'This email is already registered with a different Scholar Number.' });
        }

        // Trigger email dispatch in background for lightning-fast UI response
        sendOtpEmail(cleanEmail, otp).catch((mailErr) => {
          console.error('[BACKGROUND EMAIL ERROR]:', mailErr.message);
        });

        return res.json({
          success: true,
          message: `OTP sent successfully to ${cleanEmail}. Please check your inbox.`
        });
      });
    }
  );
});

// Step 2: Verify OTP and Login / Register
app.post('/api/auth/verify-otp', (req, res) => {
  const { email, scholar_no, otp } = req.body;

  if (!otp) {
    return res.status(400).json({ error: 'Verification OTP code is required.' });
  }

  const validation = validateManitCredentials(scholar_no, email);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const { cleanScholar, cleanEmail } = validation;
  const cleanOtp = otp.toString().trim();

  db.get(`SELECT * FROM otps WHERE email = ?`, [cleanEmail], (err, row) => {
    if (err || !row) {
      return res.status(400).json({ error: 'No OTP requested for this email.' });
    }

    if (Date.now() > row.expires_at) {
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }

    if (row.otp !== cleanOtp) {
      return res.status(400).json({ error: 'Invalid OTP code. Please check and try again.' });
    }

    // OTP is valid. Now fetch or create the user
    db.get(`SELECT * FROM users WHERE email = ?`, [cleanEmail], (uErr, user) => {
      if (uErr) {
        return res.status(500).json({ error: 'User lookup error.' });
      }

      if (user) {
        // User exists
        return res.json({
          success: true,
          user: {
            id: user.id,
            email: user.email,
            scholar_no: user.scholar_no,
            name: user.name,
            photo_url: user.photo_url,
            photo_locked: user.photo_locked || 0,
            isProfileComplete: Boolean(user.name && user.photo_url)
          }
        });
      } else {
        // Create new user profile record
        db.run(
          `INSERT INTO users (email, scholar_no) VALUES (?, ?)`,
          [cleanEmail, cleanScholar],
          function (insErr) {
            if (insErr) {
              if (insErr.message.includes('UNIQUE constraint failed: users.scholar_no')) {
                return res.status(400).json({ error: 'Scholar Number is already registered with another email.' });
              }
              return res.status(500).json({ error: 'Failed to create user record.' });
            }

            return res.json({
              success: true,
              user: {
                id: this.lastID,
                email: cleanEmail,
                scholar_no: cleanScholar,
                name: null,
                photo_url: null,
                isProfileComplete: false
              }
            });
          }
        );
      }
    });
  });
});

// Step 3: Complete Profile (Name & Photo upload)
app.post('/api/user/profile', upload.single('photo'), (req, res) => {
  const { user_id, name } = req.body;

  if (!user_id || !name) {
    return res.status(400).json({ error: 'User ID and Name are required.' });
  }

  const photoUrl = req.file ? `/uploads/${req.file.filename}` : null;

  db.get(`SELECT * FROM users WHERE id = ?`, [user_id], (err, user) => {
    if (err || !user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // PHOTO LOCK: If photo already exists and is locked, reject new photo
    if (user.photo_url && user.photo_locked && photoUrl) {
      // Student is trying to change a locked photo — create a change request instead
      db.run(
        `INSERT INTO photo_change_requests (user_id, new_photo_url) VALUES (?, ?)`,
        [user_id, photoUrl],
        (reqErr) => {
          if (reqErr) {
            return res.status(500).json({ error: 'Failed to submit photo change request.' });
          }
          return res.status(403).json({
            error: 'Your photo is locked. A change request has been sent to the admin for approval.',
            photoChangeRequested: true
          });
        }
      );
      return;
    }

    const finalPhoto = photoUrl || user.photo_url;
    if (!finalPhoto) {
      return res.status(400).json({ error: 'Please upload a clear student photo.' });
    }

    // Lock the photo after first upload
    const shouldLock = photoUrl ? 1 : (user.photo_locked || 0);

    db.run(
      `UPDATE users SET name = ?, photo_url = ?, photo_locked = ? WHERE id = ?`,
      [name.trim(), finalPhoto, shouldLock, user_id],
      function (upErr) {
        if (upErr) {
          return res.status(500).json({ error: 'Failed to update profile.' });
        }

        return res.json({
          success: true,
          user: {
            id: user.id,
            email: user.email,
            scholar_no: user.scholar_no,
            name: name.trim(),
            photo_url: finalPhoto,
            photo_locked: shouldLock,
            isProfileComplete: true
          }
        });
      }
    );
  });
});

// -------------------------------------------------------------
// 2. MEAL SLOTS & TOKEN LOGIC
// -------------------------------------------------------------

// Get current slot status and today's claim state for user (Production Time)
app.get('/api/card/status', async (req, res) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required.' });
  }

  const currentSlot = getMealSlot();
  const todayDate = getTodayDateString();
  const dayName = getDayName().toLowerCase();

  // Get day menu from database
  const dayMenu = await getMenuForDayFromDb(db, dayName);

  // Determine item name based on active slot
  let itemName = 'Special Item';
  if (currentSlot.slot === 'snacks') {
    itemName = (dayMenu.snacks && dayMenu.snacks.length > 0) ? dayMenu.snacks.join(' + ') : 'Snack Item';
  } else if (currentSlot.slot === 'dinner') {
    itemName = (dayMenu.dinner_special && dayMenu.dinner_special.length > 0) ? dayMenu.dinner_special.join(' + ') : 'Dessert / Special';
  } else {
    itemName = 'Limited Item';
  }

  if (!currentSlot.active) {
    return res.json({
      slot: currentSlot,
      itemName,
      dayName,
      dayMenu,
      canClaim: false,
      token: null,
      message: `Mess distribution closed. ${currentSlot.nextSlot || ''}`
    });
  }

  // Check if user has already claimed/burnt a token for this slot today
  db.get(
    `SELECT * FROM token_claims WHERE user_id = ? AND meal_slot = ? AND claim_date = ?`,
    [user_id, currentSlot.slot, todayDate],
    (cErr, claim) => {
      if (cErr) {
        return res.status(500).json({ error: 'Database error reading claims.' });
      }

      if (claim) {
        return res.json({
          slot: currentSlot,
          itemName: claim.item_name,
          dayName,
          dayMenu,
          canClaim: false,
          token: claim,
          message: claim.status === 'BURNT' 
            ? `You have already collected your ${claim.item_name} for this slot.`
            : `Token generated! Ready to swipe at counter.`
        });
      }

      // Has not claimed yet
      return res.json({
        slot: currentSlot,
        itemName,
        dayName,
        dayMenu,
        canClaim: true,
        token: null,
        message: `1 ${itemName} token available. Click below to generate!`
      });
    }
  );
});

// Generate Token for current slot (Production Time)
app.post('/api/card/claim-token', async (req, res) => {
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required.' });
  }

  const currentSlot = getMealSlot();
  const todayDate = getTodayDateString();
  const dayName = getDayName().toLowerCase();

  if (!currentSlot.active) {
    return res.status(400).json({ error: 'No active meal window right now.' });
  }

  const dayMenu = await getMenuForDayFromDb(db, dayName);
  let itemName = 'Special Item';
  if (currentSlot.slot === 'snacks') {
    itemName = (dayMenu.snacks && dayMenu.snacks.length > 0) ? dayMenu.snacks.join(' + ') : 'Snack Item';
  } else if (currentSlot.slot === 'dinner') {
    itemName = (dayMenu.dinner_special && dayMenu.dinner_special.length > 0) ? dayMenu.dinner_special.join(' + ') : 'Dessert / Special';
  } else {
    itemName = 'Limited Item';
  }

  db.run(
    `INSERT INTO token_claims (user_id, meal_slot, claim_date, item_name, status)
     VALUES (?, ?, ?, ?, 'CLAIMED')`,
    [user_id, currentSlot.slot, todayDate, itemName],
    function (insErr) {
      if (insErr) {
        if (insErr.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'You have already generated a token for this slot.' });
        }
        return res.status(500).json({ error: 'Failed to generate token.' });
      }

      return res.json({
        success: true,
        token: {
          id: this.lastID,
          item_name: itemName,
          meal_slot: currentSlot.slot,
          status: 'CLAIMED',
          claimed_at: new Date().toISOString()
        }
      });
    }
  );
});

// "SWIPE TO BURN" - student swipes at counter in front of worker
app.post('/api/card/burn-token', (req, res) => {
  const { user_id, token_id } = req.body;

  if (!user_id || !token_id) {
    return res.status(400).json({ error: 'user_id and token_id are required.' });
  }

  const nowIso = new Date().toISOString();

  // Atomically update the status from CLAIMED to BURNT
  db.run(
    `UPDATE token_claims 
     SET status = 'BURNT', burnt_at = ? 
     WHERE id = ? AND user_id = ? AND status = 'CLAIMED'`,
    [nowIso, token_id, user_id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Error burning token.' });
      }

      if (this.changes === 0) {
        return res.status(400).json({ error: 'Token already redeemed or invalid.' });
      }

      return res.json({
        success: true,
        burnt_at: nowIso,
        message: 'Token successfully redeemed! Show the green screen to counter staff.'
      });
    }
  );
});

// -------------------------------------------------------------
// 3. ADMIN DASHBOARD API (PASSWORD & SESSION PROTECTED)
// -------------------------------------------------------------

const adminSessions = new Map();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'KalamAdmin@2026';

// Admin: Login with Master Password
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect Admin Master Password.' });
  }

  // Generate 24-hour secure random session token
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now() + 24 * 60 * 60 * 1000);

  return res.json({
    success: true,
    token,
    message: 'Admin authentication successful.'
  });
});

// Middleware: Require Admin Authentication on all admin endpoints
function requireAdminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));

  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ error: 'Access Denied: Admin authorization required.' });
  }

  const expiresAt = adminSessions.get(token);
  if (Date.now() > expiresAt) {
    adminSessions.delete(token);
    return res.status(401).json({ error: 'Admin session expired. Please log in again.' });
  }

  next();
}

// Enforce admin auth on all /api/admin routes (except login)
app.use('/api/admin', (req, res, next) => {
  if (req.path === '/login') return next();
  return requireAdminAuth(req, res, next);
});

// Admin: Set today's special item
app.post('/api/admin/set-item', (req, res) => {
  const { item_name } = req.body;
  if (!item_name) return res.status(400).json({ error: 'item_name required' });

  db.run(
    `INSERT INTO settings (key, value) VALUES ('current_special_item', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [item_name],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to update item.' });
      res.json({ success: true, item_name });
    }
  );
});

// Admin: Get complete weekly menu
app.get('/api/admin/menu', async (req, res) => {
  try {
    const weeklyMenu = await getAllWeeklyMenuFromDb(db);
    res.json({ success: true, menu: weeklyMenu, days: DAYS });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch weekly menu' });
  }
});

// Admin: Update a specific day's menu (limited snacks & dinner specials)
app.post('/api/admin/menu/update', (req, res) => {
  const { day, snacks, dinner_special } = req.body;

  if (!day) {
    return res.status(400).json({ error: 'Day is required (e.g., monday, tuesday).' });
  }

  const cleanDay = day.trim().toLowerCase();
  const snacksArray = Array.isArray(snacks) ? snacks : (snacks ? [snacks] : []);
  const dinnerArray = Array.isArray(dinner_special) ? dinner_special : (dinner_special ? [dinner_special] : []);

  db.run(
    `INSERT INTO weekly_menu (day, snacks_items, dinner_special_items)
     VALUES (?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET 
       snacks_items = excluded.snacks_items,
       dinner_special_items = excluded.dinner_special_items`,
    [cleanDay, JSON.stringify(snacksArray), JSON.stringify(dinnerArray)],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to update menu in database.' });
      }
      res.json({
        success: true,
        message: `Menu for ${cleanDay.toUpperCase()} successfully updated!`,
        day: cleanDay,
        snacks: snacksArray,
        dinner_special: dinnerArray
      });
    }
  );
});

// Admin: Get current email / SMTP settings status
app.get('/api/admin/email-settings', async (req, res) => {
  const isConfigured = Boolean((process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) || process.env.EMAIL_API_URL);
  const testRes = await testSmtpConnection();

  res.json({
    configured: isConfigured,
    mode: process.env.EMAIL_API_URL ? 'HTTPS_API_RELAY' : (isConfigured ? 'REAL_EMAIL_SMTP' : 'SIMULATION_MODE'),
    host: process.env.SMTP_HOST || '',
    port: process.env.SMTP_PORT || '587',
    user: process.env.SMTP_USER || '',
    secure: process.env.SMTP_SECURE === 'true',
    email_api_url: process.env.EMAIL_API_URL || '',
    testResult: testRes,
    lastDispatch: getLastDispatchInfo()
  });
});

// Admin: Update email / SMTP settings dynamically and save to .env
app.post('/api/admin/email-settings', async (req, res) => {
  const { host, port, user, pass, secure, email_api_url } = req.body;

  if (email_api_url) {
    process.env.EMAIL_API_URL = email_api_url.trim();
  }
  if (host) process.env.SMTP_HOST = host.trim();
  if (port) process.env.SMTP_PORT = port.toString().trim();
  if (user) process.env.SMTP_USER = user.trim();
  if (pass) process.env.SMTP_PASS = pass.trim();
  if (secure !== undefined) process.env.SMTP_SECURE = secure ? 'true' : 'false';

  initTransporter();

  // Save to .env file
  const envContent = `PORT=${PORT}\nADMIN_PASSWORD=${process.env.ADMIN_PASSWORD || 'KalamAdmin@2026'}\nSMTP_HOST=${process.env.SMTP_HOST || ''}\nSMTP_PORT=${process.env.SMTP_PORT || '587'}\nSMTP_USER=${process.env.SMTP_USER || ''}\nSMTP_PASS=${process.env.SMTP_PASS || ''}\nSMTP_SECURE=${process.env.SMTP_SECURE || 'false'}\nEMAIL_API_URL=${process.env.EMAIL_API_URL || ''}\n`;
  fs.writeFileSync(path.join(__dirname, '.env'), envContent, 'utf8');

  const testRes = await testSmtpConnection();

  res.json({
    success: true,
    message: 'Email settings saved successfully!',
    testResult: testRes
  });
});

// Admin: Send a test email to verify credentials
app.post('/api/admin/email-settings/send-test', async (req, res) => {
  const { test_email } = req.body;
  if (!test_email) return res.status(400).json({ error: 'Target test email is required' });

  const testOtp = Math.floor(100000 + Math.random() * 900000).toString();
  const sendRes = await sendOtpEmail(test_email.trim(), testOtp);

  res.json({
    success: true,
    result: sendRes,
    message: sendRes.mode === 'smtp'
      ? `Real test OTP email sent successfully to ${test_email}!`
      : `Sent in simulation mode (check server console). Configure SMTP for real delivery.`
  });
});

// Admin: View active/recent student OTPs for instant counter verification
app.get('/api/admin/active-otps', (req, res) => {
  const now = Date.now();
  db.all(
    `SELECT email, otp, expires_at FROM otps WHERE expires_at > ? ORDER BY expires_at DESC LIMIT 30`,
    [now],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error fetching active OTPs' });
      const formatted = (rows || []).map(r => ({
        email: r.email,
        scholar_no: r.email.split('@')[0],
        otp: r.otp,
        expires_in_seconds: Math.max(0, Math.round((r.expires_at - now) / 1000))
      }));
      res.json({ success: true, otps: formatted });
    }
  );
});

// Admin: Instant manual pass activation for student (counter assistant)
app.post('/api/admin/instant-activate-student', (req, res) => {
  const { scholar_no, name, room_no, hostel_block } = req.body;
  const cleanScholar = (scholar_no || '').toString().trim();
  if (!cleanScholar || !/^\d{8,12}$/.test(cleanScholar)) {
    return res.status(400).json({ error: 'Valid 8-12 digit MANIT Scholar Number required.' });
  }
  const cleanEmail = `${cleanScholar}@stu.manit.ac.in`;

  db.get(`SELECT * FROM users WHERE email = ?`, [cleanEmail], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error querying student.' });

    if (user) {
      db.run(`DELETE FROM otps WHERE email = ?`, [cleanEmail]);
      return res.json({
        success: true,
        message: `Student pass is already active for Scholar No. ${cleanScholar}!`,
        user: {
          id: user.id,
          scholar_no: user.scholar_no,
          email: user.email,
          name: user.name,
          photo_url: user.photo_url,
          photo_locked: user.photo_locked || 0,
          isProfileComplete: Boolean(user.photo_url && user.name)
        }
      });
    }

    const studentName = (name || `Student ${cleanScholar}`).trim();

    db.run(
      `INSERT INTO users (scholar_no, email, name) VALUES (?, ?, ?)`,
      [cleanScholar, cleanEmail, studentName],
      function (insertErr) {
        if (insertErr) {
          console.error('[DB INSERT ERROR]:', insertErr.message);
          return res.status(500).json({ error: 'Failed to create student account: ' + insertErr.message });
        }
        db.run(`DELETE FROM otps WHERE email = ?`, [cleanEmail]);
        return res.json({
          success: true,
          message: `Student account created & pass activated immediately for Scholar No. ${cleanScholar}!`,
          user: {
            id: this.lastID,
            scholar_no: cleanScholar,
            email: cleanEmail,
            name: studentName,
            photo_url: null,
            photo_locked: 0,
            isProfileComplete: false
          }
        });
      }
    );
  });
});

// Admin: Reset a user's claims for today
app.post('/api/admin/reset-my-token', (req, res) => {
  const { user_id } = req.body;
  const todayDate = getTodayDateString();
  db.run(
    `DELETE FROM token_claims WHERE user_id = ? AND claim_date = ?`,
    [user_id, todayDate],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to reset token.' });
      res.json({ success: true, message: "Today's token reset successfully for testing." });
    }
  );
});

// Admin: Live Dashboard Stats
app.get('/api/admin/stats', (req, res) => {
  const todayDate = getTodayDateString();

  const queries = {
    totalStudents: `SELECT COUNT(*) as count FROM users`,
    todayClaimed: `SELECT COUNT(*) as count FROM token_claims WHERE claim_date = ?`,
    todayBurnt: `SELECT COUNT(*) as count FROM token_claims WHERE claim_date = ? AND status = 'BURNT'`,
    todayPending: `SELECT COUNT(*) as count FROM token_claims WHERE claim_date = ? AND status = 'CLAIMED'`,
    eveningClaimed: `SELECT COUNT(*) as count FROM token_claims WHERE claim_date = ? AND meal_slot = 'evening_snacks'`,
    eveningBurnt: `SELECT COUNT(*) as count FROM token_claims WHERE claim_date = ? AND meal_slot = 'evening_snacks' AND status = 'BURNT'`,
    dinnerClaimed: `SELECT COUNT(*) as count FROM token_claims WHERE claim_date = ? AND meal_slot = 'dinner'`,
    dinnerBurnt: `SELECT COUNT(*) as count FROM token_claims WHERE claim_date = ? AND meal_slot = 'dinner' AND status = 'BURNT'`,
  };

  const results = {};
  let pending = Object.keys(queries).length;

  for (const [key, query] of Object.entries(queries)) {
    const params = query.includes('?') ? [todayDate] : [];
    db.get(query, params, (err, row) => {
      results[key] = row ? row.count : 0;
      pending--;
      if (pending === 0) {
        const currentSlot = getMealSlot();
        const todayDay = getDayName();
        getMenuForDayFromDb(db, todayDay).then((dayMenu) => {
          let dynamicItem = 'No Special Item';
          if (currentSlot.slot === 'snacks') {
            dynamicItem = (dayMenu.snacks && dayMenu.snacks.length > 0) ? dayMenu.snacks.join(' + ') : 'Snacks';
          } else if (currentSlot.slot === 'dinner') {
            dynamicItem = (dayMenu.dinner_special && dayMenu.dinner_special.length > 0) ? dayMenu.dinner_special.join(' + ') : 'Dinner Special';
          } else {
            // Outside hours, show today's scheduled items overview
            const s = (dayMenu.snacks && dayMenu.snacks.length > 0) ? dayMenu.snacks.join(' + ') : 'None';
            const d = (dayMenu.dinner_special && dayMenu.dinner_special.length > 0) ? dayMenu.dinner_special.join(' + ') : 'None';
            dynamicItem = `Snacks: ${s} | Dinner: ${d}`;
          }
          results.currentItem = dynamicItem;
          results.dayName = todayDay.toUpperCase();
          results.date = todayDate;
          res.json(results);
        });
      }
    });
  }
});

// Admin: Today's Claims Log (all students who claimed/burnt today)
app.get('/api/admin/claims-log', (req, res) => {
  const todayDate = getTodayDateString();
  const { slot } = req.query; // optional filter: 'evening_snacks' or 'dinner'

  let query = `
    SELECT tc.id, tc.meal_slot, tc.item_name, tc.status, tc.claimed_at, tc.burnt_at,
           u.name, u.scholar_no, u.email, u.photo_url
    FROM token_claims tc
    JOIN users u ON tc.user_id = u.id
    WHERE tc.claim_date = ?
  `;
  const params = [todayDate];

  if (slot) {
    query += ` AND tc.meal_slot = ?`;
    params.push(slot);
  }

  query += ` ORDER BY tc.claimed_at DESC`;

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch claims log.' });
    res.json({ date: todayDate, claims: rows || [] });
  });
});

// Admin: All Registered Students
app.get('/api/admin/students', (req, res) => {
  db.all(
    `SELECT id, name, scholar_no, email, photo_url, created_at FROM users ORDER BY created_at DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch students.' });
      res.json({ students: rows || [] });
    }
  );
});

// Admin: Reset ALL claims for today (nuclear option for testing)
app.post('/api/admin/reset-all-today', (req, res) => {
  const todayDate = getTodayDateString();
  db.run(`DELETE FROM token_claims WHERE claim_date = ?`, [todayDate], function (err) {
    if (err) return res.status(500).json({ error: 'Failed to reset.' });
    res.json({ success: true, deleted: this.changes, message: `All ${this.changes} claims for today wiped.` });
  });
});

// -------------------------------------------------------------
// 4. PHOTO CHANGE REQUEST MANAGEMENT
// -------------------------------------------------------------

// Admin: Get all pending photo change requests
app.get('/api/admin/photo-requests', (req, res) => {
  db.all(
    `SELECT pcr.id, pcr.user_id, pcr.new_photo_url, pcr.status, pcr.requested_at,
            u.name, u.scholar_no, u.email, u.photo_url as current_photo
     FROM photo_change_requests pcr
     JOIN users u ON pcr.user_id = u.id
     ORDER BY pcr.requested_at DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch photo requests.' });
      const pending = (rows || []).filter(r => r.status === 'PENDING');
      const resolved = (rows || []).filter(r => r.status !== 'PENDING');
      res.json({ pending, resolved });
    }
  );
});

// Admin: Approve photo change request
app.post('/api/admin/photo-requests/:id/approve', (req, res) => {
  const requestId = req.params.id;

  db.get(`SELECT * FROM photo_change_requests WHERE id = ? AND status = 'PENDING'`, [requestId], (err, pcr) => {
    if (err || !pcr) {
      return res.status(404).json({ error: 'Request not found or already resolved.' });
    }

    // Update user's photo and keep it locked
    db.run(
      `UPDATE users SET photo_url = ?, photo_locked = 1 WHERE id = ?`,
      [pcr.new_photo_url, pcr.user_id],
      (upErr) => {
        if (upErr) return res.status(500).json({ error: 'Failed to update user photo.' });

        db.run(
          `UPDATE photo_change_requests SET status = 'APPROVED', resolved_at = ? WHERE id = ?`,
          [new Date().toISOString(), requestId],
          (rErr) => {
            if (rErr) return res.status(500).json({ error: 'Failed to update request status.' });
            res.json({ success: true, message: 'Photo change approved. Student photo updated.' });
          }
        );
      }
    );
  });
});

// Admin: Reject photo change request
app.post('/api/admin/photo-requests/:id/reject', (req, res) => {
  const requestId = req.params.id;

  db.run(
    `UPDATE photo_change_requests SET status = 'REJECTED', resolved_at = ? WHERE id = ? AND status = 'PENDING'`,
    [new Date().toISOString(), requestId],
    function (err) {
      if (err) return res.status(500).json({ error: 'Failed to reject request.' });
      if (this.changes === 0) return res.status(404).json({ error: 'Request not found or already resolved.' });
      res.json({ success: true, message: 'Photo change request rejected.' });
    }
  );
});

// Admin: Manually unlock a student's photo (allow them to re-upload)
app.post('/api/admin/unlock-photo', (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  db.run(`UPDATE users SET photo_locked = 0 WHERE id = ?`, [user_id], function (err) {
    if (err) return res.status(500).json({ error: 'Failed to unlock photo.' });
    res.json({ success: true, message: 'Photo unlocked. Student can now upload a new photo.' });
  });
});

// Admin Diagnostic: Check live email health and last dispatch details
app.get('/api/admin/email-status', async (req, res) => {
  const isConfigured = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
  const testResult = await testSmtpConnection();
  const lastDispatch = getLastDispatchInfo();

  res.json({
    smtp_configured: isConfigured,
    smtp_user: process.env.SMTP_USER ? process.env.SMTP_USER.replace(/(.{3})(.*)(@.*)/, '$1***$3') : null,
    connection_test: testResult,
    last_dispatch: lastDispatch,
    timestamp: new Date().toISOString()
  });
});

function getNetworkIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  const ip = getNetworkIP();
  console.log(`=======================================================`);
  console.log(` 🍽️  KALAM MESS DIGITAL SYSTEM IS LIVE!`);
  console.log(` Local:       http://localhost:${PORT}`);
  console.log(` Hostel Wi-Fi: http://${ip}:${PORT}`);
  console.log(` Admin Portal: http://${ip}:${PORT}/admin.html`);
  console.log(`=======================================================`);
});
