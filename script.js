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

    // Date filters — default to today
    const today = todayDate();
    ['teacherDateFilter', 'adminDateFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = today; el.addEventListener('change', () => loadLogs(id.includes('teacher') ? 'teacher' : 'admin')); }
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
    let type = 'student', id = '', name = '';

    if (raw.includes('|')) {
        // Format: TYPE|ID|Name
        const parts = raw.split('|');
        const rawType = parts[0].trim().toLowerCase();
        // Only treat first segment as type if it's a known role keyword
        if (['student', 'teacher', 'admin'].includes(rawType)) {
            type = rawType;
            id = (parts[1] || '').trim();
            name = (parts[2] || id).trim();
        } else {
            // Pipe-separated but no role prefix — treat whole thing or first part as LRN/name
            id = parts[0].trim();
            name = parts[1]?.trim() || id;
            type = 'student';
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
    currentUser = { type, id, name };

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
        document.getElementById('teacherBadge').innerHTML = `${currentUser.name}<br><span style="font-size:9px;opacity:0.7">TEACHER</span>`;
        showScreen('teacher');
        loadTeacherOwnTime();
        // Refresh suspend tab badge if currently suspended
        getSuspensionState().then(s => { if (s.suspended) document.getElementById('teacherSuspendTabBtn')?.classList.add('suspended-active'); });
    } else if (currentUser.type === 'admin') {
        document.getElementById('adminBadge').innerHTML = `${currentUser.name}<br><span style="font-size:9px;opacity:0.7">ADMIN</span>`;
        showScreen('admin');
        await startAdminScanner();
        loadStats();
    } else {
        setStatus('loginStatus', 'error', 'UNKNOWN ROLE', `"${type}" is not recognized.`);
    }
}

// ── LOGOUT ────────────────────────────────────
async function logout() {
    activeScanner = await stopScanner(activeScanner);
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
    const [_, id, name] = parts;
    setStatus('studentStatus', 'info', 'PROCESSING...', 'Please wait');
    await recordAttendance('student', id.trim(), name ? name.trim() : id.trim(), 'studentStatus');
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

    const recEl = document.getElementById('actionTodayRecord');
    const btnIn = document.getElementById('actionBtnIn');
    const btnOut = document.getElementById('actionBtnOut');

    if (existing) {
        document.getElementById('actionTodayIn').textContent = (existing.time_in || '---') + ' (' + existing.status + ')';
        document.getElementById('actionTodayOut').textContent = existing.time_out || '---';
        recEl.classList.remove('hidden');
        if (existing.time_in) { btnIn.classList.add('action-btn-done'); btnIn.disabled = true; }
        if (existing.time_out) { btnOut.classList.add('action-btn-done'); btnOut.disabled = true; }
    } else {
        recEl.classList.add('hidden');
        btnIn.classList.remove('action-btn-done'); btnIn.disabled = false;
        btnOut.classList.remove('action-btn-done'); btnOut.disabled = false;
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

    const success = await recordAttendance('student', id, name, mode, 'actionMsg');
    msgEl.style.display = 'flex';

    // Refresh today record
    const today = todayDate();
    const { data: updated } = await db.from('attendance_logs')
        .select('*').eq('lrn', id).eq('date', today).eq('person_type', 'student').maybeSingle();
    if (updated) {
        document.getElementById('actionTodayIn').textContent = (updated.time_in || '---') + ' (' + updated.status + ')';
        document.getElementById('actionTodayOut').textContent = updated.time_out || '---';
        document.getElementById('actionTodayRecord').classList.remove('hidden');
        if (updated.time_in) { btnIn.classList.add('action-btn-done'); btnIn.disabled = true; }
        if (updated.time_out) { btnOut.classList.add('action-btn-done'); btnOut.disabled = true; }
    }

    if (success) setTimeout(() => goBackToScan(), 3000);
    else setTimeout(() => goBackToScan(), 3000);
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
    const dateId = role === 'teacher' ? 'teacherDateFilter' : 'adminDateFilter';
    const typeId = role === 'teacher' ? 'teacherTypeFilter' : 'adminTypeFilter';
    const dispId = role === 'teacher' ? 'teacherLogsDisplay' : 'adminLogsDisplay';
    const date = document.getElementById(dateId)?.value || todayDate();
    const type = document.getElementById(typeId)?.value || 'student';
    const display = document.getElementById(dispId);
    if (!display) return;
    display.innerHTML = '<div class="logs-empty">Loading...</div>';

    const { data, error } = await db.from('attendance_logs')
        .select('*').eq('date', date).eq('person_type', type)
        .order('time_in', { ascending: false });

    if (error) { display.innerHTML = `<div class="logs-empty">Error: ${error.message}</div>`; return; }
    if (!data?.length) { display.innerHTML = '<div class="logs-empty">No records found for this date.</div>'; return; }

    display.innerHTML = data.map(log => {
        const statusClass = log.status === 'Late' ? 'late' : log.status === 'Half Day' ? 'halfday' : log.status === 'No Time Out' ? 'noout' : log.status === 'Cutting Class' ? 'cutting' : 'ontime';
        const noTimeOut = !log.time_out;
        const forceBtn = noTimeOut
            ? `<button class="force-out-btn" onclick="forceStudentTimeOut('${log.id}', '${log.full_name.replace(/'/g, "\\'")}', '${role}')">⏏ OUT</button>`
            : '';
        return `<div class="log-item" id="log-row-${log.id}">
            <div>
                <span class="log-name">${log.full_name}</span>
                <span class="log-meta">IN: ${log.time_in || '—'} &nbsp;|&nbsp; OUT: ${log.time_out || '—'} &nbsp;|&nbsp; ID: ${log.lrn}</span>
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
    const [_, id, name] = parts;
    const personType = type.toLowerCase();
    setStatus('adminScanStatus', 'info', 'PROCESSING...', 'Please wait');
    await recordAttendance(personType, id.trim(), name ? name.trim() : id.trim(), 'adminScanStatus');
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

// Stats
async function loadStats() {
    const today = todayDate();
    const el = document.getElementById('statsDisplay');
    if (!el) return;
    el.innerHTML = '<div style="padding:20px;color:#888;font-size:13px;">Loading stats...</div>';

    const [stuToday, tchToday, stuLate, stuHalf, stuNoOut, stuAll] = await Promise.all([
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('person_type', 'student'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('person_type', 'teacher'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('person_type', 'student').eq('status', 'Late'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('person_type', 'student').eq('status', 'Half Day'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('person_type', 'student').is('time_out', null),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('person_type', 'student'),
    ]);

    el.innerHTML = `
        <div class="stat-card highlight">
            <div class="stat-label">Students Present Today</div>
            <div class="stat-value">${stuToday.count ?? 0}</div>
        </div>
        <div class="stat-card highlight">
            <div class="stat-label">Teachers Present Today</div>
            <div class="stat-value">${tchToday.count ?? 0}</div>
        </div>
        <div class="stat-card warn">
            <div class="stat-label">Late Today</div>
            <div class="stat-value">${stuLate.count ?? 0}</div>
        </div>
        <div class="stat-card warn">
            <div class="stat-label">Half Day Today</div>
            <div class="stat-value">${stuHalf.count ?? 0}</div>
        </div>
        <div class="stat-card warn">
            <div class="stat-label">No Time Out Yet</div>
            <div class="stat-value">${stuNoOut.count ?? 0}</div>
            <div class="stat-sub">Still inside campus</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Total Records (All Time)</div>
            <div class="stat-value">${stuAll.count ?? 0}</div>
        </div>
    `;
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
// ══════════════════════════════════════════════
async function recordAttendance(personType, lrn, name, mode, statusElId) {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = nowTime();
    const mins = now.getHours() * 60 + now.getMinutes();

    try {
        const { data: existing, error: fetchErr } = await db
            .from('attendance_logs').select('*')
            .eq('lrn', lrn).eq('date', date).eq('person_type', personType)
            .maybeSingle();
        if (fetchErr) throw fetchErr;

        if (mode === 'IN') {
            if (existing) {
                setStatus(statusElId, 'warning', 'ALREADY TIMED IN',
                    `${name} checked in at ${existing.time_in} — ${existing.status}`);
                return false;
            }
            // TIME IN status rules:
            // On Time  : 7:34 and earlier
            // Late     : 7:35 – 11:59
            // Half Day : 12:00 PM and later
            let status;
            if (mins <= 7 * 60 + 34) status = 'On Time';
            else if (mins < 12 * 60) status = 'Late';
            else status = 'Half Day';

            const { error: insErr } = await db.from('attendance_logs').insert({
                lrn, full_name: name, date, time_in: time, status, person_type: personType
            });
            if (insErr) throw insErr;
            setStatus(statusElId, 'success', `TIME IN — ${status}`, `${name} at ${time}`);
            flashSuccess(); showToast(`✓ ${name} — ${status}`);
            return true;

        } else {
            // TIME OUT
            if (!existing) {
                setStatus(statusElId, 'error', 'NO TIME IN RECORD', `${name} hasn't timed in today.`);
                return false;
            }
            if (existing.time_out) {
                setStatus(statusElId, 'warning', 'ALREADY TIMED OUT', `${name} left at ${existing.time_out}`);
                return false;
            }
            // TIME OUT status rules:
            // If time out is between 12:00 and before 4:00 PM → Half Day
            // If time out is 4:00 PM or later → keep original time-in status (Full day)
            const h = now.getHours();
            let updatedStatus = existing.status; // keep original by default
            if (h >= 12 && h < 16) {
                updatedStatus = 'Half Day'; // timed out before 4PM = half day
            }

            const { error: updErr } = await db.from('attendance_logs')
                .update({ time_out: time, status: updatedStatus })
                .eq('id', existing.id);
            if (updErr) throw updErr;
            setStatus(statusElId, 'success', `TIME OUT — ${updatedStatus}`, `${name} at ${time}`);
            flashSuccess(); showToast(`✓ ${name} timed out`);
            return true;
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

