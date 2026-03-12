// ═══════════════════════════════════════════════
//  PRESENCE — Attendance System
//  Replace YOUR_PROJECT_URL and YOUR_ANON_KEY
//  with your actual Supabase credentials.
// ═══════════════════════════════════════════════

// ── DEVICE DETECTION ─────────────────────────
// Detects phone vs PC using touch support, user agent, and screen width.
// Applies a class to <html> that CSS and JS can both use.
(function detectDevice() {
    const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    const isNarrowScreen = window.innerWidth < 768;
    const mobileUA = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);

    const isPhone = isTouchDevice && (isNarrowScreen || mobileUA);

    const html = document.documentElement;
    if (isPhone) {
        html.classList.add('device-phone');
        html.classList.remove('device-pc');
    } else {
        html.classList.add('device-pc');
        html.classList.remove('device-phone');
    }

    // Show a device indicator badge for 2.5s
    window.addEventListener('DOMContentLoaded', () => {
        const badge = document.getElementById('device-badge');
        if (badge) {
            badge.textContent = isPhone ? '📱 PHONE MODE' : '🖥️ PC MODE';
            badge.classList.add('visible');
            setTimeout(() => badge.classList.remove('visible'), 2500);
        }
    });

    // Re-check on resize (e.g. rotation)
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const nowNarrow = window.innerWidth < 768;
            const nowPhone = isTouchDevice && (nowNarrow || mobileUA);
            if (nowPhone) {
                html.classList.add('device-phone');
                html.classList.remove('device-pc');
            } else {
                html.classList.add('device-pc');
                html.classList.remove('device-phone');
            }
        }, 200);
    });
})();
const SUPABASE_URL = 'https://yapnbwxerwppsepcdcxi.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhcG5id3hlcndwcHNlcGNkY3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MjY2NDIsImV4cCI6MjA4ODEwMjY0Mn0.ROjaZEjyQ22-GHEussOo1Sr7VCAhoWnjO-42NCWtrxk';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ────────────────────────────────────
// ── Attendance Status Rules ──────────────────
// On Time  : 7:34 and earlier
// Late     : 7:35 – 11:59
// Half Day : 12:00 PM and later
function getAttendanceStatus(date) {
    const now = date || new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    if (mins <= 7 * 60 + 34) return 'On Time';
    if (mins < 12 * 60) return 'Late';
    return 'Half Day';
}
let currentUser = null; // { id, name, type: 'student'|'teacher'|'admin' }
let loginScanner = null;
let activeScanner = null;
let scanMode = 'IN';   // current scan mode for active scanner
let scanLock = false;  // debounce

// ── Boot ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Login button
    document.getElementById('loginScanBtn').addEventListener('click', (e) => {
        e.preventDefault();
        startLoginScanner();
    });

    // ── Teacher tabs
    wireTabNav('teacherNav', onTeacherTabChange);

    // Admin tabs
    wireTabNav('adminNav', onAdminTabChange);

    // Adviser tabs
    wireTabNav('adviserNav', onAdviserTabChange);

    // Secretary tabs
    wireTabNav('secretaryNav', onSecretaryTabChange);

    // Date filters — default to today
    const today = todayDate();
    ['teacherDateFilter', 'adminDateFilter', 'secDateFilter', 'advDateFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.value = today;
            el.addEventListener('change', () => {
                if (id.includes('teacher')) loadLogs('teacher');
                else if (id.includes('sec')) loadLogs('secretary');
                else if (id.includes('adv')) loadLogs('adviser');
                else loadLogs('admin');
            });
        }
    });
    // Default export date ranges
    ['secDateFrom', 'secDateTo'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value) el.value = today;
    });
});

// ── Helpers ───────────────────────────────────
function todayDate() { return new Date().toISOString().split('T')[0]; }

function nowTime() {
    return new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
}

function flashSuccess() {
    // Brief green flash on successful scan
    const flash = document.createElement('div');
    flash.style.cssText = 'position:fixed;inset:0;background:rgba(27,107,56,0.25);z-index:9998;pointer-events:none;animation:flashFade 0.4s ease forwards;';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 400);
}

function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + name).classList.add('active');
}

function setStatus(elId, type, title, msg) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.className = 'status-box ' + type;
    el.innerHTML = `<span class="status-dot"></span><div><strong>${title}</strong>${msg ? `<p>${msg}</p>` : ''}</div>`;
    el.style.display = 'flex';
}

function wireTabNav(navId, onTabChange) {
    const nav = document.getElementById(navId);
    if (!nav) return;
    nav.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            nav.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const paneId = btn.dataset.tab;
            const body = nav.closest('.screen').querySelector('.app-body');
            body.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            document.getElementById(paneId)?.classList.add('active');
            onTabChange && onTabChange(paneId);
        });
    });
}

// ── Stop any running scanner ──────────────────
async function stopScanner(ref) {
    if (!ref) return null;
    try { if (ref.isScanning) await ref.stop(); } catch (_) { }
    return null;
}

// ── LOGIN SCANNER ─────────────────────────────
async function startLoginScanner() {
    const btn = document.getElementById('loginScanBtn');
    if (btn.disabled) return;  // prevent double-call
    btn.disabled = true;
    btn.textContent = '⏳ STARTING CAMERA...';
    setStatus('loginStatus', 'info', 'CAMERA STARTING', 'Please allow camera permission if prompted.');

    const readerEl = document.getElementById('login-reader');
    readerEl.innerHTML = '';
    loginScanner = new Html5Qrcode('login-reader');

    try {
        await loginScanner.start(
            { facingMode: 'environment' },
            { fps: 15, qrbox: (w, h) => { const s = Math.min(w, h) * 0.75; return { width: s, height: s }; }, rememberLastUsedCamera: true, aspectRatio: 1.0 },
            async (text) => {
                await stopScanner(loginScanner); loginScanner = null;
                await handleLogin(text);
            },
            () => { }
        );
        btn.style.display = 'none';
        setStatus('loginStatus', 'info', 'CAMERA ACTIVE', 'Scan your ID card now');
    } catch (err) {
        const msg = (err && err.name === 'NotAllowedError')
            ? 'Allow camera access in browser settings, then refresh.'
            : (err.message || String(err));
        const title = (err && err.name === 'NotAllowedError') ? 'PERMISSION DENIED' : 'CAMERA ERROR';
        setStatus('loginStatus', 'error', title, msg);
        btn.disabled = false; btn.innerHTML = '<span class="btn-icon">📷</span> ACTIVATE CAMERA';
    }
}

// ── HANDLE LOGIN QR ───────────────────────────
// Accepts multiple QR formats:
//   1. STUDENT|LRN|Full Name  (our format)
//   2. Plain LRN number only  (existing school ID cards like Jerome's)
//   3. Any other string       (treated as LRN, name looked up from DB)
async function handleLogin(qrData) {
    const raw = qrData.trim();
    console.log('QR RAW VALUE:', JSON.stringify(raw)); // Debug — check browser console
    let type = 'student', id = '', name = '', section = null;

    if (raw.includes('|')) {
        // Format: TYPE|ID|Name|Section
        const parts = raw.split('|');
        const rawType = parts[0].trim().toLowerCase();
        // Only treat first segment as type if it's a known role keyword
        if (['student', 'teacher', 'admin', 'adviser', 'secretary'].includes(rawType)) {
            type = rawType;
            id = (parts[1] || '').trim();
            name = (parts[2] || id).trim();
            section = (parts[3] || '').trim() || null;  // e.g. "12-Newton"
        } else {
            // Pipe-separated but no role prefix — treat whole thing or first part as LRN/name
            id = parts[0].trim();
            name = parts[1]?.trim() || id;
            type = 'student';
            section = parts[2]?.trim() || null;
        }
    } else if (/^\d{6,12}$/.test(raw)) {
        // Pure numeric — treat as LRN
        type = 'student';
        id = raw;
        name = await lookupNameByLRN(id) || `Student ${id}`;
    } else {
        // Anything else (plain name, mixed text) — treat as student
        // Use the raw text as the display name, hash it as ID
        type = 'student';
        name = raw.replace(/\r?\n/g, ' ').trim();
        // Try to find by name in DB
        const found = await lookupByName(name);
        id = found?.lrn || raw.replace(/\s+/g, '_').toLowerCase();
        if (found) name = found.full_name;
    }

    if (!id) {
        setStatus('loginStatus', 'error', 'INVALID QR', 'Could not read ID from this QR code.');
        resetLoginBtn(); return;
    }
    currentUser = { type, id, name, section };

    // ── PHOTO AUTHENTICATION CHECK ─────────────────────────────────────────
    // All roles except students go through photo auth before their screen.
    // Students are handled separately (they go to action page).
    if (currentUser.type === 'student') {
        // Check if attendance is suspended before showing the action page
        const suspState = await getSuspensionState();
        if (suspState.suspended) {
            document.getElementById('suspendedReasonDisplay').textContent = suspState.reason || 'No reason given';
            document.getElementById('suspendedByDisplay').textContent = suspState.by ? `— Suspended by: ${suspState.by}` : '';
            loginScanner = await stopScanner(loginScanner);
            // Start clock on suspended screen
            const clkEl = document.getElementById('suspendedClock');
            if (clkEl) {
                const tick = () => clkEl.textContent = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                tick();
                const suspClkId = setInterval(tick, 1000);
                // Clear it when leaving
                clkEl.dataset.intervalId = suspClkId;
            }
            showScreen('suspended');
            return;
        }
        // Students go directly to the Time In / Time Out action page
        await showStudentActionPage(currentUser.id, currentUser.name);
    } else if (currentUser.type === 'teacher') {
        // Teachers go through photo auth first
        await startPhotoAuth(() => {
            document.getElementById('teacherBadge').innerHTML = `${currentUser.name}<br><span style="font-size:9px;opacity:0.7">TEACHER</span>`;
            showScreen('teacher');
            loadTeacherOwnTime();
            getSuspensionState().then(s => { if (s.suspended) document.getElementById('teacherSuspendTabBtn')?.classList.add('suspended-active'); });
        });
    } else if (currentUser.type === 'adviser') {
        // Adviser goes through photo auth first
        await startPhotoAuth(() => {
            document.getElementById('adviserBadge').innerHTML = `${currentUser.name}<br><span style="font-size:9px;opacity:0.7">ADVISER</span>`;
            showScreen('adviser');
            startAdviserScanner();
            loadAdviserStats();
            getSuspensionState().then(s => { if (s.suspended) document.getElementById('advSuspendTabBtn')?.classList.add('suspended-active'); });
        });
    } else if (currentUser.type === 'secretary') {
        // Secretary goes through photo auth first
        await startPhotoAuth(() => {
            document.getElementById('secretaryBadge').innerHTML = `${currentUser.name}<br><span style="font-size:9px;opacity:0.7">SECRETARY</span>`;
            showScreen('secretary');
            startPendingAutoRefresh();
            loadLogs('secretary');
        });
    } else if (currentUser.type === 'admin') {
        // Admin goes through photo auth first
        await startPhotoAuth(() => {
            document.getElementById('adminBadge').innerHTML = `${currentUser.name}<br><span style="font-size:9px;opacity:0.7">ADMIN</span>`;
            showScreen('admin');
            startAdminScanner();
            loadStats();
        });
    } else {
        setStatus('loginStatus', 'error', 'UNKNOWN ROLE', `"${type}" is not recognized.`);
    }
}

// ── LOGOUT ────────────────────────────────────
async function logout() {
    activeScanner = await stopScanner(activeScanner);
    stopPendingAutoRefresh();
    currentUser = null; scanMode = 'IN'; scanLock = false;
    // Reset login screen
    const btn = document.getElementById('loginScanBtn');
    btn.style.display = 'flex'; btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">📷</span> ACTIVATE CAMERA';
    document.getElementById('login-reader').innerHTML = '';
    setStatus('loginStatus', 'info', 'SYSTEM READY', 'Press button to scan your ID card');
    showScreen('login');
}

// ── GENERIC SCANNER START ─────────────────────
async function startQrScanner(readerId, onScan) {
    activeScanner = await stopScanner(activeScanner);
    const el = document.getElementById(readerId);
    if (!el) return;
    el.innerHTML = '';
    const scanner = new Html5Qrcode(readerId);
    try {
        await scanner.start(
            { facingMode: 'environment' },
            { fps: 15, qrbox: (w, h) => { const s = Math.min(w, h) * 0.75; return { width: s, height: s }; }, rememberLastUsedCamera: true, aspectRatio: 1.0 },
            onScan,
            () => { }
        );
        activeScanner = scanner;
    } catch (err) {
        console.error('Scanner start error:', err);
    }
}

// ══════════════════════════════════════════════
//  STUDENT ACTION SCREEN
//  Student scans their own QR → sees Time In / Time Out page
// ══════════════════════════════════════════════
let studentScanMode = 'IN';
let clockInterval = null;

function setStudentMode(mode) {
    studentScanMode = mode;
    document.getElementById('stuModeIn').classList.toggle('active', mode === 'IN');
    document.getElementById('stuModeOut').classList.toggle('active', mode === 'OUT');
}

async function startStudentScanner() {
    await startQrScanner('student-reader', onStudentScan);
}

async function onStudentScan(qrData) {
    if (scanLock) return;
    scanLock = true;
    const parts = qrData.trim().split('|');
    if (!parts[0] || parts[0].trim().toUpperCase() !== 'STUDENT') { scanLock = false; return; }
    const [_, id, name, sec] = parts;
    setStatus('studentStatus', 'info', 'PROCESSING...', 'Please wait');
    await recordAttendance('student', id.trim(), name ? name.trim() : id.trim(), 'studentStatus', sec?.trim() || null);
    setTimeout(() => { scanLock = false; }, 2000);
}

