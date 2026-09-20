// Auto-detect native Android asset vs web host
const API_BASE = (window.location.protocol === "file:" || !window.location.host) ? (localStorage.getItem("mess_server_url") || "http://10.172.137.59:3000") : "";

// ==========================================
// KALAM MESS – Digital Pass Frontend
// Hand-Drawn Architecture Implementation
// ==========================================

let currentUser = null;
let currentSlotData = null;
let currentToken = null;
let liveClockInterval = null;
let burnCountdownInterval = null;
let isBurnScreenActive = false;

// Circular SVG geometry: radius = 42 -> 2 * PI * 42 = 263.89
const CIRCLE_CIRCUMFERENCE = 263.89;

function initIcons() {
  if (window.lucide) {
    lucide.createIcons();
  }
}

// ------------------------------------------
// Toast notifications
// ------------------------------------------
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  if (!toast || !toastMsg) return;
  
  toastMsg.textContent = message;
  toast.classList.remove('bg-rose-600', 'bg-[#0c2b20]');
  
  if (isError) {
    toast.classList.add('bg-rose-600');
  } else {
    toast.classList.add('bg-[#0c2b20]');
  }

  toast.classList.remove('translate-y-20', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 3500);
}

// ------------------------------------------
// Theme Toggle (Dark Mode / Light Mode)
// ------------------------------------------
function initTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  updateThemeUI(isDark);
}

function updateThemeUI(isDark) {
  const modeText = document.getElementById('themeModeText');
  const icon = document.getElementById('themeIcon');
  if (modeText) modeText.textContent = isDark ? 'Dark' : 'Light';
  if (icon) icon.textContent = isDark ? '🌙' : '☀️';
}

const btnToggleTheme = document.getElementById('btnToggleTheme');
if (btnToggleTheme) {
  btnToggleTheme.addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeUI(isDark);
  });
}

// ------------------------------------------
// Options Menu Dropdown
// ------------------------------------------
const btnOptionsMenu = document.getElementById('btnOptionsMenu');
const optionsDropdown = document.getElementById('optionsDropdown');

if (btnOptionsMenu && optionsDropdown) {
  btnOptionsMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    optionsDropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!optionsDropdown.contains(e.target) && e.target !== btnOptionsMenu) {
      optionsDropdown.classList.add('hidden');
    }
  });
}

// ------------------------------------------
// Interactive Profile Avatar Modal
// ------------------------------------------
const btnProfileAvatar = document.getElementById('btnProfileAvatar');
const profileModal = document.getElementById('profileDetailsModal');
const btnCloseProfileModal = document.getElementById('btnCloseProfileModal');

if (btnProfileAvatar && profileModal) {
  btnProfileAvatar.addEventListener('click', () => {
    if (!currentUser) {
      showToast('Please login first');
      return;
    }
    document.getElementById('modalProfileName').textContent = currentUser.name || 'Student';
    document.getElementById('modalProfileScholar').textContent = currentUser.scholar_no;
    document.getElementById('modalProfileEmail').textContent = currentUser.email;
    const img = document.getElementById('modalProfileImg');
    if (img) img.src = currentUser.photo_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80';
    profileModal.classList.remove('hidden');
    initIcons();
  });
}

if (btnCloseProfileModal && profileModal) {
  btnCloseProfileModal.addEventListener('click', () => {
    profileModal.classList.add('hidden');
  });
}

// ------------------------------------------
// View Switcher
// ------------------------------------------
function switchView(viewId) {
  const authView = document.getElementById('authView');
  const profileSetupView = document.getElementById('profileSetupView');
  const cardView = document.getElementById('cardView');

  if (authView) authView.classList.add('hidden');
  if (profileSetupView) profileSetupView.classList.add('hidden');
  if (cardView) cardView.classList.add('hidden');

  const target = document.getElementById(viewId);
  if (target) target.classList.remove('hidden');

  if (viewId === 'cardView') {
    startLiveClock();
    refreshCardStatus();
  } else {
    stopLiveClock();
  }
  initIcons();
}

// ------------------------------------------
// Real-time MANIT Scholar & Email Format Binding
// ------------------------------------------
const inputScholar = document.getElementById('inputScholar');
const inputEmail = document.getElementById('inputEmail');

