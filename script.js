const SUPABASE_URL = 'https://yapnbwxerwppsepcdcxi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhcG5id3hlcndwcHNlcGNkY3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MjY2NDIsImV4cCI6MjA4ODEwMjY0Mn0.ROjaZEjyQ22-GHEussOo1Sr7VCAhoWnjO-42NCWtrxk';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentMode = 'IN';
let userType, userLRN, userName;
let attendanceScanner = null;
let isProcessingScan = false;
let loginScanner = null;

// ── BOOT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    // Wire up login button
    document.getElementById('startScanBtn').addEventListener('click', startInitialScanner);

    // Wire up mode buttons
    document.getElementById('modeInBtn').addEventListener('click', () => setMode('IN'));
    document.getElementById('modeOutBtn').addEventListener('click', () => setMode('OUT'));

    // Wire up date filter
    document.getElementById('studentDateFilter').addEventListener('change', filterStudentLogs);

    // Set today's date on the filter
    document.getElementById('studentDateFilter').value = new Date().toISOString().split('T')[0];
});

// ── LOGIN SCANNER ─────────────────────────────────────────────
async function startInitialScanner() {
    const btn = document.getElementById('startScanBtn');
    const status = document.getElementById('loginStatus');

    btn.disabled = true;
    btn.textContent = '⏳  Starting Camera...';
    status.className = 'status-display info';
    status.innerHTML = '<h3>Camera Starting</h3><p>Allow camera permission if prompted.</p>';

    try {
        // Ask for permission explicitly first
        await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (err) {
        status.className = 'status-display error';
        status.innerHTML = `<h3>Permission Denied</h3><p>Please allow camera access in your browser settings, then refresh.</p>`;
        btn.disabled = false;
        btn.textContent = '📷  Scan ID to Login';
        return;
    }

    loginScanner = new Html5Qrcode('initialReader');

    try {
        await loginScanner.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 220, height: 220 } },
            async (text) => {
                try { await loginScanner.stop(); loginScanner = null; } catch (_) {}
                await identifyUser(text);
            },
            (errorMsg) => { /* ignore per-frame errors */ }
        );
        btn.style.display = 'none';
        status.className = 'status-display info';
        status.innerHTML = '<h3>Camera Active</h3><p>Scan your ID card now</p>';
    } catch (err) {
        status.className = 'status-display error';
        status.innerHTML = `<h3>Camera Error</h3><p>${err.message || err}</p>`;
        btn.disabled = false;
        btn.textContent = '📷  Scan ID to Login';
        console.error('Login scanner error:', err);
    }
}

// ── IDENTIFY USER ─────────────────────────────────────────────
async function identifyUser(qrData) {
    const parts = qrData.split('|');
    if (parts.length < 2) {
        alert('Invalid QR format. Expected: TYPE|ID|Name');
        location.reload();
        return;
    }

    const [type, id, name] = parts;
    userType = type.trim().toLowerCase();
    userLRN = id.trim();
    userName = name ? name.trim() : id.trim();

    document.getElementById('initialScanScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    document.getElementById('userInfo').textContent = `Logged in as: ${userName} (${type.trim()})`;

    setupTabs();
    await startAttendanceScanner();
}

// ── ATTENDANCE SCANNER ────────────────────────────────────────
async function startAttendanceScanner() {
    if (attendanceScanner) {
        try { await attendanceScanner.stop(); } catch (_) {}
        attendanceScanner = null;
    }

    const readerEl = document.getElementById('reader');
    if (!readerEl) return;
    readerEl.innerHTML = '';

    attendanceScanner = new Html5Qrcode('reader');

    try {
        await attendanceScanner.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 220, height: 220 } },
            onAttendanceScan,
            (errorMsg) => { /* ignore per-frame errors */ }
        );
    } catch (err) {
        const statusBox = document.getElementById('statusDisplay');
        statusBox.className = 'status-display error';
        statusBox.innerHTML = `<h3>Camera Error</h3><p>${err.message || err}</p>`;
        console.error('Attendance scanner error:', err);
    }
}