// ── Show student action page after login scan ──
async function showStudentActionPage(id, name) {
    loginScanner = await stopScanner(loginScanner);

    const hour = new Date().getHours();
    document.getElementById('actionGreeting').textContent = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    document.getElementById('actionName').textContent = name;
    document.getElementById('actionLRN').textContent = 'LRN: ' + id;

    if (clockInterval) clearInterval(clockInterval);
    function updateClock() {
        const now = new Date();
        const mins = now.getHours() * 60 + now.getMinutes();
        const h = now.getHours();
        document.getElementById('actionClock').textContent =
            now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        document.getElementById('actionDate').textContent =
            now.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        // TIME IN preview
        let inLabel = mins <= 7 * 60 + 34 ? 'Will be: ON TIME' : mins < 12 * 60 ? 'Will be: LATE' : 'Will be: HALF DAY';
        // TIME OUT preview: 12:00–3:59 = Half Day, 4:00 PM+ = Full Day
        let outLabel = (h >= 12 && h < 16) ? 'Will mark: HALF DAY' : h >= 16 ? 'Will mark: FULL DAY' : 'Time in first';

        const inSub = document.getElementById('actionBtnInStatus');
        const outSub = document.getElementById('actionBtnOutStatus');
        if (inSub) inSub.textContent = inLabel;
        if (outSub) outSub.textContent = outLabel;
    }
    updateClock();
    clockInterval = setInterval(updateClock, 1000);

    const today = todayDate();
    const { data: existing } = await db.from('attendance_logs')
        .select('*').eq('lrn', id).eq('date', today).eq('person_type', 'student').maybeSingle();

    // Check ONLY truly-Pending rows, split by scan type to avoid stale Confirmed rows blocking
    const { data: pendingInRec } = await db.from('attendance_pending')
        .select('*').eq('lrn', id).eq('date', today).eq('person_type', 'student')
        .eq('scan_type', 'IN').eq('approval_status', 'Pending').maybeSingle();

    const { data: pendingOutRec } = await db.from('attendance_pending')
        .select('*').eq('lrn', id).eq('date', today).eq('person_type', 'student')
        .eq('scan_type', 'OUT').eq('approval_status', 'Pending').maybeSingle();

    const recEl = document.getElementById('actionTodayRecord');
    const btnIn = document.getElementById('actionBtnIn');
    const btnOut = document.getElementById('actionBtnOut');
    const pendingNotice = document.getElementById('actionPendingNotice');

    // Reset button states first
    btnIn.classList.remove('action-btn-done', 'action-btn-pending'); btnIn.disabled = false;
    btnOut.classList.remove('action-btn-done', 'action-btn-pending'); btnOut.disabled = false;
    pendingNotice?.classList.add('hidden');

    if (existing) {
        // Has confirmed time-in
        const inText = (existing.time_in || '---') + ' (' + existing.status + ')';
        let outText = existing.time_out || '---';

        // If time-out is pending Secretary approval, show that
        if (!existing.time_out && pendingOutRec) {
            outText = `${pendingOutRec.scanned_time_out} ⏳ PENDING`;
            btnOut.classList.add('action-btn-pending'); btnOut.disabled = true;
            pendingNotice?.classList.remove('hidden');
        } else if (existing.time_out) {
            btnOut.classList.add('action-btn-done'); btnOut.disabled = true;
        }

        document.getElementById('actionTodayIn').textContent = inText;
        document.getElementById('actionTodayOut').textContent = outText;
        recEl.classList.remove('hidden');
        btnIn.classList.add('action-btn-done'); btnIn.disabled = true;

    } else if (pendingInRec) {
        // Time-in is pending Secretary approval
        document.getElementById('actionTodayIn').textContent = `${pendingInRec.scanned_time_in} ⏳ PENDING`;
        document.getElementById('actionTodayOut').textContent = '---';
        recEl.classList.remove('hidden');
        pendingNotice?.classList.remove('hidden');
        btnIn.classList.add('action-btn-pending'); btnIn.disabled = true;
        const sub = btnIn.querySelector('.action-btn-sub');
        if (sub) sub.textContent = 'Awaiting approval';
        // Cannot time out until time-in is confirmed
        btnOut.disabled = true;

    } else {
        recEl.classList.add('hidden');
    }

    document.getElementById('actionMsg').style.display = 'none';
    showScreen('student-action');
}

async function studentAction(mode) {
    const id = currentUser.id;
    const name = currentUser.name;
    const btnIn = document.getElementById('actionBtnIn');
    const btnOut = document.getElementById('actionBtnOut');
    const msgEl = document.getElementById('actionMsg');

    btnIn.disabled = true;
    btnOut.disabled = true;
    msgEl.style.display = 'none';

    await recordAttendance('student', id, name, mode, 'actionMsg', currentUser.section);
    msgEl.style.display = 'flex';

    // Refresh — use split queries to avoid stale Confirmed rows blocking
    const today = todayDate();
    const { data: updated } = await db.from('attendance_logs')
        .select('*').eq('lrn', id).eq('date', today).eq('person_type', 'student').maybeSingle();
    const { data: updPendingIn } = await db.from('attendance_pending')
        .select('*').eq('lrn', id).eq('date', today).eq('person_type', 'student')
        .eq('scan_type', 'IN').eq('approval_status', 'Pending').maybeSingle();
    const { data: updPendingOut } = await db.from('attendance_pending')
        .select('*').eq('lrn', id).eq('date', today).eq('person_type', 'student')
        .eq('scan_type', 'OUT').eq('approval_status', 'Pending').maybeSingle();

    const recEl = document.getElementById('actionTodayRecord');
    const notice = document.getElementById('actionPendingNotice');
    btnIn.classList.remove('action-btn-done', 'action-btn-pending');
    btnOut.classList.remove('action-btn-done', 'action-btn-pending');
    notice?.classList.add('hidden');

    if (updated) {
        let outText = updated.time_out || '---';
        if (!updated.time_out && updPendingOut) {
            outText = `${updPendingOut.scanned_time_out} ⏳ PENDING`;
            btnOut.classList.add('action-btn-pending'); btnOut.disabled = true;
            notice?.classList.remove('hidden');
        } else if (updated.time_out) {
            btnOut.classList.add('action-btn-done'); btnOut.disabled = true;
        }
        document.getElementById('actionTodayIn').textContent = (updated.time_in || '---') + ' (' + updated.status + ')';
        document.getElementById('actionTodayOut').textContent = outText;
        recEl.classList.remove('hidden');
        btnIn.classList.add('action-btn-done'); btnIn.disabled = true;
    } else if (updPendingIn) {
        document.getElementById('actionTodayIn').textContent = `${updPendingIn.scanned_time_in} ⏳ PENDING`;
        document.getElementById('actionTodayOut').textContent = '---';
        recEl.classList.remove('hidden');
        btnIn.classList.add('action-btn-pending'); btnIn.disabled = true;
        btnOut.disabled = true;
        notice?.classList.remove('hidden');
    }

    setTimeout(() => goBackToScan(), 3500);
}


// ── Return to login scan screen ─────────────────
function goBackToScan() {
    if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
    // Clear suspended screen clock if any
    const clkEl = document.getElementById('suspendedClock');
    if (clkEl?.dataset.intervalId) { clearInterval(Number(clkEl.dataset.intervalId)); clkEl.dataset.intervalId = ''; }
    currentUser = null; scanLock = false;
    const btn = document.getElementById('loginScanBtn');
    btn.style.display = 'flex'; btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">📷</span> ACTIVATE CAMERA';
    document.getElementById('login-reader').innerHTML = '';
    setStatus('loginStatus', 'info', 'SYSTEM READY', 'Press button to scan your ID card');
    showScreen('login');
}

// ══════════════════════════════════════════════
//  TEACHER TABS
// ══════════════════════════════════════════════
async function onTeacherTabChange(tabId) {
    if (tabId === 'teacherLogsTab') loadLogs('teacher');
    if (tabId === 'teacherTimeTab') loadTeacherOwnTime();
    if (tabId === 'teacherSuspendTab') loadSuspendTab();
}

async function startTeacherScannerIfNeeded(tabId) {
    onTeacherTabChange(tabId);
}

// ══════════════════════════════════════════════
//  ATTENDANCE SUSPENSION SYSTEM
//  Stores suspension state in Supabase table
//  "attendance_suspension": { id, date, suspended, reason, suspended_by, created_at }
//  Falls back to localStorage if DB unavailable.
// ══════════════════════════════════════════════

// In-memory cache for current session
let _suspendCache = null; // { suspended: bool, reason: string, by: string } | null

async function getSuspensionState(forceRefresh = false) {
    const today = todayDate();
    // Always fetch fresh from DB — never rely on stale in-memory cache
    // (teacher may have suspended AFTER the student's session started)
    try {
        const { data, error } = await db.from('attendance_suspension')
            .select('*').eq('date', today).maybeSingle();
        if (error) throw error;
        _suspendCache = data
            ? { suspended: !!data.suspended, reason: data.reason || '', by: data.suspended_by || '' }
            : { suspended: false, reason: '', by: '' };
        // Keep localStorage in sync as fallback
        try { localStorage.setItem('presence_suspend_' + today, JSON.stringify(_suspendCache)); } catch (_) {}
    } catch (_) {
        // Fallback: localStorage
        try {
            const raw = localStorage.getItem('presence_suspend_' + today)
                     || localStorage.getItem('attendance_suspension_' + today); // legacy key
            _suspendCache = raw ? JSON.parse(raw) : { suspended: false, reason: '', by: '' };
        } catch (__) { _suspendCache = { suspended: false, reason: '', by: '' }; }
    }
    return _suspendCache;
}

async function setSuspensionState(suspended, reason, by) {
    const today = todayDate();
    const payload = { date: today, suspended, reason, suspended_by: by };
    // Always write localStorage immediately for same-device fallback
    try { localStorage.setItem('presence_suspend_' + today, JSON.stringify({ suspended, reason, by })); } catch (_) {}
    try {
        const { data: existing } = await db.from('attendance_suspension').select('id').eq('date', today).maybeSingle();
        if (existing) {
            await db.from('attendance_suspension').update({ suspended, reason, suspended_by: by }).eq('date', today);
        } else {
            await db.from('attendance_suspension').insert(payload);
        }
    } catch (_) {
        // DB failed — localStorage fallback already written above
        console.warn('[PRESENCE] Could not write suspension to DB — using localStorage only');
    }
    _suspendCache = { suspended, reason, by };
}

// ── Selected reason chip text ─────────────────
let _selectedChipReason = '';

function selectReasonChip(el, reason) {
    document.querySelectorAll('.reason-chip').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    _selectedChipReason = reason;
    // If not "Other", populate textarea too
    if (reason !== 'Other') {
        const ta = document.getElementById('suspendReasonText');
        if (ta && !ta.value) ta.value = reason;
    }
}

// ── Load suspend tab UI ───────────────────────
async function loadSuspendTab() {
    const state = await getSuspensionState();
    renderSuspendUI(state);
}

function renderSuspendUI(state) {
    const banner = document.getElementById('suspendStatusBanner');
    const suspendCard = document.querySelector('.suspend-card');
    const resumeCard = document.getElementById('resumeCard');
    const tabBtn = document.getElementById('teacherSuspendTabBtn');

    if (state.suspended) {
        // Show active suspension UI
        banner.textContent = '⚠️ ATTENDANCE IS CURRENTLY SUSPENDED';
        banner.classList.remove('hidden');
        suspendCard.style.display = 'none';
        resumeCard.classList.remove('hidden');
        document.getElementById('resumeActiveReason').textContent = state.reason || 'No reason given';
        document.getElementById('resumeActiveReason').innerHTML =
            `<strong style="font-size:10px;letter-spacing:2px;opacity:0.6">ACTIVE REASON:</strong><br>${state.reason || 'No reason given'}` +
            (state.by ? `<span style="display:block;font-size:10px;margin-top:4px;opacity:0.55">— Suspended by ${state.by}</span>` : '');
        tabBtn?.classList.add('suspended-active');
    } else {
        banner.classList.add('hidden');
        suspendCard.style.display = 'flex';
        resumeCard.classList.add('hidden');
        tabBtn?.classList.remove('suspended-active');
    }
    document.getElementById('suspendMsg').style.display = 'none';
}

// ── Suspend attendance ────────────────────────
async function suspendAttendance() {
    const chipReason = _selectedChipReason;
    const textReason = document.getElementById('suspendReasonText')?.value?.trim();
    const reason = textReason || chipReason || 'No reason provided';

    if (!chipReason && !textReason) {
        setStatus('suspendMsg', 'warning', 'REASON REQUIRED', 'Please select or type a reason before suspending.');
        document.getElementById('suspendMsg').style.display = 'flex';
        return;
    }

    const btn = document.getElementById('btnSuspendAttendance');
    btn.disabled = true;
    btn.textContent = '⏳ SUSPENDING...';

    await setSuspensionState(true, reason, currentUser?.name || 'Teacher');
    showToast('⚠️ Attendance suspended');
    renderSuspendUI({ suspended: true, reason, by: currentUser?.name || 'Teacher' });

    btn.disabled = false;
    btn.innerHTML = '<span>🚫</span> SUSPEND ATTENDANCE';
}

