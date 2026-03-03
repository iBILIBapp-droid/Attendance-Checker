// Replace with your actual Supabase credentials
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let html5QrCode;
let currentMode = 'IN';

document.addEventListener('DOMContentLoaded', () => {
    // Start scanner with a slight delay to ensure DOM is ready
    setTimeout(startScanner, 1000);
});

async function startScanner() {
    const statusDiv = document.getElementById('loginStatus');
    const retryBtn = document.getElementById('retryBtn');

    try {
        const scanner = new Html5Qrcode("initialReader");
        const config = {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
        };

        await scanner.start(
            { facingMode: "environment" },
            config,
            async (decodedText) => {
                await scanner.stop();
                handleLogin(decodedText);
            }
        );
        statusDiv.innerHTML = "<p style='color:green'>Camera Active. Scan now.</p>";
    } catch (err) {
        console.error("Camera Error:", err);
        statusDiv.className = "status-display error";
        statusDiv.innerHTML = `<h3>Camera Error</h3><p>${err}. Ensure you are on HTTPS.</p>`;
        retryBtn.classList.remove('hidden');
    }
}

async function handleLogin(qrData) {
    const [type, id, name] = qrData.split('|');
    if (!type || !id) {
        alert("Invalid QR format. Use: TYPE|ID|NAME");
        location.reload();
        return;
    }

    // Hide login, show main app
    document.getElementById('initialScanScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    document.getElementById('userInfo').innerText = `${name} (${type})`;

    // Start the attendance scanner
    const mainScanner = new Html5Qrcode("reader");
    mainScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (text) => processAttendance(text));
}

async function processAttendance(qrData) {
    const [type, id, name] = qrData.split('|');
    const statusBox = document.getElementById('statusDisplay');
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toLocaleTimeString();

    if (type !== 'STUDENT') return;

    try {
        const { data: existing } = await supabase.from('attendance_logs').select('*').eq('lrn', id).eq('date', date).maybeSingle();

        if (currentMode === 'IN') {
            if (existing) {
                statusBox.innerHTML = `<h3>Already In</h3><p>${name} recorded today.</p>`;
                return;
            }
            await supabase.from('attendance_logs').insert({ lrn: id, full_name: name, date, time_in: time, status: 'On Time' });
            statusBox.innerHTML = `<h3 style="color:green">Success</h3><p>${name} IN at ${time}</p>`;
        } else {
            await supabase.from('attendance_logs').update({ time_out: time }).eq('id', existing.id);
            statusBox.innerHTML = `<h3 style="color:blue">Success</h3><p>${name} OUT at ${time}</p>`;
        }
    } catch (e) {
        statusBox.innerHTML = `<h3>Error</h3><p>Check database connection.</p>`;
    }
}

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
}