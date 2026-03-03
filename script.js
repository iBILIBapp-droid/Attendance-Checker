// ═══════════════════════════════════════════════
//  PRESENCE — Attendance System
//  Replace YOUR_PROJECT_URL and YOUR_ANON_KEY
//  with your actual Supabase credentials.
// ═══════════════════════════════════════════════
const SUPABASE_URL  = 'https://yapnbwxerwppsepcdcxi.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhcG5id3hlcndwcHNlcGNkY3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MjY2NDIsImV4cCI6MjA4ODEwMjY0Mn0.ROjaZEjyQ22-GHEussOo1Sr7VCAhoWnjO-42NCWtrxk';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ────────────────────────────────────
let currentUser   = null; // { id, name, type: 'student'|'teacher'|'admin' }
let loginScanner  = null;
let activeScanner = null;
let scanMode      = 'IN';   // current scan mode for active scanner
let scanLock      = false;  // debounce

// ── Boot ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Login button
    document.getElementById('loginScanBtn').addEventListener('click', startLoginScanner);

    // Teacher tabs
    wireTabNav('teacherNav', startTeacherScannerIfNeeded);

    // Admin tabs
    wireTabNav('adminNav', startAdminScannerIfNeeded);

    // Date filters — default to today
    const today = todayDate();
    ['teacherDateFilter','adminDateFilter'].forEach(id => {
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
    try { if (ref.isScanning) await ref.stop(); } catch (_) {}
    return null;
}

// ── LOGIN SCANNER ─────────────────────────────
async function startLoginScanner() {
    const btn    = document.getElementById('loginScanBtn');
    const status = document.getElementById('loginStatus');
    btn.disabled = true;
    btn.textContent = '⏳ STARTING CAMERA...';
    setStatus('loginStatus', 'info', 'CAMERA STARTING', 'Please allow camera permission if prompted.');

    try {
        await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (err) {
        setStatus('loginStatus', 'error', 'PERMISSION DENIED', 'Allow camera access in browser settings, then refresh.');
        btn.disabled = false; btn.innerHTML = '<span class="btn-icon">📷</span> ACTIVATE CAMERA';
        return;
    }

    const readerEl = document.getElementById('login-reader');
    readerEl.innerHTML = '';
    loginScanner = new Html5Qrcode('login-reader');

    try {
        await loginScanner.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 220, height: 220 } },
            async (text) => {
                await stopScanner(loginScanner); loginScanner = null;
                await handleLogin(text);
            },
            () => {}
        );
        btn.style.display = 'none';
        setStatus('loginStatus', 'info', 'CAMERA ACTIVE', 'Scan your ID card now');
    } catch (err) {
        setStatus('loginStatus', 'error', 'CAMERA ERROR', err.message || String(err));
        btn.disabled = false; btn.innerHTML = '<span class="btn-icon">📷</span> ACTIVATE CAMERA';
    }
}

// ── HANDLE LOGIN QR ───────────────────────────
// QR format:  TYPE|ID|Full Name
// TYPE = STUDENT, TEACHER, ADMIN
async function handleLogin(qrData) {
    const parts = qrData.trim().split('|');
    if (parts.length < 2) {
        setStatus('loginStatus', 'error', 'INVALID QR', 'Expected format: TYPE|ID|Name');
        document.getElementById('loginScanBtn').style.display = 'flex';
        document.getElementById('loginScanBtn').disabled = false;
        document.getElementById('loginScanBtn').innerHTML = '<span class="btn-icon">📷</span> ACTIVATE CAMERA';
        return;
    }
    const [type, id, name] = parts;
    currentUser = { type: type.trim().toLowerCase(), id: id.trim(), name: name ? name.trim() : id.trim() };

    if (currentUser.type === 'student') {
        document.getElementById('studentBadge').innerHTML = `${currentUser.name}<br><span style="font-size:9px;opacity:0.7">STUDENT • ${currentUser.id}</span>`;
        showScreen('student');
        await startStudentScanner();
    } else if (currentUser.type === 'teacher') {
        document.getElementById('teacherBadge').innerHTML = `${currentUser.name}<br><span style="font-size:9px;opacity:0.7">TEACHER</span>`;
        showScreen('teacher');
        await startTeacherScanner();
        loadTeacherOwnTime();
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
            { fps: 10, qrbox: { width: 220, height: 220 } },
            onScan,
            () => {}
        );
        activeScanner = scanner;
    } catch (err) {
        console.error('Scanner start error:', err);
    }
}

