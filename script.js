const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentMode = 'IN';
let userType, userLRN, userName;

// Boot: Remove auto-start to prevent the "Initializing" hang
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('loadingOverlay')?.remove(); 
});

// Triggered by manual button click
async function startInitialScanner() {
    const btn = document.getElementById('startScanBtn');
    const status = document.getElementById('loginStatus');
    
    btn.style.display = 'none';
    status.innerHTML = "<h3>Camera Starting...</h3><p>Please allow permission if prompted.</p>";

    const scanner = new Html5Qrcode("initialReader");
    try {
        await scanner.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: 250 },
            async (text) => {
                await scanner.stop();
                identifyUser(text);
            }
        );
        status.innerHTML = "<h3>Camera Active</h3><p>Scan your ID Card now</p>";
    } catch (err) {
        status.innerHTML = `<h3 style="color:red">Error</h3><p>${err}</p>`;
        btn.style.display = 'block';
    }
}

async function identifyUser(qrData) {
    const parts = qrData.split('|');
    if (parts.length < 2) {
        alert("Invalid QR format");
        location.reload();
        return;
    }

    const [type, id, name] = parts;
    userType = type.toLowerCase();
    userLRN = id;
    userName = name;

    // UI Transition
    document.getElementById('initialScanScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    document.getElementById('userInfo').textContent = `Logged in as: ${userName} (${type})`;
    
    setupTabs();
    initAttendanceScanner();
}

function initAttendanceScanner() {
    const scanner = new Html5Qrcode("reader");
    scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, onAttendanceScan);
}

async function onAttendanceScan(qrData) {
    const parts = qrData.split('|');
    const statusBox = document.getElementById('statusDisplay');
    if (parts[0] !== 'STUDENT') return;

    const [_, id, name] = parts;
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toLocaleTimeString();

    try {
        const { data: existing } = await supabase.from('attendance_logs').select('*').eq('lrn', id).eq('date', date).maybeSingle();

        if (currentMode === 'IN') {
            if (existing) {
                statusBox.className = "status-display error";
                statusBox.innerHTML = `<h3>Error</h3><p>${name} already timed in.</p>`;
                return;
            }
            const status = now.getHours() >= 8 ? 'Late' : 'On Time';
            await supabase.from('attendance_logs').insert({ lrn: id, full_name: name, date, time_in: time, status });
            statusBox.className = "status-display success";
            statusBox.innerHTML = `<h3>Success</h3><p>${name} IN at ${time}</p>`;
        } else {
            if (!existing) {
                statusBox.className = "status-display error";
                statusBox.innerHTML = `<h3>Error</h3><p>No IN record found for ${name}.</p>`;
                return;
            }
            await supabase.from('attendance_logs').update({ time_out: time }).eq('id', existing.id);
            statusBox.className = "status-display info";
            statusBox.innerHTML = `<h3>Success</h3><p>${name} OUT at ${time}</p>`;
        }
    } catch (e) { console.error(e); }
}

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
}

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
}

async function filterStudentLogs() {
    const date = document.getElementById('studentDateFilter').value || new Date().toISOString().split('T')[0];
    const { data } = await supabase.from('attendance_logs').select('*').eq('date', date).order('time_in', { ascending: false });
    const display = document.getElementById('studentLogsDisplay');
    display.innerHTML = data?.length ? data.map(log => `<div style="padding:10px; border-bottom:1px solid #eee;"><strong>${log.full_name}</strong><br>In: ${log.time_in} | Out: ${log.time_out || '--'} | ${log.status}</div>`).join('') : "<p>No logs found.</p>";
}