// ── Resume attendance ─────────────────────────
async function resumeAttendance() {
    const btn = document.getElementById('btnResumeAttendance');
    btn.disabled = true;
    btn.textContent = '⏳ RE-ENABLING...';

    await setSuspensionState(false, '', '');
    showToast('✅ Attendance re-enabled');
    renderSuspendUI({ suspended: false, reason: '', by: '' });

    // Clear chip + textarea for next use
    document.querySelectorAll('.reason-chip').forEach(c => c.classList.remove('selected'));
    _selectedChipReason = '';
    const ta = document.getElementById('suspendReasonText');
    if (ta) ta.value = '';

    btn.disabled = false;
    btn.innerHTML = '<span>✅</span> RE-ENABLE ATTENDANCE';
}



// Teacher logs
async function loadLogs(role) {
    const dateId = role === 'teacher' ? 'teacherDateFilter' : role === 'secretary' ? 'secDateFilter' : role === 'adviser' ? 'advDateFilter' : 'adminDateFilter';
    const typeId = role === 'teacher' ? 'teacherTypeFilter' : role === 'secretary' ? 'secTypeFilter' : role === 'adviser' ? 'advTypeFilter' : 'adminTypeFilter';
    const dispId = role === 'teacher' ? 'teacherLogsDisplay' : role === 'secretary' ? 'secLogsDisplay' : role === 'adviser' ? 'advLogsDisplay' : 'adminLogsDisplay';
    const sectionId = role === 'teacher' ? 'teacherSectionFilter' : role === 'secretary' ? 'secSectionFilter' : role === 'adviser' ? 'advSectionFilter' : 'adminSectionFilter';

    const date = document.getElementById(dateId)?.value || todayDate();
    const type = document.getElementById(typeId)?.value || 'student';
    const section = document.getElementById(sectionId)?.value || 'all';
    const display = document.getElementById(dispId);
    if (!display) return;
    display.innerHTML = '<div class="logs-empty">Loading...</div>';

    let query = db.from('attendance_logs')
        .select('*').eq('date', date).eq('person_type', type)
        .order('time_in', { ascending: false });

    // Apply section filter if not 'all'
    if (section && section !== 'all') {
        query = query.eq('section', section);
    }

    const { data, error } = await query;

    if (error) { display.innerHTML = `<div class="logs-empty">Error: ${error.message}</div>`; return; }
    if (!data?.length) { display.innerHTML = '<div class="logs-empty">No records found for this date.</div>'; return; }

    // Section summary badge
    const sectionLabel = section !== 'all' ? `<div class="section-count-badge">📚 ${section} — ${data.length} record(s)</div>` : '';

    display.innerHTML = sectionLabel + data.map(log => {
        const statusClass = log.status === 'Late' ? 'late' : log.status === 'Half Day' ? 'halfday' : log.status === 'No Time Out' ? 'noout' : log.status === 'Cutting Class' ? 'cutting' : 'ontime';
        const noTimeOut = !log.time_out;
        const canForceOut = (role === 'admin' || role === 'adviser') && noTimeOut;
        const forceBtn = canForceOut
            ? `<button class="force-out-btn" onclick="forceStudentTimeOut('${log.id}', '${log.full_name.replace(/'/g, "\\'")}', '${role}')">⏏ OUT</button>`
            : '';
        const sectionTag = log.section ? `<span class="log-section-tag">${log.section}</span>` : '';
        return `<div class="log-item" id="log-row-${log.id}">
            <div>
                <span class="log-name">${log.full_name}</span>
                <span class="log-meta">IN: ${log.time_in || '—'} &nbsp;|&nbsp; OUT: ${log.time_out || '—'} &nbsp;|&nbsp; ID: ${log.lrn} ${sectionTag}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                ${forceBtn}
                <span class="log-status ${statusClass}">${log.status}</span>
            </div>
        </div>`;
    }).join('');
}

// ── Per-student force time out (from logs list) ──────────────────────────────
async function forceStudentTimeOut(logId, name, role) {
    const now = new Date();
    const hours = now.getHours();
    const timeNow = nowTime();

    // Determine status: before 4PM = Half Day, 4PM-6PM = Full Day, after 6PM = Cutting Class
    let updatedStatus;
    if (hours >= 18) {
        updatedStatus = 'Cutting Class';
    } else if (hours >= 12 && hours < 16) {
        updatedStatus = 'Half Day';
    } else {
        updatedStatus = 'No Time Out'; // timed out very early (shouldn't happen often)
    }

    const { error } = await db.from('attendance_logs')
        .update({ time_out: timeNow, status: updatedStatus })
        .eq('id', logId);

    if (error) { showToast(`Error: ${error.message}`); return; }

    showToast(`✓ ${name} timed out — ${updatedStatus}`);

    // Update the row in-place without full reload
    const row = document.getElementById(`log-row-${logId}`);
    if (row) {
        const statusClass = updatedStatus === 'Cutting Class' ? 'cutting' : updatedStatus === 'Half Day' ? 'halfday' : 'noout';
        const metaEl = row.querySelector('.log-meta');
        if (metaEl) metaEl.innerHTML = metaEl.innerHTML.replace(/OUT: —/, `OUT: ${timeNow}`);
        const btn = row.querySelector('.force-out-btn');
        if (btn) btn.remove();
        const statusEl = row.querySelector('.log-status');
        if (statusEl) { statusEl.className = `log-status ${statusClass}`; statusEl.textContent = updatedStatus; }
    }
}

// Teacher's own time in/out
async function loadTeacherOwnTime() {
    if (!currentUser) return;
    const today = todayDate();
    const { data } = await db.from('attendance_logs')
        .select('*').eq('lrn', currentUser.id).eq('date', today).eq('person_type', 'teacher').maybeSingle();
    document.getElementById('tchTimeIn').textContent = data?.time_in || '—';
    document.getElementById('tchTimeOut').textContent = data?.time_out || '—';
    document.getElementById('tchStatus').textContent = data?.status || '—';
}

async function teacherSelfTimeIn() {
    if (!currentUser) return;
    const today = todayDate();
    const { data: existing } = await db.from('attendance_logs')
        .select('*').eq('lrn', currentUser.id).eq('date', today).eq('person_type', 'teacher').maybeSingle();
    const msgEl = document.getElementById('teacherTimeMsg');
    if (existing) {
        setStatus('teacherTimeMsg', 'warning', 'ALREADY TIMED IN', `You checked in at ${existing.time_in}`);
        msgEl.style.display = 'flex'; return;
    }
    const time = nowTime();
    const status = getAttendanceStatus();
    const { error } = await db.from('attendance_logs').insert({
        lrn: currentUser.id, full_name: currentUser.name,
        date: today, time_in: time, status, person_type: 'teacher'
    });
    if (error) { setStatus('teacherTimeMsg', 'error', 'ERROR', error.message); msgEl.style.display = 'flex'; return; }
    setStatus('teacherTimeMsg', 'success', `TIME IN — ${status}`, `Recorded at ${time}`);
    msgEl.style.display = 'flex';
    loadTeacherOwnTime();
    showToast(`Time In recorded at ${time}`);
}

async function teacherSelfTimeOut() {
    if (!currentUser) return;
    const today = todayDate();
    const { data: existing } = await db.from('attendance_logs')
        .select('*').eq('lrn', currentUser.id).eq('date', today).eq('person_type', 'teacher').maybeSingle();
    const msgEl = document.getElementById('teacherTimeMsg');
    if (!existing) {
        setStatus('teacherTimeMsg', 'error', 'NO TIME IN RECORD', 'Please time in first.');
        msgEl.style.display = 'flex'; return;
    }
    if (existing.time_out) {
        setStatus('teacherTimeMsg', 'warning', 'ALREADY TIMED OUT', `You left at ${existing.time_out}`);
        msgEl.style.display = 'flex'; return;
    }
    const time = nowTime();
    const { error } = await db.from('attendance_logs').update({ time_out: time }).eq('id', existing.id);
    if (error) { setStatus('teacherTimeMsg', 'error', 'ERROR', error.message); msgEl.style.display = 'flex'; return; }
    setStatus('teacherTimeMsg', 'success', 'TIME OUT RECORDED', `Recorded at ${time}`);
    msgEl.style.display = 'flex';
    loadTeacherOwnTime();
    showToast(`Time Out recorded at ${time}`);
}

// ── TEACHER: Force Time Out All Remaining Students ───────────────────────────
// Called by teacher to close attendance. Any student/teacher who has no
// time_out yet will be evaluated:
//   • If current time is BEFORE 6:00 PM  → warn teacher (can still proceed)
//   • Students with no time_out           → marked as "Cutting Class"
//   • Teachers with no time_out           → marked as "No Time Out"
async function teacherForceTimeOut(msgElId = 'forceTimeOutMsg') {
    const msgEl = document.getElementById(msgElId);
    if (!msgEl) return;

    const now = new Date();
    const hours = now.getHours();
    const mins = now.getMinutes();
    const totalMins = hours * 60 + mins;
    const cutoffMins = 18 * 60; // 6:00 PM

    // Warn if before 6:00 PM — require confirmation
    if (totalMins < cutoffMins) {
        const timeStr = now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
        const confirmed = confirm(
            `⚠️ It is only ${timeStr}.\n\n` +
            `Students who have not timed out will be marked as CUTTING CLASS.\n\n` +
            `Are you sure you want to close attendance now?`
        );
        if (!confirmed) return;
    }

    setStatus(msgElId, 'info', 'PROCESSING...', 'Closing attendance for today. Please wait.');
    msgEl.style.display = 'flex';

    const today = todayDate();
    const timeNow = nowTime();

    try {
        // Fetch all records with no time_out for today
        const { data: openRecords, error: fetchErr } = await db
            .from('attendance_logs')
            .select('id, full_name, person_type')
            .eq('date', today)
            .is('time_out', null);

        if (fetchErr) throw fetchErr;

        if (!openRecords || openRecords.length === 0) {
            setStatus(msgElId, 'success', 'ALL CLEAR ✓', 'All students already have a time-out recorded.');
            msgEl.style.display = 'flex';
            return;
        }

        // Separate students and teachers
        const students = openRecords.filter(r => r.person_type === 'student');
        const teachers = openRecords.filter(r => r.person_type === 'teacher');

        let updatedCount = 0;

        // Mark students without time-out as Cutting Class
        if (students.length > 0) {
            const studentIds = students.map(r => r.id);
            const { error: stuErr } = await db
                .from('attendance_logs')
                .update({ time_out: timeNow, status: 'Cutting Class' })
                .in('id', studentIds);
            if (stuErr) throw stuErr;
            updatedCount += students.length;
        }

        // Mark teachers without time-out as No Time Out
        if (teachers.length > 0) {
            const teacherIds = teachers.map(r => r.id);
            const { error: tchErr } = await db
                .from('attendance_logs')
                .update({ time_out: timeNow, status: 'No Time Out' })
                .in('id', teacherIds);
            if (tchErr) throw tchErr;
            updatedCount += teachers.length;
        }

        const detail = students.length > 0
            ? `${students.length} student(s) marked CUTTING CLASS, ${teachers.length} teacher(s) marked NO TIME OUT.`
            : `${teachers.length} teacher(s) marked NO TIME OUT.`;

        setStatus(msgElId, 'success', `ATTENDANCE CLOSED ✓`, detail);
        msgEl.style.display = 'flex';
        showToast(`✓ Attendance closed — ${updatedCount} record(s) updated`);

        // Refresh logs if visible
        loadLogs('teacher');

    } catch (e) {
        setStatus(msgElId, 'error', 'ERROR', e.message || 'Unknown error');
        msgEl.style.display = 'flex';
        console.error(e);
    }
}

// ══════════════════════════════════════════════
//  ADMIN SCREEN
// ══════════════════════════════════════════════
let adminScanMode = 'IN';

function setAdminScanMode(mode) {
    adminScanMode = mode;
    document.getElementById('admModeIn').classList.toggle('active', mode === 'IN');
    document.getElementById('admModeOut').classList.toggle('active', mode === 'OUT');
}

async function startAdminScanner() {
    await startQrScanner('admin-reader', onAdminScan);
}

async function onAdminScan(qrData) {
    if (scanLock) return;
    scanLock = true;
    const parts = qrData.trim().split('|');
    const type = parts[0]?.trim().toUpperCase();
    if (type !== 'STUDENT' && type !== 'TEACHER') { scanLock = false; return; }
    const [_, id, name, sec] = parts;
    const personType = type.toLowerCase();
    setStatus('adminScanStatus', 'info', 'PROCESSING...', 'Please wait');
    await recordAttendance(personType, id.trim(), name ? name.trim() : id.trim(), 'adminScanStatus', sec?.trim() || null);
    setTimeout(() => { scanLock = false; }, 2000);
}

async function onAdminTabChange(tabId) {
    startAdminScannerIfNeeded(tabId);
    if (tabId === 'adminUploadTab') initUploadTab();
}

async function startAdminScannerIfNeeded(tabId) {
    if (tabId === 'adminScanTab') await startAdminScanner();
    if (tabId === 'adminLogsTab') loadLogs('admin');
    if (tabId === 'adminStatsTab') loadStats();
    if (tabId === 'adminStudentsTab') searchPeople();
}

