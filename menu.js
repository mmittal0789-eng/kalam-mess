// ============================================
// A.P.J. Abdul Kalam Bhawan Mess Menu Config
// H10-C,D | Veg: 10C | Non-Veg: 10D
// ============================================

// Meal Timings (from the official menu card)
// Breakfast: 7:30 AM – 9:00 AM (Mon-Fri) | 8:30 AM – 10:00 AM (Sat-Sun)
// Lunch:     12:30 PM – 2:00 PM
// Snacks:    5:00 PM – 6:00 PM
// Dinner:    7:30 PM – 9:30 PM
// All slots get +30 min grace buffer

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Limited items per day per slot
// "limited" = 1 per student per slot. Chai is unlimited (not listed here).
const MENU = {
  monday: {
    snacks: [
      { name: '2 Samosa / 2 Kachori', qty: 1 },
      { name: 'Green Chutney', qty: 1 }
    ],
    dinner_special: []
  },
  tuesday: {
    snacks: [
      { name: 'Aaloo Tikki Chat', qty: 1 }
    ],
    dinner_special: [
      { name: 'Kheer', qty: 1 }
    ]
  },
  wednesday: {
    snacks: [
      { name: 'Pakora / Bhajiya', qty: 1 }
    ],
    dinner_special: [
      { name: 'Custard / Ice Cream', qty: 1 }
    ]
  },
  thursday: {
    snacks: [
      { name: 'Pani Puri (8 pc)', qty: 1 }
    ],
    dinner_special: []
  },
  friday: {
    snacks: [
      { name: 'Chowmin', qty: 1 }
    ],
    dinner_special: [
      { name: 'Gulab Jamun', qty: 1 }
    ]
  },
  saturday: {
    snacks: [
      { name: 'Bhel', qty: 1 }
    ],
    dinner_special: [
      { name: 'Fryums', qty: 1 }
    ]
  },
  sunday: {
    snacks: [
      { name: 'Bada Pao', qty: 1 },
      { name: 'Green Chutney', qty: 1 }
    ],
    dinner_special: []
  }
};

function getDayName(date) {
  return DAYS[date ? new Date(date).getDay() : new Date().getDay()];
}

function getTodayMenu() {
  const day = getDayName();
  return MENU[day] || { snacks: [], dinner_special: [] };
}

function getMenuForDayFromDb(db, day) {
  return new Promise((resolve) => {
    db.get(`SELECT * FROM weekly_menu WHERE day = ?`, [day.toLowerCase()], (err, row) => {
      if (err || !row) {
        // Fallback to static config
        const fallback = MENU[day.toLowerCase()] || { snacks: [], dinner_special: [] };
        return resolve({
          day,
          snacks: fallback.snacks.map(s => typeof s === 'string' ? s : s.name),
          dinner_special: fallback.dinner_special.map(s => typeof s === 'string' ? s : s.name)
        });
      }

      try {
        resolve({
          day: row.day,
          snacks: JSON.parse(row.snacks_items),
          dinner_special: JSON.parse(row.dinner_special_items)
        });
      } catch (e) {
        resolve({ day: row.day, snacks: [], dinner_special: [] });
      }
    });
  });
}

function getAllWeeklyMenuFromDb(db) {
  return new Promise((resolve) => {
    db.all(`SELECT * FROM weekly_menu`, [], (err, rows) => {
      if (err || !rows || rows.length === 0) {
        const fullMenu = {};
        DAYS.forEach(d => {
          fullMenu[d] = {
            snacks: (MENU[d]?.snacks || []).map(s => typeof s === 'string' ? s : s.name),
            dinner_special: (MENU[d]?.dinner_special || []).map(s => typeof s === 'string' ? s : s.name)
          };
        });
        return resolve(fullMenu);
      }

      const result = {};
      DAYS.forEach(d => { result[d] = { snacks: [], dinner_special: [] }; });
      rows.forEach(r => {
        try {
          result[r.day] = {
            snacks: JSON.parse(r.snacks_items),
            dinner_special: JSON.parse(r.dinner_special_items)
          };
        } catch (e) {}
      });
      resolve(result);
    });
  });
}

module.exports = {
  MENU,
  DAYS,
  getDayName,
  getTodayMenu,
  getMenuForDayFromDb,
  getAllWeeklyMenuFromDb
};