// ══════════════════════════════════════════════
//  STUDENT SCREEN
// ══════════════════════════════════════════════
let studentScanMode = 'IN';

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
    await recordAttendance('student', id.trim(), name ? name.trim() : id.trim(), studentScanMode, 'studentStatus');
    setTimeout(() => { scanLock = false; }, 3000);
}

// ══════════════════════════════════════════════
//  TEACHER SCREEN
// ══════════════════════════════════════════════
let teacherScanMode = 'IN';

function setTeacherScanMode(mode) {
    teacherScanMode = mode;
    document.getElementById('tchModeIn').classList.toggle('active', mode === 'IN');
    document.getElementById('tchModeOut').classList.toggle('active', mode === 'OUT');
}

async function startTeacherScanner() {
    await startQrScanner('teacher-reader', onTeacherScan);
}

async function onTeacherScan(qrData) {
    if (scanLock) return;
    scanLock = true;
    const parts = qrData.trim().split('|');
    if (!parts[0] || parts[0].trim().toUpperCase() !== 'STUDENT') { scanLock = false; return; }
    const [_, id, name] = parts;
    setStatus('teacherScanStatus', 'info', 'PROCESSING...', 'Please wait');
    await recordAttendance('student', id.trim(), name ? name.trim() : id.trim(), teacherScanMode, 'teacherScanStatus');
    setTimeout(() => { scanLock = false; }, 3000);
}

async function startTeacherScannerIfNeeded(tabId) {
    if (tabId === 'teacherScanTab') await startTeacherScanner();
    if (tabId === 'teacherLogsTab') loadLogs('teacher');
    if (tabId === 'teacherTimeTab') loadTeacherOwnTime();
}

// Teacher logs
async function loadLogs(role) {
    const dateId   = role === 'teacher' ? 'teacherDateFilter' : 'adminDateFilter';
    const typeId   = role === 'teacher' ? 'teacherTypeFilter' : 'adminTypeFilter';
    const dispId   = role === 'teacher' ? 'teacherLogsDisplay' : 'adminLogsDisplay';
    const date     = document.getElementById(dateId)?.value || todayDate();
    const type     = document.getElementById(typeId)?.value || 'student';
    const display  = document.getElementById(dispId);
    if (!display) return;
    display.innerHTML = '<div class="logs-empty">Loading...</div>';

    const { data, error } = await db.from('attendance_logs')
        .select('*').eq('date', date).eq('person_type', type)
        .order('time_in', { ascending: false });

    if (error) { display.innerHTML = `<div class="logs-empty">Error: ${error.message}</div>`; return; }
    if (!data?.length) { display.innerHTML = '<div class="logs-empty">No records found for this date.</div>'; return; }

    display.innerHTML = data.map(log => {
        const statusClass = log.status === 'Late' ? 'late' : 'ontime';
        return `<div class="log-item">
            <div>
                <span class="log-name">${log.full_name}</span>
                <span class="log-meta">IN: ${log.time_in || '—'} &nbsp;|&nbsp; OUT: ${log.time_out || '—'} &nbsp;|&nbsp; ID: ${log.lrn}</span>
            </div>
            <span class="log-status ${statusClass}">${log.status}</span>
        </div>`;
    }).join('');
}