if (inputScholar && inputEmail) {
  const syncEmailFromScholar = () => {
    // Strictly numeric: strip any letters, special characters, or spaces
    inputScholar.value = inputScholar.value.replace(/\D/g, '');
    const scholar = inputScholar.value.trim();
    if (scholar.length > 0) {
      inputEmail.value = `${scholar}@stu.manit.ac.in`;
    } else {
      inputEmail.value = '';
    }
  };

  inputScholar.addEventListener('input', syncEmailFromScholar);

  inputScholar.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    const cleaned = pasted.replace(/\D/g, '').slice(0, 12);
    inputScholar.value = cleaned;
    if (cleaned.length > 0) {
      inputEmail.value = `${cleaned}@stu.manit.ac.in`;
    } else {
      inputEmail.value = '';
    }
  });
}

// ------------------------------------------
// Step 1: Request OTP
// ------------------------------------------
const btnRequestOtp = document.getElementById('btnRequestOtp');
if (btnRequestOtp) {
  btnRequestOtp.addEventListener('click', async () => {
    const scholar_no = inputScholar ? inputScholar.value.trim() : '';
    const email = inputEmail ? inputEmail.value.trim() : '';

    if (!scholar_no || !/^\d{8,12}$/.test(scholar_no)) {
      showToast('Please enter your 8 to 12 digit MANIT Scholar Number (e.g. 26112011312).', true);
      inputScholar?.focus();
      return;
    }

    const expectedEmail = `${scholar_no}@stu.manit.ac.in`;
    if (email !== expectedEmail) {
      showToast(`Student email must be ${expectedEmail}. Fake IDs are blocked.`, true);
      return;
    }

    btnRequestOtp.disabled = true;
    btnRequestOtp.innerHTML = '<span>Sending OTP...</span>';

    try {
      const res = await fetch(API_BASE + '/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, scholar_no })
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'Failed to request OTP', true);
        return;
      }

      document.getElementById('sentOtpTarget').textContent = email;
      document.getElementById('authStep1').classList.add('hidden');
      document.getElementById('authStep2').classList.remove('hidden');

      showToast('OTP dispatched to your official MANIT mailbox!');
    } catch (err) {
      showToast('Network error requesting OTP. Please check connection.', true);
    } finally {
      btnRequestOtp.disabled = false;
      btnRequestOtp.innerHTML = '<span>Send Verification OTP</span><i data-lucide="arrow-right" class="w-4 h-4"></i>';
      initIcons();
    }
  });
}

const btnBackToStep1 = document.getElementById('btnBackToStep1');
if (btnBackToStep1) {
  btnBackToStep1.addEventListener('click', () => {
    document.getElementById('authStep2').classList.add('hidden');
    document.getElementById('authStep1').classList.remove('hidden');
    initIcons();
  });
}

// ------------------------------------------
// Step 2: Verify OTP
// ------------------------------------------
const btnVerifyOtp = document.getElementById('btnVerifyOtp');
if (btnVerifyOtp) {
  btnVerifyOtp.addEventListener('click', async () => {
    const email = document.getElementById('inputEmail').value.trim();
    const scholar_no = document.getElementById('inputScholar').value.trim();
    const otp = document.getElementById('inputOtp').value.trim();

    if (!otp || otp.length < 6) {
      showToast('Please enter the 6-digit OTP', true);
      return;
    }

    btnVerifyOtp.disabled = true;
    btnVerifyOtp.innerHTML = '<span>Verifying...</span>';

    try {
      const res = await fetch(API_BASE + '/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, scholar_no, otp })
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'Invalid OTP', true);
        return;
      }

      currentUser = data.user;
      localStorage.setItem('mess_user', JSON.stringify(currentUser));

      if (!currentUser.isProfileComplete) {
        switchView('profileSetupView');
      } else {
        setupCardProfile(currentUser);
        switchView('cardView');
      }
    } catch (err) {
      showToast('Network error during verification', true);
    } finally {
      btnVerifyOtp.disabled = false;
      btnVerifyOtp.innerHTML = '<span>Verify & Enter Pass</span><i data-lucide="check-circle-2" class="w-4 h-4"></i>';
      initIcons();
    }
  });
}

// ------------------------------------------
// Step 3: Profile Setup (Upload photo & name)
// ------------------------------------------
const inputPhoto = document.getElementById('inputPhoto');
const avatarPreview = document.getElementById('avatarPreview');
const avatarPlaceholder = document.getElementById('avatarPlaceholder');