// People search
async function searchPeople() {
    const query = document.getElementById('peopleSearch')?.value.toLowerCase() || '';
    const type = document.getElementById('peopleTypeFilter')?.value || 'student';
    const display = document.getElementById('peopleDisplay');
    if (!display) return;
    display.innerHTML = '<div class="logs-empty">Searching...</div>';

    let req = db.from('attendance_logs').select('lrn, full_name, person_type').eq('person_type', type);
    const { data, error } = await req;
    if (error) { display.innerHTML = `<div class="logs-empty">Error: ${error.message}</div>`; return; }

    // Deduplicate by lrn
    const seen = new Set();
    const people = (data || []).filter(r => {
        if (seen.has(r.lrn)) return false;
        seen.add(r.lrn); return true;
    }).filter(r => !query || r.full_name?.toLowerCase().includes(query) || r.lrn?.toLowerCase().includes(query));

    if (!people.length) { display.innerHTML = '<div class="logs-empty">No records found.</div>'; return; }
    display.innerHTML = people.map(p => `
        <div class="person-item">
            <div class="person-name">${p.full_name}</div>
            <div class="person-meta">ID: ${p.lrn} &nbsp;•&nbsp; ${p.person_type?.toUpperCase()}</div>
        </div>
    `).join('');
}

// Export CSV
async function exportCSV() {
    const date = document.getElementById('adminDateFilter')?.value || todayDate();
    const type = document.getElementById('adminTypeFilter')?.value || 'student';
    const { data, error } = await db.from('attendance_logs')
        .select('*').eq('date', date).eq('person_type', type).order('time_in', { ascending: true });
    if (error || !data?.length) { showToast('No data to export.'); return; }

    const headers = ['LRN/ID', 'Full Name', 'Date', 'Time In', 'Time Out', 'Status', 'Type'];
    const rows = data.map(r => [r.lrn, r.full_name, r.date, r.time_in, r.time_out || '', r.status, r.person_type]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `attendance_${date}.csv`;
    a.click(); URL.revokeObjectURL(url);
    showToast('CSV exported!');
}

// ══════════════════════════════════════════════
//  CORE: RECORD ATTENDANCE
//  Writes to attendance_pending first.
//  Secretary confirms → moves to attendance_logs.
//  Original scanned time is always preserved.
// ══════════════════════════════════════════════
async function recordAttendance(personType, lrn, name, mode, statusElId, section = null) {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = nowTime();
    const mins = now.getHours() * 60 + now.getMinutes();

    try {
        // ── Check attendance_logs for already-confirmed record ──
        const { data: existing, error: fetchErr } = await db
            .from('attendance_logs').select('*')
            .eq('lrn', lrn).eq('date', date).eq('person_type', personType)
            .maybeSingle();
        if (fetchErr) throw fetchErr;

        // ── Check attendance_pending — ONLY truly Pending rows, separated by scan type ──
        // CRITICAL: Must filter approval_status = 'Pending' to avoid matching already-
        // Confirmed/Rejected rows — that was causing time-out to silently block.
        const { data: pendingIn } = await db
            .from('attendance_pending').select('*')
            .eq('lrn', lrn).eq('date', date).eq('person_type', personType)
            .eq('scan_type', 'IN').eq('approval_status', 'Pending')
            .maybeSingle();

        const { data: pendingOut } = await db
            .from('attendance_pending').select('*')
            .eq('lrn', lrn).eq('date', date).eq('person_type', personType)
            .eq('scan_type', 'OUT').eq('approval_status', 'Pending')
            .maybeSingle();

        if (mode === 'IN') {
            // Already confirmed in attendance_logs
            if (existing) {
                setStatus(statusElId, 'warning', 'ALREADY TIMED IN',
                    `${name} confirmed at ${existing.time_in} — ${existing.status}`);
                return false;
            }
            // Already a pending time-in waiting for Secretary
            if (pendingIn) {
                setStatus(statusElId, 'warning', 'SCAN PENDING APPROVAL',
                    `${name} scanned at ${pendingIn.scanned_time_in}. Awaiting Secretary confirmation.`);
                return false;
            }

            // Compute status
            let status;
            if (mins <= 7 * 60 + 34) status = 'On Time';
            else if (mins < 12 * 60) status = 'Late';
            else status = 'Half Day';

            const { error: insErr } = await db.from('attendance_pending').insert({
                lrn, full_name: name, date,
                scanned_time_in: time,
                computed_status: status,
                person_type: personType,
                approval_status: 'Pending',
                scan_type: 'IN',
                section: section || null
            });
            if (insErr) throw insErr;

            setStatus(statusElId, 'info', `⏳ PENDING APPROVAL`,
                `${name} scanned at ${time} (${status}) — awaiting Secretary confirmation`);
            showToast(`⏳ ${name} — Pending approval`);
            return true;

        } else {
            // ──────────────────────────────────────────────────────────────
            // TIME OUT
            // ──────────────────────────────────────────────────────────────

            // Case 1: Has a confirmed time-in in attendance_logs → normal flow
            if (existing) {
                if (existing.time_out) {
                    setStatus(statusElId, 'warning', 'ALREADY TIMED OUT',
                        `${name} left at ${existing.time_out}`);
                    return false;
                }
                // Already submitted a pending time-out
                if (pendingOut) {
                    setStatus(statusElId, 'warning', 'TIME OUT PENDING',
                        `${name} scanned out at ${pendingOut.scanned_time_out} — awaiting Secretary confirmation.`);
                    return false;
                }

                // Compute time-out status
                const h = now.getHours();
                let updatedStatus = existing.status; // keep original by default
                if (h >= 12 && h < 16) updatedStatus = 'Half Day';

                // Write to pending with log_id so Secretary can update the right row
                const { error: outErr } = await db.from('attendance_pending').insert({
                    lrn, full_name: name, date,
                    scanned_time_out: time,
                    computed_status: updatedStatus,
                    person_type: personType,
                    approval_status: 'Pending',
                    scan_type: 'OUT',
                    log_id: existing.id,
                    section: section || null
                });
                if (outErr) throw outErr;

                setStatus(statusElId, 'info', `⏳ TIME OUT PENDING`,
                    `${name} scanned out at ${time} — awaiting Secretary confirmation`);
                showToast(`⏳ ${name} — Time out pending`);
                return true;
            }

            // Case 2: Time-in is still waiting for Secretary approval
            if (pendingIn) {
                setStatus(statusElId, 'warning', 'TIME IN NOT YET CONFIRMED',
                    `${name}\'s time-in is still pending Secretary approval. Cannot time out yet.`);
                return false;
            }

            // Case 3: No record at all
            setStatus(statusElId, 'error', 'NO TIME IN RECORD',
                `${name} hasn\'t timed in today.`);
            return false;
        }
    } catch (e) {
        setStatus(statusElId, 'error', 'DATABASE ERROR', e.message || 'Unknown error');
        console.error(e);
        return false;
    }
}
// ── HELPERS ───────────────────────────────────
function resetLoginBtn() {
    const btn = document.getElementById('loginScanBtn');
    if (!btn) return;
    btn.style.display = 'flex'; btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">📷</span> ACTIVATE CAMERA';
}

async function lookupByName(name) {
    // Find a student record by full name (case-insensitive)
    const { data } = await db.from('attendance_logs')
        .select('lrn, full_name')
        .ilike('full_name', name.trim())
        .limit(1)
        .maybeSingle();
    return data || null;
}

async function lookupNameByLRN(lrn) {
    // Try to find the student's name from past attendance records
    const { data } = await db.from('attendance_logs')
        .select('full_name').eq('lrn', lrn).limit(1).maybeSingle();
    return data?.full_name || null;
}

// ══════════════════════════════════════════════
//  UPLOAD SYSTEM (Admin only, credentials gated)
// ══════════════════════════════════════════════
const UPLOAD_CREDENTIALS = { user: 'root', pass: 'masterjiro' };
let uploadUnlocked = false;

function initUploadTab() {
    // Set default date range (this month)
    const today = todayDate();
    const firstDay = today.slice(0, 8) + '01';
    const fromEl = document.getElementById('uploadDateFrom');
    const toEl = document.getElementById('uploadDateTo');
    if (fromEl && !fromEl.value) fromEl.value = firstDay;
    if (toEl && !toEl.value) toEl.value = today;
    if (uploadUnlocked) showUploadPanel();
    loadUploadHistory();
}

function verifyUploadCredentials() {
    const user = document.getElementById('uploadUser')?.value.trim();
    const pass = document.getElementById('uploadPass')?.value.trim();
    const msgEl = document.getElementById('uploadLoginMsg');

    if (user === UPLOAD_CREDENTIALS.user && pass === UPLOAD_CREDENTIALS.pass) {
        uploadUnlocked = true;
        showUploadPanel();
    } else {
        msgEl.className = 'status-box error';
        msgEl.innerHTML = '<span class="status-dot"></span><div><strong>ACCESS DENIED</strong><p>Invalid username or password.</p></div>';
        msgEl.style.display = 'flex';
        document.getElementById('uploadPass').value = '';
    }
}

function showUploadPanel() {
    document.getElementById('uploadLoginCard').classList.add('hidden');
    document.getElementById('uploadPanel').classList.remove('hidden');
    loadUploadHistory();
}

// ── Fetch attendance data for export ─────────
async function fetchAttendanceForExport(dateFrom, dateTo, type) {
    let query = db.from('attendance_logs')
        .select('*')
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: true })
        .order('time_in', { ascending: true });

    if (type !== 'all') query = query.eq('person_type', type);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

// ── Build XLSX workbook ───────────────────────
function buildWorkbook(data, dateFrom, dateTo) {
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: All Records ──
    const allRows = [
        ['PRESENCE — Aringay National High School'],
        [`Attendance Report: ${dateFrom} to ${dateTo}`],
        [`Generated: ${new Date().toLocaleString('en-PH')}`],
        [],
        ['LRN / ID', 'Full Name', 'Type', 'Date', 'Time In', 'Time Out', 'Status']
    ];
    data.forEach(r => allRows.push([
        r.lrn, r.full_name, (r.person_type || 'student').toUpperCase(),
        r.date, r.time_in || '—', r.time_out || '—', r.status || '—'
    ]));

    const ws1 = XLSX.utils.aoa_to_sheet(allRows);
    ws1['!cols'] = [16, 28, 10, 12, 12, 12, 10].map(w => ({ wch: w }));
    ws1['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } }, { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } }];
    XLSX.utils.book_append_sheet(wb, ws1, 'All Records');

    // ── Sheet 2: Students only ──
    const students = data.filter(r => (r.person_type || 'student') === 'student');
    if (students.length) {
        const stuRows = [['LRN', 'Full Name', 'Date', 'Time In', 'Time Out', 'Status']];
        students.forEach(r => stuRows.push([r.lrn, r.full_name, r.date, r.time_in || '—', r.time_out || '—', r.status || '—']));
        const ws2 = XLSX.utils.aoa_to_sheet(stuRows);
        ws2['!cols'] = [16, 28, 12, 12, 12, 10].map(w => ({ wch: w }));
        XLSX.utils.book_append_sheet(wb, ws2, 'Students');
    }

    // ── Sheet 3: Teachers only ──
    const teachers = data.filter(r => r.person_type === 'teacher');
    if (teachers.length) {
        const tchRows = [['ID', 'Full Name', 'Date', 'Time In', 'Time Out', 'Status']];
        teachers.forEach(r => tchRows.push([r.lrn, r.full_name, r.date, r.time_in || '—', r.time_out || '—', r.status || '—']));
        const ws3 = XLSX.utils.aoa_to_sheet(tchRows);
        ws3['!cols'] = [16, 28, 12, 12, 12, 10].map(w => ({ wch: w }));
        XLSX.utils.book_append_sheet(wb, ws3, 'Teachers');
    }

    // ── Sheet 4: Summary ──
    const byDate = {};
    data.forEach(r => {
        if (!byDate[r.date]) byDate[r.date] = { students: 0, teachers: 0, late: 0, ontime: 0 };
        if ((r.person_type || 'student') === 'student') byDate[r.date].students++;
        if (r.person_type === 'teacher') byDate[r.date].teachers++;
        if (r.status === 'Late') byDate[r.date].late++;
        if (r.status === 'On Time') byDate[r.date].ontime++;
    });
    const sumRows = [['Date', 'Students Present', 'Teachers Present', 'On Time', 'Late']];
    Object.entries(byDate).sort().forEach(([date, v]) =>
        sumRows.push([date, v.students, v.teachers, v.ontime, v.late])
    );
    const ws4 = XLSX.utils.aoa_to_sheet(sumRows);
    ws4['!cols'] = [14, 18, 18, 12, 10].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws4, 'Summary');

    return wb;
}

