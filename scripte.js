// Replace with your actual credentials
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentMode = 'IN';
let loginScanner;
let attendanceScanner;
let userType, userName;

// Triggered by the button to satisfy browser security
async function initiateLoginCamera() {
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('loginStatus').innerHTML = "Requesting permission...";
    
    loginScanner = new Html5Qrcode("initialReader");
    
    const config = { 
        fps: 10, 
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0 
    };

    try {
        await loginScanner.start(
            { facingMode: "environment" }, 
            config,
            async (text) => {
                await loginScanner.stop();
                handleLogin(text);
            }
        );
        document.getElementById('loginStatus').innerHTML = "Camera Active. Scan ID.";
    } catch (err) {
        document.getElementById('loginStatus').innerHTML = `<span style="color:red">Error: ${err}</span>`;
        document.getElementById('startBtn').style.display = 'block';
    }
}

async function handleLogin(qrData) {
    const parts = qrData.split('|');
    if (parts.length < 2) {
        alert("Invalid QR Format");
        location.reload();
        return;
    }

    const [type, id, name] = parts;
    userType = type.toLowerCase();
    userName = name;

    // UI Transition
    document.getElementById('initialScanScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    document.getElementById('userInfo').innerText = `${userName} (${type})`;
    
    setupNavigation();
    startAttendanceScanner();
}

function startAttendanceScanner() {
    attendanceScanner = new Html5Qrcode("reader");
    attendanceScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        (text) => processAttendance(text)
    );
}

async function processAttendance(qrData) {
    const [type, id, name] = qrData.split('|');
    const statusBox = document.getElementById('statusDisplay');
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toLocaleTimeString();

    if (type !== 'STUDENT') return;

    try {
        const { data: existing } = await supabase.from('attendance_logs')
            .select('*').eq('lrn', id).eq('date', date).maybeSingle();

        if (currentMode === 'IN') {
            if (existing) {
                statusBox.innerHTML = `<h3>Already In</h3><p>${name} recorded today.</p>`;
                return;
            }
            await supabase.from('attendance_logs').insert({ 
                lrn: id, full_name: name, date, time_in: time, status: now.getHours() >= 8 ? 'Late' : 'On Time' 
            });
            statusBox.innerHTML = `<h3 style="color:green">Success</h3><p>${name} IN at ${time}</p>`;
        } else {
            if (!existing) {
                statusBox.innerHTML = `<h3>Error</h3><p>No IN record found.</p>`;
                return;
            }
            await supabase.from('attendance_logs').update({ time_out: time }).eq('id', existing.id);
            statusBox.innerHTML = `<h3 style="color:blue">Success</h3><p>${name} OUT at ${time}</p>`;
        }
    } catch (e) {
        console.error(e);
    }
}

function setupNavigation() {
    const nav = document.getElementById('tabNavigation');
    nav.innerHTML = `<button class="tab-btn active" onclick="switchTab('scanTab', this)">Scanner</button>`;
    if (userType !== 'student') {
        nav.innerHTML += `<button class="tab-btn" onclick="switchTab('studentsTab', this)">Logs</button>`;
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
    const { data } = await supabase.from('attendance_logs').select('*').eq('date', date);
    const display = document.getElementById('studentLogsDisplay');
    display.innerHTML = data?.length ? data.map(log => `
        <div style="padding:10px; border-bottom:1px solid #eee;">
            <strong>${log.full_name}</strong><br>In: ${log.time_in} | Out: ${log.time_out || '--'}
        </div>`).join('') : "<p>No logs found.</p>";
}