if (inputPhoto) {
  inputPhoto.addEventListener('change', () => {
    const file = inputPhoto.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        avatarPreview.src = e.target.result;
        avatarPreview.classList.remove('hidden');
        avatarPlaceholder.classList.add('hidden');
      };
      reader.readAsDataURL(file);
    }
  });
}

const profileForm = document.getElementById('profileForm');
if (profileForm) {
  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('inputName').value.trim();
    const file = inputPhoto?.files[0];

    if (!name) {
      showToast('Please enter your full name.', true);
      return;
    }
    if (!file && !currentUser?.photo_url) {
      showToast('Please upload a clear student face photo.', true);
      return;
    }

    const formData = new FormData();
    formData.append('user_id', currentUser.id);
    formData.append('name', name);
    if (file) formData.append('photo', file);

    const saveBtn = document.getElementById('btnSaveProfile');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving Profile...';

    try {
      const res = await fetch(API_BASE + '/api/user/profile', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'Failed to save profile', true);
        return;
      }

      currentUser = data.user;
      localStorage.setItem('mess_user', JSON.stringify(currentUser));
      setupCardProfile(currentUser);
      switchView('cardView');
      showToast('Profile activated!');
    } catch (err) {
      showToast('Error uploading profile', true);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save & Activate My Pass';
    }
  });
}

// ------------------------------------------
// Setup Profile Data on Card Widgets
// ------------------------------------------
function setupCardProfile(user) {
  const name = user.name || 'Student';
  const roll = user.scholar_no || '211112045';
  const photo = user.photo_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80';

  // Top Bar Avatar
  const navImg = document.getElementById('navAvatarImg');
  const navPlace = document.getElementById('navAvatarPlaceholder');
  const navName = document.getElementById('navStudentShortName');
  if (navImg && user.photo_url) {
    navImg.src = photo;
    navImg.classList.remove('hidden');
    if (navPlace) navPlace.classList.add('hidden');
  }
  if (navName) navName.textContent = name.split(' ')[0];

  // Widget 1: Student Profile Photo Card
  const cardName = document.getElementById('cardUserName');
  if (cardName) cardName.textContent = name;
  const cardRoll = document.getElementById('cardScholarNo');
  if (cardRoll) cardRoll.textContent = roll;
  const cardPhoto = document.getElementById('cardUserPhoto');
  if (cardPhoto) cardPhoto.src = photo;

  // Burnt Screen Tags
  const burntName = document.getElementById('burntStaffName');
  if (burntName) burntName.textContent = name;
  const burntRoll = document.getElementById('burntStaffScholar');
  if (burntRoll) burntRoll.textContent = roll;
}

