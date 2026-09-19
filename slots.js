// =============================================
// Meal Slot Definitions — A.P.J. Abdul Kalam Bhawan
// All slots include +30 min grace buffer
// =============================================

function getMealSlot(customMinutes = null) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sunday, 6=Saturday
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const currentTotalMinutes = customMinutes !== null
    ? customMinutes
    : now.getHours() * 60 + now.getMinutes();

  // Breakfast: 7:30-9:00 AM Mon-Fri (450-540) | 8:30-10:00 AM Sat-Sun (510-600)
  // + 30 min grace
  const brkStart = isWeekend ? 510 : 450;
  const brkEnd = isWeekend ? 600 : 540;
  const brkGrace = brkEnd + 30;
  if (currentTotalMinutes >= brkStart && currentTotalMinutes <= brkGrace) {
    return {
      slot: 'breakfast',
      label: 'Breakfast',
      active: true,
      isGrace: currentTotalMinutes > brkEnd,
      window: isWeekend
        ? '8:30 AM – 10:00 AM (Grace till 10:30 AM)'
        : '7:30 AM – 9:00 AM (Grace till 9:30 AM)'
    };
  }

  // Lunch: 12:30 PM – 2:00 PM (750-840) + 30 min grace = till 870 (2:30 PM)
  if (currentTotalMinutes >= 750 && currentTotalMinutes <= 870) {
    return {
      slot: 'lunch',
      label: 'Lunch',
      active: true,
      isGrace: currentTotalMinutes > 840,
      window: '12:30 PM – 2:00 PM (Grace till 2:30 PM)'
    };
  }

  // Snacks: 5:00 PM – 6:00 PM (1020-1080) + 30 min grace = till 1110 (6:30 PM)
  if (currentTotalMinutes >= 1020 && currentTotalMinutes <= 1110) {
    return {
      slot: 'snacks',
      label: 'Snacks',
      active: true,
      isGrace: currentTotalMinutes > 1080,
      window: '5:00 PM – 6:00 PM (Grace till 6:30 PM)'
    };
  }

  // Dinner: 7:30 PM – 9:30 PM (1170-1290) + 30 min grace = till 1320 (10:00 PM)
  if (currentTotalMinutes >= 1170 && currentTotalMinutes <= 1320) {
    return {
      slot: 'dinner',
      label: 'Dinner',
      active: true,
      isGrace: currentTotalMinutes > 1290,
      window: '7:30 PM – 9:30 PM (Grace till 10:00 PM)'
    };
  }

  // Figure out next slot
  let nextSlot = '';
  if (currentTotalMinutes < brkStart) {
    nextSlot = isWeekend ? 'Breakfast (starts 8:30 AM)' : 'Breakfast (starts 7:30 AM)';
  } else if (currentTotalMinutes < 750) {
    nextSlot = 'Lunch (starts 12:30 PM)';
  } else if (currentTotalMinutes < 1020) {
    nextSlot = 'Snacks (starts 5:00 PM)';
  } else if (currentTotalMinutes < 1170) {
    nextSlot = 'Dinner (starts 7:30 PM)';
  } else {
    nextSlot = 'Tomorrow Breakfast';
  }

  return {
    slot: null,
    label: 'No Active Meal Slot',
    active: false,
    nextSlot
  };
}

function getTodayDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = {
  getMealSlot,
  getTodayDateString
};
