const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentMode = 'IN';
let userType, userLRN, userName;
let attendanceScanner = null;
let isProcessingScan = false; // Debounce flag to prevent duplicate scans

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('loadingOverlay')?.remove();
});

// ── LOGIN SCANNER ──────────────────────────────────────────────
async function startInitialScanner() {
    const btn = document.getElementById('startScanBtn');
    const status = document.getElementById('loginStatus');

    btn.style.display = 'none';
    status.className = 'status-display info';
    status.innerHTML = '<h3>Camera Starting</h3><p>Allow camera permission if prompted.</p>';

    // Small delay lets the browser repaint before camera starts
    await new Promise(r => setTimeout(r, 300));

    const scanner = new Html5Qrcode('initialReader');

    try {
        await scanner.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 220, height: 220 } },
            async (text) => {
                // Stop scanner immediately so camera releases
                try { await scanner.stop(); } catch (_) {}
                await identifyUser(text);
            }
        );
        status.className = 'status-display info';
        status.innerHTML = '<h3>Camera Active</h3><p>Scan your ID card to login</p>';
    } catch (err) {
        status.className = 'status-display error';
        status.innerHTML = `<h3>Camera Error</h3><p>${err.message || err}</p>`;
        btn.style.display = 'block';
        console.error('Login scanner error:', err);
    }
}

// ── IDENTIFY USER FROM QR ──────────────────────────────────────
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

// ── ATTENDANCE SCANNER ─────────────────────────────────────────
async function startAttendanceScanner() {
    if (attendanceScanner) {
        try { await attendanceScanner.stop(); } catch (_) {}
        attendanceScanner = null;
    }

    const readerEl = document.getElementById('reader');
    if (!readerEl) return;

    // Clear any leftover HTML5QrCode UI
    readerEl.innerHTML = '';

    attendanceScanner = new Html5Qrcode('reader');

    try {
        await attendanceScanner.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 220, height: 220 } },
            onAttendanceScan
        );
    } catch (err) {
        console.error('Attendance scanner error:', err);
        const statusBox = document.getElementById('statusDisplay');
        if (statusBox) {
            statusBox.className = 'status-display error';
            statusBox.innerHTML = `<h3>Camera Error</h3><p>${err.message || err}</p>`;
        }
    }
}

// ── PROCESS ATTENDANCE SCAN ────────────────────────────────────
async function onAttendanceScan(qrData) {
    if (isProcessingScan) return; // Skip duplicate fires
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
                const status = now.getHours() >= 8 ? 'Late' : 'On Time';
                const { error: insertErr } = await supabase.from('attendance_logs').insert({
                    lrn: id.trim(),
                    full_name: name ? name.trim() : id.trim(),
                    date,
                    time_in: time,
                    status
                });
                if (insertErr) throw insertErr;
                statusBox.className = 'status-display success';
                statusBox.innerHTML = `<h3>Time In — ${status}</h3><p>${name} at ${time}</p>`;
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
                    .from('attendance_logs')
                    .update({ time_out: time })
                    .eq('id', existing.id);
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

    // Allow next scan after 3 seconds
    setTimeout(() => { isProcessingScan = false; }, 3000);
}

// ── TABS ───────────────────────────────────────────────────────
function setupTabs() {
    const nav = document.getElementById('tabNavigation');
    nav.innerHTML = `<button class="tab-btn active" onclick="switchTab('scanTab', this)">📷 Scan</button>`;
    if (userType !== 'student') {
        nav.innerHTML += `<button class="tab-btn" onclick="switchTab('studentsTab', this)">📋 Logs</button>`;
    }
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
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
}

// ── LOGS ───────────────────────────────────────────────────────
async function filterStudentLogs() {
    const date = document.getElementById('studentDateFilter').value
        || new Date().toISOString().split('T')[0];

    const display = document.getElementById('studentLogsDisplay');
    display.innerHTML = '<p style="padding:10px; color:#888; font-size:13px;">Loading...</p>';

    const { data, error } = await supabase
        .from('attendance_logs')
        .select('*')
        .eq('date', date)
        .order('time_in', { ascending: false });

    if (error) {
        display.innerHTML = `<p style="color:red; padding:10px;">Error: ${error.message}</p>`;
        return;
    }

    display.innerHTML = data?.length
        ? data.map(log => `
            <div>
                <strong>${log.full_name}</strong>
                IN: ${log.time_in} &nbsp;|&nbsp; OUT: ${log.time_out || '—'} &nbsp;|&nbsp; <span style="color:${log.status === 'Late' ? '#C8102E' : '#2E7D32'}; font-weight:700;">${log.status}</span>
            </div>`).join('')
        : '<p style="padding:10px; color:#888; font-size:13px;">No logs found for this date.</p>';
}