// ------------------------------------------
// Card Status & Time Slots Logic
// ------------------------------------------
async function refreshCardStatus() {
  if (!currentUser) return;

  const url = `${API_BASE}/api/card/status?user_id=${currentUser.id}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    currentSlotData = data;
    renderSlotState(data);
  } catch (err) {
    console.error('Failed to load card status', err);
  }
}

function renderSlotState(data) {
  const { slot, itemName, canClaim, token, dayMenu } = data;
  currentToken = token;

  const slotStatusBadge = document.getElementById('slotStatusBadge');
  const slotNameText = document.getElementById('slotNameText');
  const slotTimeText = document.getElementById('slotTimeText');
  const todayShiftMenuItems = document.getElementById('todayShiftMenuItems');
  const cardSecurityHash = document.getElementById('cardSecurityHash');
  const timerStatusLabel = document.getElementById('timerStatusLabel');
  const timerHelperNote = document.getElementById('timerHelperNote');
  const tokenReadyBox = document.getElementById('tokenReadyToClaimBox');
  const sliderContainer = document.getElementById('sliderContainer');
  const swipeLabel = document.getElementById('swipeLabel');

  // Dynamic security code hash
  const dynamicHash = token ? `ID-KM-${token.id.toString().padStart(4, '0')}-${currentUser?.scholar_no.slice(-4) || '8921'}` : `ID-KM-9218-ACTIVE`;
  if (cardSecurityHash) cardSecurityHash.textContent = dynamicHash;

  // Widget 2: Today Menu Card for Current Shift
  if (slot.active) {
    if (slotNameText) slotNameText.textContent = slot.label;
    if (slotTimeText) slotTimeText.textContent = slot.window;
    if (slotStatusBadge) {
      slotStatusBadge.textContent = slot.isGrace ? 'GRACE' : 'ACTIVE';
      slotStatusBadge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
    }

    // Format all items for current shift
    let itemsText = itemName || 'Shift Menu Available';
    if (slot.id === 'evening_snacks' && dayMenu?.snacks?.length) {
      itemsText = dayMenu.snacks.join(' • ') + ' • Special Chai';
    } else if (slot.id === 'dinner') {
      const specials = dayMenu?.dinner_special?.length ? dayMenu.dinner_special.join(' • ') : itemName;
      itemsText = `Shahi Thali, Fresh Rotis + Special: ${specials}`;
    }
    if (todayShiftMenuItems) todayShiftMenuItems.textContent = itemsText;

    if (timerStatusLabel) timerStatusLabel.textContent = `${slot.label} Active`;
    if (timerHelperNote) timerHelperNote.textContent = `Valid until ${slot.window.split('–')[1] || 'shift ends'}. Slide bar at counter to redeem.`;
  } else {
    if (slotNameText) slotNameText.textContent = 'Counter Closed';
    if (slotTimeText) slotTimeText.textContent = slot.nextSlot || 'Outside operational hours';
    if (slotStatusBadge) {
      slotStatusBadge.textContent = 'CLOSED';
      slotStatusBadge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
    }
    if (todayShiftMenuItems) {
      todayShiftMenuItems.textContent = `Next shift: ${slot.nextSlot || 'Upcoming designated meal hours'}`;
    }
    if (timerStatusLabel) timerStatusLabel.textContent = 'Counter Closed';
    if (timerHelperNote) timerHelperNote.textContent = 'Passes can only be redeemed during designated meal shifts.';
  }

  // Hide post-burn screens if not burning
  if (!isBurnScreenActive) {
    document.getElementById('tokenBurntScreen')?.classList.add('hidden');
    document.getElementById('tokenAlreadyBurntState')?.classList.add('hidden');
  }

  // Handle Token States in Widget 3 & Widget 4
  if (!slot.active) {
    if (tokenReadyBox) tokenReadyBox.classList.add('hidden');
    if (sliderContainer) {
      sliderContainer.classList.remove('opacity-50', 'pointer-events-none');
      sliderContainer.classList.add('opacity-50', 'pointer-events-none');
    }
    if (swipeLabel) swipeLabel.textContent = 'Counter Closed';
    updateCircularTimerProgress(0, '00:00');
    return;
  }

  // Slot is active
  if (canClaim) {
    if (tokenReadyBox) tokenReadyBox.classList.remove('hidden');
    if (sliderContainer) {
      sliderContainer.classList.remove('opacity-50', 'pointer-events-none');
    }
    if (swipeLabel) swipeLabel.textContent = 'Slide to Claim & Collect >>>';
    resetSwipeSlider();
    updateCircularTimerShiftRemaining(slot);
    return;
  }

  if (token) {
    if (token.status === 'CLAIMED') {
      if (tokenReadyBox) tokenReadyBox.classList.add('hidden');
      if (sliderContainer) {
        sliderContainer.classList.remove('opacity-50', 'pointer-events-none');
      }
      if (swipeLabel) swipeLabel.textContent = `Slide to Collect ${token.item_name} >>>`;
      resetSwipeSlider();
      updateCircularTimerShiftRemaining(slot);
    } else if (token.status === 'BURNT') {
      if (tokenReadyBox) tokenReadyBox.classList.add('hidden');
      if (sliderContainer) {
        sliderContainer.classList.add('opacity-50', 'pointer-events-none');
      }
      if (swipeLabel) swipeLabel.textContent = 'Already Collected';
      if (!isBurnScreenActive) {
        document.getElementById('tokenAlreadyBurntState')?.classList.remove('hidden');
      }
      updateCircularTimerProgress(100, 'DONE');
    }
  }
}

// ------------------------------------------
// Widget 4: Circular Timer Logic & Animation
// ------------------------------------------
function updateCircularTimerProgress(percentage, text) {
  const ring = document.getElementById('timerProgressRing');
  const display = document.getElementById('timerCountdownDisplay');
  
  if (display) display.textContent = text;
  if (ring) {
    const offset = CIRCLE_CIRCUMFERENCE - (CIRCLE_CIRCUMFERENCE * (Math.min(100, Math.max(0, percentage)) / 100));
    ring.style.strokeDashoffset = offset;
  }
}

function updateCircularTimerShiftRemaining(slot) {
  // Approximate minutes left based on simulated or current time
  const now = new Date();
  const currentMins = simulatedMinutes !== null ? simulatedMinutes : (now.getHours() * 60 + now.getMinutes());
  
  let endMins = 1200; // default 8:00 PM
  if (slot.id === 'evening_snacks') endMins = 1110; // 6:30 PM
  if (slot.id === 'dinner') endMins = 1320; // 10:00 PM

  const diffMins = Math.max(0, endMins - currentMins);
  const hrs = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  const timeDisplay = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;

  // Assume a shift duration of ~120 mins
  const pct = Math.round(((120 - Math.min(120, diffMins)) / 120) * 100);
  updateCircularTimerProgress(pct, timeDisplay);
}

// ------------------------------------------
// Claim Token Button
// ------------------------------------------
const btnClaimToken = document.getElementById('btnClaimToken');
if (btnClaimToken) {
  btnClaimToken.addEventListener('click', async () => {
    btnClaimToken.disabled = true;
    const payload = { user_id: currentUser.id };

    try {
      const res = await fetch(API_BASE + '/api/card/claim-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'Failed to claim token', true);
        return;
      }

      showToast('Token ready! Slide to redeem.');
      if (window.confetti) {
        confetti({
          particleCount: 35,
          spread: 50,
          origin: { y: 0.6 },
          colors: ['#10b981', '#0c2b20', '#f59e0b']
        });
      }
      refreshCardStatus();
    } catch (err) {
      showToast('Network error claiming token', true);
    } finally {
      btnClaimToken.disabled = false;
    }
  });
}

// ------------------------------------------
// Widget 3: "Slide to Collect" Gesture Slider
// ------------------------------------------
const swipeTrack = document.getElementById('swipeTrack');
const swipeThumb = document.getElementById('swipeThumb');
const swipeFill = document.getElementById('swipeFill');
const swipeLabel = document.getElementById('swipeLabel');

let isDragging = false;
let startX = 0;
let currentX = 0;
let maxDrag = 0;

function resetSwipeSlider() {
  isDragging = false;
  if (swipeThumb) swipeThumb.style.transform = `translateX(0px)`;
  if (swipeFill) swipeFill.style.width = `0px`;
  if (swipeLabel) swipeLabel.style.opacity = '1';
}

function handleStart(e) {
  if (!currentSlotData?.slot?.active) return;
  isDragging = true;
  startX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
  maxDrag = swipeTrack.clientWidth - swipeThumb.clientWidth - 8;
  swipeThumb.style.transition = 'none';
  swipeFill.style.transition = 'none';
}

function handleMove(e) {
  if (!isDragging) return;
  const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
  const deltaX = Math.max(0, Math.min(clientX - startX, maxDrag));
  currentX = deltaX;

  swipeThumb.style.transform = `translateX(${deltaX}px)`;
  swipeFill.style.width = `${deltaX + 24}px`;

  const progress = deltaX / maxDrag;
  swipeLabel.style.opacity = `${1 - progress}`;
}

async function handleEnd() {
  if (!isDragging) return;
  isDragging = false;

  // Threshold to trigger burn: 85% of track
  if (currentX >= maxDrag * 0.85) {
    swipeThumb.style.transform = `translateX(${maxDrag}px)`;
    swipeFill.style.width = `100%`;
    await triggerRedemption();
  } else {
    swipeThumb.style.transition = 'transform 0.25s ease-out';
    swipeFill.style.transition = 'width 0.25s ease-out';
    resetSwipeSlider();
  }
}

if (swipeThumb) {
  swipeThumb.addEventListener('mousedown', handleStart);
  window.addEventListener('mousemove', handleMove);
  window.addEventListener('mouseup', handleEnd);

  swipeThumb.addEventListener('touchstart', handleStart, { passive: true });
  window.addEventListener('touchmove', handleMove, { passive: true });
  window.addEventListener('touchend', handleEnd);
}

async function triggerRedemption() {
  // If token is not yet claimed, claim it first automatically
  if (!currentToken || currentToken.status !== 'CLAIMED') {
    const payload = { user_id: currentUser.id };
    try {
      const res = await fetch(API_BASE + '/api/card/claim-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Could not ready token', true);
        resetSwipeSlider();
        return;
      }
      currentToken = data.token;
    } catch (e) {
      showToast('Network error preparing token', true);
      resetSwipeSlider();
      return;
    }
  }

  // Now burn token
  try {
    const res = await fetch(API_BASE + '/api/card/burn-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser.id,
        token_id: currentToken.id
      })
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Could not redeem token', true);
      resetSwipeSlider();
      refreshCardStatus();
      return;
    }

    // Success! Show 15-second Verification Screen
    const burntItem = document.getElementById('burntItemDisplay');
    if (burntItem) burntItem.textContent = currentToken.item_name;
    document.getElementById('tokenBurntScreen')?.classList.remove('hidden');
    isBurnScreenActive = true;

    if (navigator.vibrate) {
      navigator.vibrate([100, 50, 200]);
    }

    if (window.confetti) {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.5 },
        colors: ['#10b981', '#0c2b20', '#34d399', '#ffffff', '#f59e0b']
      });
    }

    startBurnCountdown(15);
  } catch (err) {
    showToast('Network error redeeming token', true);
    resetSwipeSlider();
  }
}

// ------------------------------------------
// 15-Second Verification Countdown
// ------------------------------------------
function startBurnCountdown(seconds) {
  clearInterval(burnCountdownInterval);
  let timeLeft = seconds;
  const countEl = document.getElementById('burnCountdown');
  const liveClockEl = document.getElementById('burntLiveClock');
  const liveDateEl = document.getElementById('burntLiveDate');
  if (countEl) countEl.textContent = `${timeLeft}s`;

  updateBurntClock(liveClockEl, liveDateEl);
  updateCircularTimerProgress(100, `${timeLeft}s`);

  burnCountdownInterval = setInterval(() => {
    timeLeft -= 1;
    updateBurntClock(liveClockEl, liveDateEl);

    if (timeLeft <= 0) {
      clearInterval(burnCountdownInterval);
      isBurnScreenActive = false;
      document.getElementById('tokenBurntScreen')?.classList.add('hidden');
      document.getElementById('tokenAlreadyBurntState')?.classList.remove('hidden');
      refreshCardStatus();
    } else {
      if (countEl) countEl.textContent = `${timeLeft}s`;
      // Animate circular timer draining
      const pct = Math.round((timeLeft / 15) * 100);
      updateCircularTimerProgress(pct, `${timeLeft}s`);
    }
  }, 1000);
}

function updateBurntClock(clockEl, dateEl) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  if (clockEl) clockEl.textContent = timeStr;
  if (dateEl) dateEl.textContent = dateStr;
}

// ------------------------------------------
// Real-Time Dynamic Clocks
// ------------------------------------------
function startLiveClock() {
  if (liveClockInterval) clearInterval(liveClockInterval);
  liveClockInterval = setInterval(() => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour12: true });
    
    const timerClock = document.getElementById('timerLiveClock');
    if (timerClock) timerClock.textContent = timeStr;
  }, 1000);
}

function stopLiveClock() {
  if (liveClockInterval) clearInterval(liveClockInterval);
}


// Logout
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    currentUser = null;
    localStorage.removeItem('mess_user');
    switchView('authView');
    document.getElementById('authStep2')?.classList.add('hidden');
    document.getElementById('authStep1')?.classList.remove('hidden');
    optionsDropdown?.classList.add('hidden');
  });
}

// ------------------------------------------
// App Initialization
// ------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  initIcons();
  initTheme();

  const savedUser = localStorage.getItem('mess_user');
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      if (!currentUser.isProfileComplete) {
        switchView('profileSetupView');
      } else {
        setupCardProfile(currentUser);
        switchView('cardView');
      }
    } catch (e) {
      localStorage.removeItem('mess_user');
      switchView('authView');
    }
  } else {
    switchView('authView');
  }

  // Register Service Worker for Mobile PWA installation
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW registration error:', err));
  }
});

// ------------------------------------------
// Mobile App Installation (PWA / WebAPK)
// ------------------------------------------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = document.getElementById('installAppBanner');
  if (banner) banner.classList.remove('hidden');
});

function triggerInstallPrompt() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        showToast('Kalam Mess App installed on your phone! 🎉');
      }
      deferredPrompt = null;
      document.getElementById('installAppBanner')?.classList.add('hidden');
    });
  } else {
    showToast('To install: Tap your phone browser menu (⋮) and tap "Install App" or "Add to Home Screen"');
  }
}

document.getElementById('btnInstallApp')?.addEventListener('click', triggerInstallPrompt);
document.getElementById('btnBannerInstall')?.addEventListener('click', triggerInstallPrompt);