// Teacher's own time in/out
async function loadTeacherOwnTime() {
    if (!currentUser) return;
    const today = todayDate();
    const { data } = await db.from('attendance_logs')
        .select('*').eq('lrn', currentUser.id).eq('date', today).eq('person_type', 'teacher').maybeSingle();
    document.getElementById('tchTimeIn').textContent  = data?.time_in  || '—';
    document.getElementById('tchTimeOut').textContent = data?.time_out || '—';
    document.getElementById('tchStatus').textContent  = data?.status   || '—';
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
    const status = new Date().getHours() >= 8 ? 'Late' : 'On Time';
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
    await recordAttendance(personType, id.trim(), name ? name.trim() : id.trim(), adminScanMode, 'adminScanStatus');
    setTimeout(() => { scanLock = false; }, 3000);
}

async function startAdminScannerIfNeeded(tabId) {
    if (tabId === 'adminScanTab')     await startAdminScanner();
    if (tabId === 'adminLogsTab')     loadLogs('admin');
    if (tabId === 'adminStatsTab')    loadStats();
    if (tabId === 'adminStudentsTab') searchPeople();
}

// Stats
async function loadStats() {
    const today = todayDate();
    const el = document.getElementById('statsDisplay');
    if (!el) return;
    el.innerHTML = '<div style="padding:20px;color:#888;font-size:13px;">Loading stats...</div>';

    const [stuToday, tchToday, stuLate, stuAll] = await Promise.all([
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('person_type', 'student'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('person_type', 'teacher'),
        db.from('attendance_logs').select('id', { count: 'exact' }).eq('date', today).eq('person_type', 'student').eq('status', 'Late'),
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
            <div class="stat-label">Late Students Today</div>
            <div class="stat-value">${stuLate.count ?? 0}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Total Records (All Time)</div>
            <div class="stat-value">${stuAll.count ?? 0}</div>
            <div class="stat-sub">Student attendance entries</div>
        </div>
    `;
}

// People search
async function searchPeople() {
    const query  = document.getElementById('peopleSearch')?.value.toLowerCase() || '';
    const type   = document.getElementById('peopleTypeFilter')?.value || 'student';
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

    const headers = ['LRN/ID','Full Name','Date','Time In','Time Out','Status','Type'];
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
    const now   = new Date();
    const date  = now.toISOString().split('T')[0];
    const time  = nowTime();

    try {
        const { data: existing, error: fetchErr } = await db
            .from('attendance_logs').select('*')
            .eq('lrn', lrn).eq('date', date).eq('person_type', personType)
            .maybeSingle();
        if (fetchErr) throw fetchErr;

        if (mode === 'IN') {
            if (existing) {
                setStatus(statusElId, 'warning', 'ALREADY TIMED IN', `${name} checked in at ${existing.time_in}`);
                return;
            }
            const status = now.getHours() >= 8 ? 'Late' : 'On Time';
            const { error: insErr } = await db.from('attendance_logs').insert({
                lrn, full_name: name, date, time_in: time, status, person_type: personType
            });
            if (insErr) throw insErr;
            setStatus(statusElId, 'success', `TIME IN — ${status}`, `${name} at ${time}`);
            showToast(`✓ ${name} timed in`);
        } else {
            if (!existing) {
                setStatus(statusElId, 'error', 'NO TIME IN RECORD', `${name} hasn't timed in today.`);
                return;
            }
            if (existing.time_out) {
                setStatus(statusElId, 'warning', 'ALREADY TIMED OUT', `${name} left at ${existing.time_out}`);
                return;
            }
            const { error: updErr } = await db.from('attendance_logs').update({ time_out: time }).eq('id', existing.id);
            if (updErr) throw updErr;
            setStatus(statusElId, 'success', 'TIME OUT', `${name} at ${time}`);
            showToast(`✓ ${name} timed out`);
        }
    } catch (e) {
        setStatus(statusElId, 'error', 'DATABASE ERROR', e.message || 'Unknown error');
        console.error(e);
    }
}