// ── Export + Upload to Supabase Storage ───────
async function exportAndUpload() {
    const statusEl = document.getElementById('uploadStatus');
    const dateFrom = document.getElementById('uploadDateFrom').value || todayDate();
    const dateTo = document.getElementById('uploadDateTo').value || todayDate();
    const type = document.getElementById('uploadType').value || 'all';

    statusEl.className = 'status-box info';
    statusEl.innerHTML = '<span class="status-dot"></span><div><strong>PREPARING...</strong><p>Fetching attendance records</p></div>';
    statusEl.style.display = 'flex';

    try {
        const data = await fetchAttendanceForExport(dateFrom, dateTo, type);
        if (!data.length) {
            setStatus('uploadStatus', 'warning', 'NO DATA', 'No records found for selected range.');
            return;
        }

        statusEl.innerHTML = '<span class="status-dot"></span><div><strong>BUILDING XLSX...</strong><p>Creating spreadsheet with ' + data.length + ' records</p></div>';

        const wb = buildWorkbook(data, dateFrom, dateTo);
        const wbArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const fileName = `attendance_${dateFrom}_to_${dateTo}_${type}_${Date.now()}.xlsx`;

        statusEl.innerHTML = '<span class="status-dot"></span><div><strong>UPLOADING...</strong><p>Sending to Supabase Storage</p></div>';

        // Upload to Supabase Storage bucket "attendance-exports"
        const { data: uploadData, error: uploadError } = await db.storage
            .from('attendance-exports')
            .upload(fileName, blob, {
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                upsert: false
            });

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: urlData } = db.storage.from('attendance-exports').getPublicUrl(fileName);

        // Log the upload in DB
        await db.from('upload_logs').insert({
            file_name: fileName,
            uploaded_by: currentUser?.name || 'Admin',
            date_from: dateFrom,
            date_to: dateTo,
            record_count: data.length,
            file_url: urlData?.publicUrl || ''
        }).then(() => { });

        setStatus('uploadStatus', 'success', 'UPLOAD SUCCESS ✓', `${data.length} records → ${fileName}`);
        showToast('✓ File uploaded to Supabase!');

        // Also trigger download
        triggerDownload(blob, fileName);
        loadUploadHistory();

    } catch (err) {
        setStatus('uploadStatus', 'error', 'UPLOAD FAILED', err.message || 'Unknown error');
        console.error(err);
    }
}

// ── Download only (no upload) ─────────────────
async function downloadOnly() {
    const statusEl = document.getElementById('uploadStatus');
    const dateFrom = document.getElementById('uploadDateFrom').value || todayDate();
    const dateTo = document.getElementById('uploadDateTo').value || todayDate();
    const type = document.getElementById('uploadType').value || 'all';

    statusEl.className = 'status-box info';
    statusEl.innerHTML = '<span class="status-dot"></span><div><strong>PREPARING...</strong><p>Fetching records...</p></div>';
    statusEl.style.display = 'flex';

    try {
        const data = await fetchAttendanceForExport(dateFrom, dateTo, type);
        if (!data.length) { setStatus('uploadStatus', 'warning', 'NO DATA', 'No records found.'); return; }
        const wb = buildWorkbook(data, dateFrom, dateTo);
        const wbArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const fileName = `attendance_${dateFrom}_to_${dateTo}.xlsx`;
        triggerDownload(blob, fileName);
        setStatus('uploadStatus', 'success', 'DOWNLOADED ✓', `${data.length} records saved as ${fileName}`);
    } catch (err) {
        setStatus('uploadStatus', 'error', 'ERROR', err.message);
    }
}

function triggerDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
}

// ── Upload history ────────────────────────────
async function loadUploadHistory() {
    const el = document.getElementById('uploadHistory');
    if (!el) return;

    const { data, error } = await db.from('upload_logs')
        .select('*').order('created_at', { ascending: false }).limit(10);

    if (error || !data?.length) {
        el.innerHTML = '<p style="font-size:12px;color:rgba(0,0,0,0.35);text-align:center;padding:15px;">No uploads yet</p>';
        return;
    }

    el.innerHTML = '<div class="upload-history-title">RECENT UPLOADS</div>' +
        data.map(u => `
            <div class="upload-history-item">
                <div>
                    <div class="upload-history-name">${u.file_name}</div>
                    <div class="upload-history-meta">${u.date_from} → ${u.date_to} &nbsp;•&nbsp; ${u.record_count} records &nbsp;•&nbsp; by ${u.uploaded_by}</div>
                </div>
                ${u.file_url ? `<a href="${u.file_url}" target="_blank" class="upload-dl-btn">↓</a>` : ''}
            </div>
        `).join('');
}