// ── PROCESS SCAN ──────────────────────────────────────────────
async function onAttendanceScan(qrData) {
    if (isProcessingScan) return;
    isProcessingScan = true;

    const parts = qrData.split('|');
    const statusBox = document.getElementById('statusDisplay');

    if (!parts[0] || parts[0].trim().toUpperCase() !== 'STUDENT') {
        isProcessingScan = false;
        return;
    }

    const [_, id, name] = parts;
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    statusBox.className = 'status-display info';
    statusBox.innerHTML = '<h3>Processing...</h3><p>Please wait</p>';

    try {
        const { data: existing, error } = await supabase
            .from('attendance_logs')
            .select('*')
            .eq('lrn', id.trim())
            .eq('date', date)
            .maybeSingle();

        if (error) throw error;

        if (currentMode === 'IN') {
            if (existing) {
                statusBox.className = 'status-display error';
                statusBox.innerHTML = `<h3>Already Timed In</h3><p>${name} checked in at ${existing.time_in}</p>`;
            } else {
                const attendStatus = now.getHours() >= 8 ? 'Late' : 'On Time';
                const { error: insertErr } = await supabase.from('attendance_logs').insert({
                    lrn: id.trim(),
                    full_name: name ? name.trim() : id.trim(),
                    date, time_in: time, status: attendStatus
                });
                if (insertErr) throw insertErr;
                statusBox.className = 'status-display success';
                statusBox.innerHTML = `<h3>Time In — ${attendStatus}</h3><p>${name} at ${time}</p>`;
            }
        } else {
            if (!existing) {
                statusBox.className = 'status-display error';
                statusBox.innerHTML = `<h3>No Record Found</h3><p>${name} hasn't timed in today.</p>`;
            } else if (existing.time_out) {
                statusBox.className = 'status-display error';
                statusBox.innerHTML = `<h3>Already Timed Out</h3><p>${name} left at ${existing.time_out}</p>`;
            } else {
                const { error: updateErr } = await supabase
                    .from('attendance_logs').update({ time_out: time }).eq('id', existing.id);
                if (updateErr) throw updateErr;
                statusBox.className = 'status-display success';
                statusBox.innerHTML = `<h3>Time Out</h3><p>${name} at ${time}</p>`;
            }
        }
    } catch (e) {
        statusBox.className = 'status-display error';
        statusBox.innerHTML = `<h3>Error</h3><p>${e.message || 'Database error'}</p>`;
        console.error(e);
    }

    setTimeout(() => { isProcessingScan = false; }, 3000);
}

// ── TABS ──────────────────────────────────────────────────────
function setupTabs() {
    const nav = document.getElementById('tabNavigation');
    nav.innerHTML = `<button class="tab-btn active" data-tab="scanTab">📷 Scan</button>`;
    if (userType !== 'student') {
        nav.innerHTML += `<button class="tab-btn" data-tab="studentsTab">📋 Logs</button>`;
    }
    nav.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab, btn));
    });
}

function switchTab(id, btn) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    btn.classList.add('active');
    if (id === 'studentsTab') filterStudentLogs();
    if (id === 'scanTab') startAttendanceScanner();
}

function setMode(mode) {
    currentMode = mode;
    document.getElementById('modeInBtn').classList.toggle('active', mode === 'IN');
    document.getElementById('modeOutBtn').classList.toggle('active', mode === 'OUT');
}

// ── LOGS ──────────────────────────────────────────────────────
async function filterStudentLogs() {
    const date = document.getElementById('studentDateFilter').value
        || new Date().toISOString().split('T')[0];
    const display = document.getElementById('studentLogsDisplay');
    display.innerHTML = '<p style="padding:10px;color:#888;font-size:13px;">Loading...</p>';

    const { data, error } = await supabase
        .from('attendance_logs').select('*').eq('date', date)
        .order('time_in', { ascending: false });

    if (error) { display.innerHTML = `<p style="color:red;padding:10px;">Error: ${error.message}</p>`; return; }

    display.innerHTML = data?.length
        ? data.map(log => `
            <div>
                <strong>${log.full_name}</strong>
                IN: ${log.time_in} &nbsp;|&nbsp; OUT: ${log.time_out || '—'} &nbsp;|&nbsp;
                <span style="color:${log.status === 'Late' ? '#C8102E' : '#2E7D32'};font-weight:700;">${log.status}</span>
            </div>`).join('')
        : '<p style="padding:10px;color:#888;font-size:13px;">No logs found for this date.</p>';
}