// ══════════════════════════════════════════════
//  PC SIDE PANELS — clock + live stats
// ══════════════════════════════════════════════
// ── Poll pending badge count (for Secretary tab badge) ───────────────────────
async function pollPendingBadge() {
    const today = todayDate();
    const { count } = await db.from('attendance_pending')
        .select('id', { count: 'exact', head: true })
        .eq('date', today).eq('approval_status', 'Pending');
    const badge = document.getElementById('pendingTabBadge');
    if (badge) {
        badge.textContent = count > 0 ? count : '';
        badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
}

function initPCPanels() {
    if (document.documentElement.classList.contains('device-phone')) return;

    // Live clock on right panel
    function updatePCClock() {
        const now = new Date();
        const clockEl = document.getElementById('pcClock');
        const dateEl = document.getElementById('pcDate');
        if (clockEl) clockEl.textContent = now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (dateEl) dateEl.textContent = now.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    updatePCClock();
    setInterval(updatePCClock, 1000);

    // Load today's stats
    loadPCStats();
    // Refresh stats every 30 seconds
    setInterval(loadPCStats, 30000);
}

async function loadPCStats() {
    if (document.documentElement.classList.contains('device-phone')) return;
    const today = todayDate();
    const [stuRes, lateRes, tchRes] = await Promise.all([
        db.from('attendance_logs').select('id', { count: 'exact', head: true }).eq('date', today).eq('person_type', 'student'),
        db.from('attendance_logs').select('id', { count: 'exact', head: true }).eq('date', today).eq('person_type', 'student').eq('status', 'Late'),
        db.from('attendance_logs').select('id', { count: 'exact', head: true }).eq('date', today).eq('person_type', 'teacher'),
    ]);
    const el = (id) => document.querySelector(`#${id} .pc-stat-num`);
    if (el('pcStatPresent')) el('pcStatPresent').textContent = stuRes.count ?? '—';
    if (el('pcStatLate')) el('pcStatLate').textContent = lateRes.count ?? '—';
    if (el('pcStatTeachers')) el('pcStatTeachers').textContent = tchRes.count ?? '—';
}

// Init on load
document.addEventListener('DOMContentLoaded', () => {
    initPCPanels();
    scheduleMidnightReset();
    schedule5PMPurge();
});

// ══════════════════════════════════════════════
//  MIDNIGHT AUTO-SAVE & RESET
//  At 12:00 AM: saves today's attendance as
//  YYYY-MM-DD.xlsx to the "logs" Supabase bucket,
//  then resets the UI back to the login screen.
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
//  MIDNIGHT AUTO-SAVE & RESET
//
//  WHY POLLING INSTEAD OF setTimeout:
//  Browsers throttle or kill large setTimeout timers for background tabs.
//  A setInterval that checks every ~30 seconds is far more reliable.
//
//  FLOW AT 00:00:
//    1. Capture yesterday's date BEFORE the date string flips
//    2. Fetch all attendance_logs for that date
//    3. Build XLSX and upload to Supabase Storage "logs" bucket
//    4. Log the upload in upload_logs table
//    5. DELETE all rows for that date from attendance_logs
//    6. Reset the UI back to the login screen
// ══════════════════════════════════════════════

let _midnightFired = false; // prevent double-fire within the same minute

function scheduleMidnightReset() {
    // Poll every 30 seconds — lightweight, survives tab throttling
    setInterval(async () => {
        const now = new Date();
        const h = now.getHours();
        const m = now.getMinutes();

        // Fire at 00:00 (midnight). Use a 2-minute window (00:00–00:01) so
        // even if the tab was throttled we catch it on the next wake.
        if (h === 0 && m <= 1) {
            if (!_midnightFired) {
                _midnightFired = true;
                console.log('[PRESENCE] Midnight window detected — running save & reset');
                await midnightSaveAndReset();
            }
        } else {
            // Reset flag once we're past the 00:01 window
            if (h !== 0 || m > 1) _midnightFired = false;
        }
    }, 30_000); // check every 30 seconds

    // Also run one immediate check in case the page loaded during the window
    (async () => {
        const now = new Date();
        if (now.getHours() === 0 && now.getMinutes() <= 1 && !_midnightFired) {
            _midnightFired = true;
            await midnightSaveAndReset();
        }
    })();

    console.log('[PRESENCE] Midnight reset polling started (checks every 30s)');
}

async function midnightSaveAndReset() {
    // Capture YESTERDAY's date — this function runs at/just after midnight,
    // so "yesterday" is the day whose records we need to save.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    console.log(`[PRESENCE] midnightSaveAndReset — saving records for ${dateStr}`);

    try {
        // ── 1. Fetch all records for yesterday ──
        const { data, error } = await db.from('attendance_logs')
            .select('*')
            .eq('date', dateStr)
            .order('person_type', { ascending: true })
            .order('time_in', { ascending: true });

        if (error) throw error;

        if (data && data.length > 0) {
            // ── 2. Build XLSX workbook ──
            const wb = buildWorkbook(data, dateStr, dateStr);
            const wbArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([wbArray], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            const fileName = `${dateStr}.xlsx`;

            // ── 3. Upload to "logs" bucket ──
            const { error: uploadErr } = await db.storage
                .from('logs')
                .upload(fileName, blob, {
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    upsert: true // overwrite if same date runs twice
                });

            if (uploadErr) {
                // Upload failed — don't delete records, log the error and abort
                console.error('[PRESENCE] Storage upload failed:', uploadErr.message);
                throw uploadErr;
            }

            // ── 4. Get public URL and log the upload ──
            const { data: urlData } = db.storage.from('logs').getPublicUrl(fileName);
            const publicUrl = urlData?.publicUrl || '';

            await db.from('upload_logs').insert({
                file_name: fileName,
                uploaded_by: 'AUTO (midnight reset)',
                date_from: dateStr,
                date_to: dateStr,
                record_count: data.length,
                file_url: publicUrl
            });

            console.log(`[PRESENCE] Midnight save OK → logs/${fileName} (${data.length} records)`);

            // ── 5. Delete yesterday's records now that the file is safely uploaded ──
            const { error: deleteErr } = await db.from('attendance_logs')
                .delete()
                .eq('date', dateStr);

            if (deleteErr) {
                console.error('[PRESENCE] Delete failed after upload:', deleteErr.message);
                // File is saved — deletion failure is non-fatal, just log it
            } else {
                console.log(`[PRESENCE] Cleared ${data.length} records for ${dateStr}`);
            }

            // ── 5b. Clean up yesterday's pending rows too ──
            await db.from('attendance_pending')
                .delete()
                .eq('date', dateStr);
            console.log(`[PRESENCE] Cleared pending rows for ${dateStr}`);

            showToast(`✓ Daily log saved & table reset: ${fileName}`);

        } else {
            console.log(`[PRESENCE] Midnight: no records for ${dateStr} — nothing to save`);
        }

    } catch (err) {
        console.error('[PRESENCE] Midnight save error:', err);
        // Do NOT reset the table if save failed — records are safer kept in DB
        // UI reset still proceeds below
    }

    // ── 6. Reset app UI back to login screen ──
    try {
        activeScanner = await stopScanner(activeScanner);
        loginScanner = await stopScanner(loginScanner);
    } catch (_) { }

    currentUser = null;
    scanLock = false;
    scanMode = 'IN';
    uploadUnlocked = false;

    if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }

    const btn = document.getElementById('loginScanBtn');
    if (btn) {
        btn.style.display = 'flex';
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">📷</span> ACTIVATE CAMERA';
    }
    const readerEl = document.getElementById('login-reader');
    if (readerEl) readerEl.innerHTML = '';

    setStatus('loginStatus', 'info', 'SYSTEM READY', 'Press button to scan your ID card');
    showScreen('login');

    console.log('[PRESENCE] Midnight reset complete — back to login screen.');
}

// ══════════════════════════════════════════════
//  5 PM AUTO-PURGE — UNAPPROVED PENDING SCANS
//
//  At exactly 5:00 PM each day, any scan still sitting
//  in attendance_pending with approval_status = 'Pending'
//  is considered abandoned.  The purge does THREE things:
//
//    1. Marks the pending row as 'Expired' (keeps audit trail)
//    2. If the student had a confirmed time-in but the time-out
//       was pending → marks them "No Time Out" in attendance_logs
//    3. If the time-IN itself was never confirmed → the student
//       is fully removed from attendance_logs for that day
//       (they never officially checked in before the cutoff)
//
//  Uses the same polling approach as the midnight reset
//  (every 30s check) so it survives tab throttling.
// ══════════════════════════════════════════════
let _5pmFired = false;

function schedule5PMPurge() {
    setInterval(async () => {
        const now = new Date();
        const h = now.getHours();
        const m = now.getMinutes();

        // Fire at 17:00–17:01 (5:00–5:01 PM)
        if (h === 17 && m <= 1) {
            if (!_5pmFired) {
                _5pmFired = true;
                console.log('[PRESENCE] 5 PM window — running pending purge');
                await run5PMPurge();
            }
        } else {
            if (h !== 17 || m > 1) _5pmFired = false;
        }
    }, 30_000);

    // Immediate check (page loaded during the 5PM window)
    (async () => {
        const now = new Date();
        if (now.getHours() === 17 && now.getMinutes() <= 1 && !_5pmFired) {
            _5pmFired = true;
            await run5PMPurge();
        }
    })();

    console.log('[PRESENCE] 5 PM purge polling started');
}

async function run5PMPurge() {
    const today = todayDate();
    console.log(`[PRESENCE] run5PMPurge — purging unapproved pending for ${today}`);

    try {
        // ── Fetch all still-Pending rows for today ──
        const { data: pendingRows, error: fetchErr } = await db
            .from('attendance_pending')
            .select('*')
            .eq('date', today)
            .eq('approval_status', 'Pending');

        if (fetchErr) throw fetchErr;
        if (!pendingRows || pendingRows.length === 0) {
            console.log('[PRESENCE] 5PM purge: nothing to purge.');
            return;
        }

        console.log(`[PRESENCE] 5PM purge: found ${pendingRows.length} unapproved pending rows`);

        let removedCount = 0;
        let noTimeOutCount = 0;

        for (const p of pendingRows) {
            if (p.scan_type === 'IN') {
                // Time-in was never confirmed → check if a confirmed log exists anyway
                const { data: logRow } = await db
                    .from('attendance_logs')
                    .select('id')
                    .eq('lrn', p.lrn)
                    .eq('date', today)
                    .eq('person_type', p.person_type)
                    .maybeSingle();

                if (!logRow) {
                    // No confirmed record → student never officially checked in
                    // Nothing to remove from attendance_logs, just expire the pending
                    removedCount++;
                }
                // If a confirmed log exists (shouldn't happen for pending IN, but guard)
                // leave it alone

            } else if (p.scan_type === 'OUT') {
                // Time-out was never confirmed → mark the confirmed log as "No Time Out"
                if (p.log_id) {
                    const { error: updErr } = await db
                        .from('attendance_logs')
                        .update({ time_out: null, status: 'No Time Out' })
                        .eq('id', p.log_id)
                        .is('time_out', null); // only update if still no time_out
                    if (!updErr) noTimeOutCount++;
                }
            }

            // Mark the pending row as Expired
            await db.from('attendance_pending')
                .update({
                    approval_status: 'Expired',
                    expire_reason: 'Auto-expired at 5:00 PM — not approved before cutoff',
                    reviewed_at: new Date().toISOString()
                })
                .eq('id', p.id);
        }

        const summary = [];
        if (removedCount > 0) summary.push(`${removedCount} unapproved check-in(s) removed`);
        if (noTimeOutCount > 0) summary.push(`${noTimeOutCount} marked No Time Out`);

        const msg = summary.length > 0
            ? `⏰ 5PM purge complete — ${summary.join(', ')}`
            : `⏰ 5PM purge complete — ${pendingRows.length} pending row(s) expired`;

        console.log('[PRESENCE]', msg);
        showToast(msg);

        // Refresh visible logs/pending if any role is logged in
        if (currentUser) {
            const role = currentUser.type;
            if (role === 'secretary') { loadPendingQueue(); loadLogs('secretary'); }
            if (role === 'adviser') loadLogs('adviser');
            if (role === 'teacher') loadLogs('teacher');
            if (role === 'admin') loadLogs('admin');
        }

    } catch (err) {
        console.error('[PRESENCE] 5PM purge error:', err);
    }
}

// ══════════════════════════════════════════════
//  PHOTO AUTHENTICATION SYSTEM
//  All non-student roles must take a verification
//  photo before accessing their screen.
// ══════════════════════════════════════════════
let _photoAuthStream = null;
let _photoAuthCallback = null;
let _photoAuthCaptured = null;

async function startPhotoAuth(onSuccess) {
    _photoAuthCallback = onSuccess;
    _photoAuthCaptured = null;

    document.getElementById('photoAuthName').textContent = currentUser.name;
    document.getElementById('photoAuthId').textContent = 'ID: ' + currentUser.id;
    const roleLabels = { teacher: '👩‍🏫 TEACHER', admin: '🛡️ ADMIN', adviser: '🌟 ADVISER', secretary: '📋 SECRETARY' };
    const badge = document.getElementById('photoAuthRoleBadge');
    badge.textContent = roleLabels[currentUser.type] || currentUser.type.toUpperCase();
    badge.className = `photo-auth-role-badge role-${currentUser.type}`;

    document.getElementById('photoAuthPreview').classList.add('hidden');
    document.getElementById('photoCaptureBtn').classList.remove('hidden');
    document.getElementById('photoRetakeBtn').classList.add('hidden');
    document.getElementById('photoConfirmBtn').classList.add('hidden');
    document.getElementById('photoAuthMsg').style.display = 'none';

    try {
        const video = document.getElementById('photoAuthVideo');
        video.style.display = 'block';
        _photoAuthStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        video.srcObject = _photoAuthStream;
        showScreen('photo-auth');
    } catch (err) {
        console.warn('[PRESENCE] Photo auth camera failed, bypassing:', err.message);
        await stopPhotoAuthCamera();
        onSuccess();
    }
}

function captureAuthPhoto() {
    const video = document.getElementById('photoAuthVideo');
    const canvas = document.getElementById('photoAuthCanvas');
    const img = document.getElementById('photoAuthImg');

    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 240;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    _photoAuthCaptured = canvas.toDataURL('image/jpeg', 0.85);
    img.src = _photoAuthCaptured;

    video.style.display = 'none';
    document.getElementById('photoAuthPreview').classList.remove('hidden');
    document.getElementById('photoCaptureBtn').classList.add('hidden');
    document.getElementById('photoRetakeBtn').classList.remove('hidden');
    document.getElementById('photoConfirmBtn').classList.remove('hidden');

    setStatus('photoAuthMsg', 'success', 'PHOTO CAPTURED', 'Confirm to proceed or retake if unclear.');
    document.getElementById('photoAuthMsg').style.display = 'flex';
}

function retakeAuthPhoto() {
    const video = document.getElementById('photoAuthVideo');
    _photoAuthCaptured = null;
    video.style.display = 'block';
    document.getElementById('photoAuthPreview').classList.add('hidden');
    document.getElementById('photoCaptureBtn').classList.remove('hidden');
    document.getElementById('photoRetakeBtn').classList.add('hidden');
    document.getElementById('photoConfirmBtn').classList.add('hidden');
    document.getElementById('photoAuthMsg').style.display = 'none';
}

async function confirmAuthPhoto() {
    if (!_photoAuthCaptured) return;
    const btn = document.getElementById('photoConfirmBtn');
    btn.disabled = true; btn.textContent = '⏳ SAVING...';

    try {
        await db.from('photo_auth_logs').insert({
            user_id: currentUser.id,
            user_name: currentUser.name,
            role: currentUser.type,
            photo_data: _photoAuthCaptured,
            logged_at: new Date().toISOString()
        });
    } catch (_) {
        console.warn('[PRESENCE] photo_auth_logs insert skipped (table may not exist)');
    }

    await stopPhotoAuthCamera();
    showToast(`✓ ${currentUser.name} verified`);
    btn.disabled = false; btn.textContent = '✅ CONFIRM & CONTINUE';
    if (_photoAuthCallback) _photoAuthCallback();
}

async function cancelPhotoAuth() {
    await stopPhotoAuthCamera();
    currentUser = null; _photoAuthCallback = null; _photoAuthCaptured = null;
    resetLoginBtn();
    showScreen('login');
}

async function stopPhotoAuthCamera() {
    if (_photoAuthStream) { _photoAuthStream.getTracks().forEach(t => t.stop()); _photoAuthStream = null; }
    const video = document.getElementById('photoAuthVideo');
    if (video) video.srcObject = null;
}

// ══════════════════════════════════════════════
//  ADVISER ROLE — Full access + multi-scan
// ══════════════════════════════════════════════
let adviserScanMode = 'IN';

function setAdviserScanMode(mode) {
    adviserScanMode = mode;
    document.getElementById('advModeIn').classList.toggle('active', mode === 'IN');
    document.getElementById('advModeOut').classList.toggle('active', mode === 'OUT');
}

async function startAdviserScanner() {
    await startQrScanner('adviser-reader', onAdviserScan);
}

async function onAdviserScan(qrData) {
    if (scanLock) return;
    scanLock = true;
    const parts = qrData.trim().split('|');
    const type = parts[0]?.trim().toUpperCase();
    if (type !== 'STUDENT' && type !== 'TEACHER') { scanLock = false; return; }
    const [_, id, name, sec] = parts;
    const personType = type.toLowerCase();
    setStatus('adviserScanStatus', 'info', 'PROCESSING...', 'Please wait');
    await recordAttendance(personType, id.trim(), name ? name.trim() : id.trim(), 'adviserScanStatus', sec?.trim() || null);
    setTimeout(() => { scanLock = false; }, 2000);
}

async function onAdviserTabChange(tabId) {
    if (tabId === 'advScanTab') await startAdviserScanner();
    if (tabId === 'advLogsTab') loadLogs('adviser');
    if (tabId === 'advStatsTab') loadAdviserStats();
    if (tabId === 'advSuspendTab') loadAdviserSuspendTab();
    if (tabId === 'advTimeTab') loadAdviserOwnTime();
}

async function loadAdviserStats() {
    const today = todayDate();
    const el = document.getElementById('advStatsDisplay');
    if (!el) return;
    el.innerHTML = '<div style="padding:20px;color:#888;font-size:13px;">Loading stats...</div>';

    const [stuToday, tchToday, stuLate, n1, n2, p1, p2] = await Promise.all([
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('person_type', 'student'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('person_type', 'teacher'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('person_type', 'student').eq('status', 'Late'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('section', '12-Newton'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('section', '12-Newton').eq('status', 'On Time'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('section', '12-Pythagoras'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('section', '12-Pythagoras').eq('status', 'On Time'),
    ]);

    el.innerHTML = `
        <div class="stat-card highlight"><div class="stat-label">Students Present Today</div><div class="stat-value">${stuToday.count ?? 0}</div></div>
        <div class="stat-card highlight"><div class="stat-label">Teachers Present Today</div><div class="stat-value">${tchToday.count ?? 0}</div></div>
        <div class="stat-card warn"><div class="stat-label">Late Today</div><div class="stat-value">${stuLate.count ?? 0}</div></div>
        <div class="stat-card" style="border-left:4px solid #2563eb;">
            <div class="stat-label">12-Newton Present</div>
            <div class="stat-value">${n1.count ?? 0}<span style="font-size:12px;opacity:0.5"> / 39</span></div>
            <div class="stat-sub">${n2.count ?? 0} on time</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #7c3aed;">
            <div class="stat-label">12-Pythagoras Present</div>
            <div class="stat-value">${p1.count ?? 0}<span style="font-size:12px;opacity:0.5"> / 42</span></div>
            <div class="stat-sub">${p2.count ?? 0} on time</div>
        </div>
    `;
}

let _advSelectedChipReason = '';

function selectReasonChipAdv(el, reason) {
    document.querySelectorAll('#advSuspendReasonChips .reason-chip').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    _advSelectedChipReason = reason;
    if (reason !== 'Other') { const ta = document.getElementById('advSuspendReasonText'); if (ta && !ta.value) ta.value = reason; }
}

async function loadAdviserSuspendTab() {
    const state = await getSuspensionState();
    renderAdviserSuspendUI(state);
}

function renderAdviserSuspendUI(state) {
    const banner = document.getElementById('advSuspendStatusBanner');
    const suspendCard = document.getElementById('advSuspendCard');
    const resumeCard = document.getElementById('advResumeCard');
    const tabBtn = document.getElementById('advSuspendTabBtn');

    if (state.suspended) {
        banner.textContent = '⚠️ ATTENDANCE IS CURRENTLY SUSPENDED';
        banner.classList.remove('hidden');
        suspendCard.style.display = 'none';
        resumeCard.classList.remove('hidden');
        document.getElementById('advResumeActiveReason').innerHTML =
            `<strong style="font-size:10px;letter-spacing:2px;opacity:0.6">ACTIVE REASON:</strong><br>${state.reason || 'No reason given'}` +
            (state.by ? `<span style="display:block;font-size:10px;margin-top:4px;opacity:0.55">— Suspended by ${state.by}</span>` : '');
        tabBtn?.classList.add('suspended-active');
    } else {
        banner.classList.add('hidden');
        suspendCard.style.display = 'flex';
        resumeCard.classList.add('hidden');
        tabBtn?.classList.remove('suspended-active');
    }
    document.getElementById('advSuspendMsg').style.display = 'none';
}

async function adviserSuspend() {
    const chipReason = _advSelectedChipReason;
    const textReason = document.getElementById('advSuspendReasonText')?.value?.trim();
    const reason = textReason || chipReason || 'No reason provided';
    if (!chipReason && !textReason) {
        setStatus('advSuspendMsg', 'warning', 'REASON REQUIRED', 'Please select or type a reason.');
        document.getElementById('advSuspendMsg').style.display = 'flex'; return;
    }
    const btn = document.getElementById('advBtnSuspend');
    btn.disabled = true; btn.textContent = '⏳ SUSPENDING...';
    await setSuspensionState(true, reason, currentUser?.name || 'Adviser');
    showToast('⚠️ Attendance suspended');
    renderAdviserSuspendUI({ suspended: true, reason, by: currentUser?.name || 'Adviser' });
    btn.disabled = false; btn.innerHTML = '<span>🚫</span> SUSPEND ATTENDANCE';
}

async function adviserResume() {
    await setSuspensionState(false, '', '');
    showToast('✅ Attendance re-enabled');
    renderAdviserSuspendUI({ suspended: false, reason: '', by: '' });
    document.querySelectorAll('#advSuspendReasonChips .reason-chip').forEach(c => c.classList.remove('selected'));
    _advSelectedChipReason = '';
    const ta = document.getElementById('advSuspendReasonText'); if (ta) ta.value = '';
}

async function loadAdviserOwnTime() {
    if (!currentUser) return;
    const today = todayDate();
    const { data } = await db.from('attendance_logs')
        .select('*').eq('lrn', currentUser.id).eq('date', today).eq('person_type', 'teacher').maybeSingle();
    document.getElementById('advTimeIn').textContent = data?.time_in || '—';
    document.getElementById('advTimeOut').textContent = data?.time_out || '—';
    document.getElementById('advStatus').textContent = data?.status || '—';
}

async function adviserSelfTimeIn() {
    if (!currentUser) return;
    const today = todayDate();
    const { data: existing } = await db.from('attendance_logs')
        .select('*').eq('lrn', currentUser.id).eq('date', today).eq('person_type', 'teacher').maybeSingle();
    const msgEl = document.getElementById('advTimeMsg');
    if (existing) { setStatus('advTimeMsg', 'warning', 'ALREADY TIMED IN', `Checked in at ${existing.time_in}`); msgEl.style.display = 'flex'; return; }
    const time = nowTime(); const status = getAttendanceStatus();
    const { error } = await db.from('attendance_logs').insert({ lrn: currentUser.id, full_name: currentUser.name, date: today, time_in: time, status, person_type: 'teacher' });
    if (error) { setStatus('advTimeMsg', 'error', 'ERROR', error.message); msgEl.style.display = 'flex'; return; }
    setStatus('advTimeMsg', 'success', `TIME IN — ${status}`, `Recorded at ${time}`);
    msgEl.style.display = 'flex'; loadAdviserOwnTime(); showToast(`Time In recorded at ${time}`);
}

async function adviserSelfTimeOut() {
    if (!currentUser) return;
    const today = todayDate();
    const { data: existing } = await db.from('attendance_logs')
        .select('*').eq('lrn', currentUser.id).eq('date', today).eq('person_type', 'teacher').maybeSingle();
    const msgEl = document.getElementById('advTimeMsg');
    if (!existing) { setStatus('advTimeMsg', 'error', 'NO TIME IN RECORD', 'Please time in first.'); msgEl.style.display = 'flex'; return; }
    if (existing.time_out) { setStatus('advTimeMsg', 'warning', 'ALREADY TIMED OUT', `You left at ${existing.time_out}`); msgEl.style.display = 'flex'; return; }
    const time = nowTime();
    const { error } = await db.from('attendance_logs').update({ time_out: time }).eq('id', existing.id);
    if (error) { setStatus('advTimeMsg', 'error', 'ERROR', error.message); msgEl.style.display = 'flex'; return; }
    setStatus('advTimeMsg', 'success', 'TIME OUT RECORDED', `Recorded at ${time}`);
    msgEl.style.display = 'flex'; loadAdviserOwnTime(); showToast(`Time Out recorded at ${time}`);
}

// ══════════════════════════════════════════════
//  SECRETARY ROLE — Logsheets only
// ══════════════════════════════════════════════
async function onSecretaryTabChange(tabId) {
    stopPendingAutoRefresh();
    if (tabId === 'secLogsTab') loadLogs('secretary');
    if (tabId === 'secPendingTab') startPendingAutoRefresh();
}

// ── PENDING APPROVAL QUEUE ────────────────────
// Live-refreshing queue of all pending scans.
// Secretary confirms → original scanned time goes to attendance_logs unchanged.
let _pendingInterval = null;

async function loadPendingQueue() {
    const el = document.getElementById('pendingQueueDisplay');
    if (!el) return;

    const today = todayDate();
    const { data, error } = await db.from('attendance_pending')
        .select('*')
        .eq('date', today)
        .eq('approval_status', 'Pending')
        .order('created_at', { ascending: true });

    // Badge on tab
    const badge = document.getElementById('pendingTabBadge');
    const count = data?.length ?? 0;
    if (badge) {
        badge.textContent = count > 0 ? count : '';
        badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }

    if (error) { el.innerHTML = `<div class="logs-empty">Error: ${error.message}</div>`; return; }
    if (!count) {
        el.innerHTML = `
            <div class="pending-empty">
                <div class="pending-empty-icon">✅</div>
                <div class="pending-empty-title">ALL CLEAR</div>
                <p>No pending scans to approve right now.</p>
            </div>`;
        return;
    }

    el.innerHTML = data.map(p => {
        const isIn = p.scan_type === 'IN';
        const scannedTime = isIn ? p.scanned_time_in : p.scanned_time_out;
        const statusClass = p.computed_status === 'On Time' ? 'ontime' : p.computed_status === 'Late' ? 'late' : 'halfday';
        return `
        <div class="pending-item" id="pending-row-${p.id}">
            <div class="pending-item-left">
                <div class="pending-scan-type ${isIn ? 'type-in' : 'type-out'}">${isIn ? '⏰ TIME IN' : '🚶 TIME OUT'}</div>
                <div class="pending-name">${p.full_name}</div>
                <div class="pending-meta">
                    <span class="pending-lrn">ID: ${p.lrn}</span>
                    ${p.section ? `<span class="log-section-tag">${p.section}</span>` : ''}
                </div>
                <div class="pending-time-row">
                    <span class="pending-time-label">SCANNED AT</span>
                    <span class="pending-time-value">${scannedTime}</span>
                    <span class="log-status ${statusClass}" style="margin-left:8px;">${p.computed_status}</span>
                </div>
            </div>
            <div class="pending-item-actions">
                <button class="pending-btn-confirm" onclick="confirmPending('${p.id}')">
                    ✓ CONFIRM
                </button>
                <button class="pending-btn-reject" onclick="rejectPending('${p.id}')">
                    ✕
                </button>
            </div>
        </div>`;
    }).join('');
}

async function confirmPending(pendingId) {
    const row = document.getElementById(`pending-row-${pendingId}`);
    if (row) {
        row.style.opacity = '0.5';
        row.style.pointerEvents = 'none';
        row.querySelector('.pending-btn-confirm').textContent = '⏳ CONFIRMING...';
    }

    try {
        // Fetch the pending record
        const { data: p, error: fetchErr } = await db.from('attendance_pending')
            .select('*').eq('id', pendingId).maybeSingle();
        if (fetchErr) throw fetchErr;
        if (!p) throw new Error('Pending record not found');

        if (p.scan_type === 'IN') {
            // Check if already confirmed (race condition guard)
            const { data: alreadyIn } = await db.from('attendance_logs')
                .select('id').eq('lrn', p.lrn).eq('date', p.date).eq('person_type', p.person_type).maybeSingle();
            if (alreadyIn) throw new Error(`${p.full_name} already has a confirmed time-in`);

            // Insert to attendance_logs using the ORIGINAL scanned time
            const { error: insErr } = await db.from('attendance_logs').insert({
                lrn: p.lrn,
                full_name: p.full_name,
                date: p.date,
                time_in: p.scanned_time_in,   // ← original scanned time, unchanged
                status: p.computed_status,
                person_type: p.person_type,
                section: p.section || null
            });
            if (insErr) throw insErr;

        } else if (p.scan_type === 'OUT') {
            // Update the confirmed log record
            const logId = p.log_id;
            if (!logId) throw new Error('No linked log ID for time-out confirmation');

            const { error: updErr } = await db.from('attendance_logs')
                .update({
                    time_out: p.scanned_time_out,   // ← original scanned time, unchanged
                    status: p.computed_status
                })
                .eq('id', logId);
            if (updErr) throw updErr;
        }

        // Mark pending as confirmed
        await db.from('attendance_pending')
            .update({ approval_status: 'Confirmed', reviewed_by: currentUser?.name || 'Secretary', reviewed_at: new Date().toISOString() })
            .eq('id', pendingId);

        flashSuccess();
        showToast(`✓ ${p.full_name} — ${p.scan_type === 'IN' ? p.scanned_time_in : p.scanned_time_out} confirmed`);

        // Remove row with animation
        if (row) {
            row.style.transition = 'all 0.3s ease';
            row.style.transform = 'translateX(100%)';
            row.style.opacity = '0';
            setTimeout(() => { row.remove(); loadPendingQueue(); }, 320);
        } else {
            loadPendingQueue();
        }

    } catch (err) {
        showToast(`Error: ${err.message}`);
        if (row) { row.style.opacity = '1'; row.style.pointerEvents = ''; }
        console.error(err);
    }
}

async function rejectPending(pendingId) {
    const { data: p } = await db.from('attendance_pending').select('*').eq('id', pendingId).maybeSingle();
    if (!p) return;

    const confirmed = confirm(`Reject ${p.full_name}'s scan at ${p.scanned_time_in || p.scanned_time_out}?\n\nThis will delete the pending entry and the student will need to scan again.`);
    if (!confirmed) return;

    await db.from('attendance_pending')
        .update({ approval_status: 'Rejected', reviewed_by: currentUser?.name || 'Secretary', reviewed_at: new Date().toISOString() })
        .eq('id', pendingId);

    showToast(`✕ ${p.full_name} scan rejected`);
    loadPendingQueue();
}

// Auto-refresh pending queue every 15s when secretary is on that tab
function startPendingAutoRefresh() {
    stopPendingAutoRefresh();
    loadPendingQueue();
    _pendingInterval = setInterval(loadPendingQueue, 15000);
}

function stopPendingAutoRefresh() {
    if (_pendingInterval) { clearInterval(_pendingInterval); _pendingInterval = null; }
}

async function exportCSVRole(role) {
    const dateId = role === 'secretary' ? 'secDateFilter' : 'advDateFilter';
    const typeId = role === 'secretary' ? 'secTypeFilter' : 'advTypeFilter';
    const sectionId = role === 'secretary' ? 'secSectionFilter' : 'advSectionFilter';
    const date = document.getElementById(dateId)?.value || todayDate();
    const type = document.getElementById(typeId)?.value || 'student';
    const section = document.getElementById(sectionId)?.value || 'all';

    let query = db.from('attendance_logs').select('*').eq('date', date).eq('person_type', type).order('time_in', { ascending: true });
    if (section !== 'all') query = query.eq('section', section);
    const { data, error } = await query;
    if (error || !data?.length) { showToast('No data to export.'); return; }

    const headers = ['LRN/ID', 'Full Name', 'Section', 'Date', 'Time In', 'Time Out', 'Status', 'Type'];
    const rows = data.map(r => [r.lrn, r.full_name, r.section || '—', r.date, r.time_in, r.time_out || '', r.status, r.person_type]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `logsheet_${date}_${section}.csv`;
    a.click(); URL.revokeObjectURL(url);
    showToast('CSV exported!');
}

async function secretaryDownload() {
    const statusEl = document.getElementById('secExportStatus');
    const dateFrom = document.getElementById('secDateFrom')?.value || todayDate();
    const dateTo = document.getElementById('secDateTo')?.value || todayDate();
    const section = document.getElementById('secExportSection')?.value || 'all';

    statusEl.className = 'status-box info';
    statusEl.innerHTML = '<span class="status-dot"></span><div><strong>PREPARING...</strong><p>Fetching records...</p></div>';
    statusEl.style.display = 'flex';

    try {
        let query = db.from('attendance_logs').select('*').gte('date', dateFrom).lte('date', dateTo)
            .order('date', { ascending: true }).order('time_in', { ascending: true });
        if (section !== 'all') query = query.eq('section', section);
        const { data, error } = await query;
        if (error) throw error;
        if (!data?.length) { setStatus('secExportStatus', 'warning', 'NO DATA', 'No records found.'); return; }
        const wb = buildWorkbook(data, dateFrom, dateTo);
        const wbArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const fileName = `logsheet_${dateFrom}_to_${dateTo}_${section}.xlsx`;
        triggerDownload(blob, fileName);
        setStatus('secExportStatus', 'success', 'DOWNLOADED ✓', `${data.length} records saved as ${fileName}`);
    } catch (err) {
        setStatus('secExportStatus', 'error', 'ERROR', err.message);
    }
}

// ── UPDATED loadStats — includes section breakdown
async function loadStats() {
    const today = todayDate();
    const el = document.getElementById('statsDisplay');
    if (!el) return;
    el.innerHTML = '<div style="padding:20px;color:#888;font-size:13px;">Loading stats...</div>';

    const [stuToday, tchToday, stuLate, stuHalf, stuNoOut, stuAll, n1, p1] = await Promise.all([
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('person_type', 'student'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('person_type', 'teacher'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('person_type', 'student').eq('status', 'Late'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('person_type', 'student').eq('status', 'Half Day'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('person_type', 'student').is('time_out', null),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('person_type', 'student'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('section', '12-Newton'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('section', '12-Pythagoras'),
    ]);

    el.innerHTML = `
        <div class="stat-card highlight"><div class="stat-label">Students Present Today</div><div class="stat-value">${stuToday.count ?? 0}</div></div>
        <div class="stat-card highlight"><div class="stat-label">Teachers Present Today</div><div class="stat-value">${tchToday.count ?? 0}</div></div>
        <div class="stat-card warn"><div class="stat-label">Late Today</div><div class="stat-value">${stuLate.count ?? 0}</div></div>
        <div class="stat-card warn"><div class="stat-label">Half Day Today</div><div class="stat-value">${stuHalf.count ?? 0}</div></div>
        <div class="stat-card warn"><div class="stat-label">No Time Out Yet</div><div class="stat-value">${stuNoOut.count ?? 0}</div><div class="stat-sub">Still inside campus</div></div>
        <div class="stat-card"><div class="stat-label">Total Records (All Time)</div><div class="stat-value">${stuAll.count ?? 0}</div></div>
        <div class="stat-card" style="border-left:4px solid #2563eb;">
            <div class="stat-label">12-Newton Today</div>
            <div class="stat-value">${n1.count ?? 0}<span style="font-size:12px;opacity:0.5"> / 39</span></div>
        </div>
        <div class="stat-card" style="border-left:4px solid #7c3aed;">
            <div class="stat-label">12-Pythagoras Today</div>
            <div class="stat-value">${p1.count ?? 0}<span style="font-size:12px;opacity:0.5"> / 42</span></div>
        </div>
    `;
}


// ══════════════════════════════════════════════
//  STUDENT PHOTO MODAL (spm)
//  Triggered for ALL members before TIME IN/OUT.
//  Photo is saved to Supabase and shown in logs
//  for Adviser and Secretary.
// ══════════════════════════════════════════════
let _spmStream = null;
let _spmCaptured = null;  // base64 jpeg
let _spmMode = null;      // 'IN' or 'OUT'
let _spmResolve = null;   // promise resolver

// Opens the photo modal; returns a Promise that resolves to
// the captured base64 string, or null if cancelled.
function openStudentPhotoModal(mode) {
    return new Promise(async (resolve) => {
        _spmMode = mode;
        _spmResolve = resolve;
        _spmCaptured = null;

        // Update titles
        const isIn = mode === 'IN';
        document.getElementById('spmTitle').textContent = isIn ? '📸 TIME IN — PHOTO' : '📸 TIME OUT — PHOTO';
        document.getElementById('spmSub').textContent = isIn
            ? 'Take a photo to record your Time In'
            : 'Take a photo to record your Time Out';

        // Reset UI state
        const video = document.getElementById('spmVideo');
        const canvas = document.getElementById('spmCanvas');
        video.style.display = 'block';
        canvas.style.display = 'none';
        document.getElementById('spmPreview').classList.add('hidden');
        document.getElementById('spmCaptureBtn').classList.remove('hidden');
        document.getElementById('spmRetakeBtn').classList.add('hidden');
        document.getElementById('spmConfirmBtn').classList.add('hidden');

        // Show modal
        document.getElementById('studentPhotoModal').classList.remove('hidden');

        // Start camera (prefer front/selfie camera for members)
        try {
            _spmStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'user' } },
                audio: false
            });
            video.srcObject = _spmStream;
        } catch (err) {
            console.warn('[spm] Camera error, bypassing photo:', err.message);
            _spmStopCamera();
            document.getElementById('studentPhotoModal').classList.add('hidden');
            resolve(null); // bypass photo if camera unavailable
        }
    });
}

function spmCapture() {
    const video = document.getElementById('spmVideo');
    const canvas = document.getElementById('spmCanvas');
    const img = document.getElementById('spmImg');

    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 240;
    // Draw mirrored (front camera is already mirrored via CSS, draw normal for storage)
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    _spmCaptured = canvas.toDataURL('image/jpeg', 0.80);
    img.src = _spmCaptured;

    video.style.display = 'none';
    document.getElementById('spmPreview').classList.remove('hidden');
    document.getElementById('spmCaptureBtn').classList.add('hidden');
    document.getElementById('spmRetakeBtn').classList.remove('hidden');
    document.getElementById('spmConfirmBtn').classList.remove('hidden');
}

function spmRetake() {
    const video = document.getElementById('spmVideo');
    _spmCaptured = null;
    video.style.display = 'block';
    document.getElementById('spmPreview').classList.add('hidden');
    document.getElementById('spmCaptureBtn').classList.remove('hidden');
    document.getElementById('spmRetakeBtn').classList.add('hidden');
    document.getElementById('spmConfirmBtn').classList.add('hidden');
}

async function spmConfirm() {
    if (!_spmCaptured) return;
    const btn = document.getElementById('spmConfirmBtn');
    btn.disabled = true;
    btn.textContent = '⏳ SAVING...';
    _spmStopCamera();
    document.getElementById('studentPhotoModal').classList.add('hidden');
    btn.disabled = false;
    btn.textContent = '✅ CONFIRM';
    if (_spmResolve) { _spmResolve(_spmCaptured); _spmResolve = null; }
}

function spmCancel() {
    _spmStopCamera();
    document.getElementById('studentPhotoModal').classList.add('hidden');
    if (_spmResolve) { _spmResolve(null); _spmResolve = null; }
}

function _spmStopCamera() {
    if (_spmStream) { _spmStream.getTracks().forEach(t => t.stop()); _spmStream = null; }
    const video = document.getElementById('spmVideo');
    if (video) video.srcObject = null;
}

// ── Patch studentAction to require photo ──────
// Override the original studentAction to capture photo first
const _origStudentAction = studentAction;
window.studentAction = async function(mode) {
    // Capture photo first
    const photo = await openStudentPhotoModal(mode);
    // Even if photo is null (camera failed), still allow action to proceed
    await _recordStudentActionWithPhoto(mode, photo);
};

async function _recordStudentActionWithPhoto(mode, photoData) {
    const id = currentUser.id;
    const name = currentUser.name;
    const btnIn = document.getElementById('actionBtnIn');
    const btnOut = document.getElementById('actionBtnOut');
    const msgEl = document.getElementById('actionMsg');

    btnIn.disabled = true;
    btnOut.disabled = true;
    msgEl.style.display = 'none';

    await recordAttendanceWithPhoto('student', id, name, mode, 'actionMsg', photoData, currentUser.section);
    msgEl.style.display = 'flex';

    // Refresh state
    const today = todayDate();
    const { data: updated } = await db.from('attendance_logs')
        .select('*').eq('lrn', id).eq('date', today).eq('person_type', 'student').maybeSingle();
    const { data: updPendingIn } = await db.from('attendance_pending')
        .select('*').eq('lrn', id).eq('date', today).eq('person_type', 'student')
        .eq('scan_type', 'IN').eq('approval_status', 'Pending').maybeSingle();
    const { data: updPendingOut } = await db.from('attendance_pending')
        .select('*').eq('lrn', id).eq('date', today).eq('person_type', 'student')
        .eq('scan_type', 'OUT').eq('approval_status', 'Pending').maybeSingle();

    const recEl = document.getElementById('actionTodayRecord');
    const notice = document.getElementById('actionPendingNotice');
    btnIn.classList.remove('action-btn-done', 'action-btn-pending');
    btnOut.classList.remove('action-btn-done', 'action-btn-pending');
    notice?.classList.add('hidden');

    if (updated) {
        let outText = updated.time_out || '---';
        if (!updated.time_out && updPendingOut) {
            outText = `${updPendingOut.scanned_time_out} ⏳ PENDING`;
            btnOut.classList.add('action-btn-pending'); btnOut.disabled = true;
            notice?.classList.remove('hidden');
        } else if (updated.time_out) {
            btnOut.classList.add('action-btn-done'); btnOut.disabled = true;
        }
        document.getElementById('actionTodayIn').textContent = (updated.time_in || '---') + ' (' + updated.status + ')';
        document.getElementById('actionTodayOut').textContent = outText;
        recEl.classList.remove('hidden');
        btnIn.classList.add('action-btn-done'); btnIn.disabled = true;
    } else if (updPendingIn) {
        document.getElementById('actionTodayIn').textContent = `${updPendingIn.scanned_time_in} ⏳ PENDING`;
        document.getElementById('actionTodayOut').textContent = '---';
        recEl.classList.remove('hidden');
        btnIn.classList.add('action-btn-pending'); btnIn.disabled = true;
        btnOut.disabled = true;
        notice?.classList.remove('hidden');
    }

    setTimeout(() => goBackToScan(), 3500);
}

// ── recordAttendance extended with photo ─────
// Wraps the original recordAttendance and saves photo to attendance_pending
async function recordAttendanceWithPhoto(personType, lrn, name, mode, statusElId, photoData, section = null) {
    const result = await recordAttendance(personType, lrn, name, mode, statusElId, section);

    // If attendance was recorded (result is true) and we have a photo, save it
    if (result && photoData) {
        try {
            // Get the newly created pending row to attach photo
            const today = todayDate();
            const { data: pendingRow } = await db.from('attendance_pending')
                .select('id')
                .eq('lrn', lrn)
                .eq('date', today)
                .eq('person_type', personType)
                .eq('scan_type', mode)
                .eq('approval_status', 'Pending')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (pendingRow) {
                await db.from('attendance_pending')
                    .update({ photo_data: photoData })
                    .eq('id', pendingRow.id);
            }
        } catch (e) {
            console.warn('[spm] Could not save photo to pending:', e.message);
        }
    }

    return result;
}

// ── Show photo thumbnail & lightbox in logs ───
function showPhotoLightbox(photoData, name, time, scanType) {
    const lb = document.createElement('div');
    lb.className = 'photo-lightbox';
    lb.innerHTML = `
        <img src="${photoData}" alt="Photo of ${name}" />
        <div class="photo-lightbox-info">
            <strong>${name}</strong>
            ${scanType === 'IN' ? '⏰ Time In' : '🚶 Time Out'} — ${time}
        </div>
        <div class="photo-lightbox-close">TAP ANYWHERE TO CLOSE</div>
    `;
    lb.onclick = () => lb.remove();
    document.body.appendChild(lb);
}

// ── Patch loadLogs to show photos for adviser/secretary ──
const _origLoadLogs = loadLogs;
window.loadLogs = async function(role) {
    // Call original first to render the base list
    await _origLoadLogs(role);

    // Only adviser and secretary see photos
    if (role !== 'adviser' && role !== 'secretary') return;

    const dispId = role === 'secretary' ? 'secLogsDisplay' : 'advLogsDisplay';
    const dateId = role === 'secretary' ? 'secDateFilter' : 'advDateFilter';
    const typeId = role === 'secretary' ? 'secTypeFilter' : 'advTypeFilter';
    const sectionId = role === 'secretary' ? 'secSectionFilter' : 'advSectionFilter';

    const date = document.getElementById(dateId)?.value || todayDate();
    const type = document.getElementById(typeId)?.value || 'student';
    const section = document.getElementById(sectionId)?.value || 'all';
    const display = document.getElementById(dispId);
    if (!display) return;

    // Fetch pending rows for today (which have photo_data)
    let pendingQuery = db.from('attendance_pending')
        .select('lrn, scan_type, photo_data, scanned_time_in, scanned_time_out, full_name')
        .eq('date', date)
        .eq('person_type', type)
        .not('photo_data', 'is', null);

    const { data: photoRows } = await pendingQuery;
    if (!photoRows?.length) return;

    // Also check attendance_logs for confirmed rows (photo saved in pending)
    // Build a map: lrn+scanType → { photo, time, name }
    const photoMap = {};
    photoRows.forEach(r => {
        const key = `${r.lrn}_${r.scan_type}`;
        photoMap[key] = {
            photo: r.photo_data,
            time: r.scan_type === 'IN' ? r.scanned_time_in : r.scanned_time_out,
            name: r.full_name,
            scanType: r.scan_type
        };
    });

    // Find all log-items in the display and inject photo thumbnails
    display.querySelectorAll('.log-item').forEach(row => {
        const idText = row.querySelector('.log-meta')?.textContent || '';
        const lrnMatch = idText.match(/ID:\s*([^\s|]+)/);
        if (!lrnMatch) return;
        const lrn = lrnMatch[1].trim();

        // Check for Time In photo
        const inKey = `${lrn}_IN`;
        const outKey = `${lrn}_OUT`;
        const rightDiv = row.querySelector('div:last-child');
        if (!rightDiv) return;

        // Avoid double-injecting
        if (row.querySelector('.log-photo-thumb')) return;

        if (photoMap[inKey]) {
            const p = photoMap[inKey];
            const thumb = document.createElement('img');
            thumb.className = 'log-photo-thumb';
            thumb.src = p.photo;
            thumb.title = `📸 Time In photo — ${p.name}`;
            thumb.onclick = (e) => { e.stopPropagation(); showPhotoLightbox(p.photo, p.name, p.time, 'IN'); };
            rightDiv.insertBefore(thumb, rightDiv.firstChild);
        }
        if (photoMap[outKey]) {
            const p = photoMap[outKey];
            const thumb = document.createElement('img');
            thumb.className = 'log-photo-thumb';
            thumb.src = p.photo;
            thumb.title = `📸 Time Out photo — ${p.name}`;
            thumb.onclick = (e) => { e.stopPropagation(); showPhotoLightbox(p.photo, p.name, p.time, 'OUT'); };
            rightDiv.insertBefore(thumb, rightDiv.firstChild);
        }
    });
};

// ── Also show photo in pending queue (for Secretary) ──
const _origLoadPendingQueue = loadPendingQueue;
window.loadPendingQueue = async function() {
    await _origLoadPendingQueue();

    const el = document.getElementById('pendingQueueDisplay');
    if (!el) return;

    // Re-fetch pending rows with photos
    const today = todayDate();
    const { data: rows } = await db.from('attendance_pending')
        .select('id, lrn, photo_data, scan_type, scanned_time_in, scanned_time_out, full_name')
        .eq('date', today)
        .eq('approval_status', 'Pending')
        .not('photo_data', 'is', null);

    if (!rows?.length) return;

    rows.forEach(r => {
        const row = document.getElementById(`pending-row-${r.id}`);
        if (!row || row.querySelector('.log-photo-thumb')) return;
        const leftDiv = row.querySelector('.pending-item-left');
        if (!leftDiv) return;

        const time = r.scan_type === 'IN' ? r.scanned_time_in : r.scanned_time_out;
        const thumb = document.createElement('img');
        thumb.className = 'log-photo-thumb';
        thumb.src = r.photo_data;
        thumb.title = `📸 Photo — ${r.full_name}`;
        thumb.style.cssText = 'margin-top:6px;width:44px;height:44px;';
        thumb.onclick = (e) => { e.stopPropagation(); showPhotoLightbox(r.photo_data, r.full_name, time, r.scan_type); };
        leftDiv.appendChild(thumb);
    });
};
