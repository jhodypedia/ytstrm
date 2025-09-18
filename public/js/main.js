// === Sidebar toggle & Profile dropdown ===
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const profileBtn = document.getElementById('profileMenuBtn');
const profileMenu = document.getElementById('profileMenu');

sidebarToggle?.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
});

document.addEventListener('click', (e) => {
  if (e.target === profileBtn) {
    profileMenu.style.display = profileMenu.style.display === 'block' ? 'none' : 'block';
  } else if (!profileMenu.contains(e.target)) {
    profileMenu.style.display = 'none';
  }
});

// === Toastr defaults ===
toastr.options = {
  positionClass: 'toast-bottom-right',
  timeOut: 2500,
};

// === Socket.IO for FFmpeg logs ===
const socket = io();
const logs = document.getElementById('logs');
const ffStatus = document.getElementById('ffStatus');
const uptimeEl = document.getElementById('uptime');
const retryCnt = document.getElementById('retryCnt');

let uptimeSec = 0;
let uptimeTimer = null;

const startUptime = () => {
  clearInterval(uptimeTimer);
  uptimeSec = 0;
  uptimeTimer = setInterval(() => {
    uptimeSec++;
    uptimeEl.textContent = `${uptimeSec}s`;
  }, 1000);
};
const stopUptime = () => { clearInterval(uptimeTimer); uptimeEl.textContent = "0s"; };

socket.on('ffmpeg:start', () => {
  ffStatus.textContent = 'RUNNING';
  ffStatus.className = 'num text-success';
  startUptime();
  retryCnt.textContent = '0';
  toastr.success('FFmpeg started');
});

socket.on('ffmpeg:log', (d) => {
  if (!logs) return;
  const line = (d.line || d).toString();
  logs.textContent += line;
  if (logs.textContent.length > 100000) {
    logs.textContent = logs.textContent.slice(-80000);
  }
  logs.scrollTop = logs.scrollHeight;

  // Cek apakah ada info retry
  if (line.includes('Restart attempt')) {
    const match = line.match(/attempt (\d+)/);
    if (match) retryCnt.textContent = match[1];
  }
});

socket.on('ffmpeg:stop', () => {
  ffStatus.textContent = 'STOPPED';
  ffStatus.className = 'num text-danger';
  stopUptime();
  toastr.info('FFmpeg stopped');
});

// === Upload with progress bar (XHR) ===
const startForm = document.getElementById('startForm');
const uploadBar = document.getElementById('uploadBar');
const uploadPct = document.getElementById('uploadPct');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');

startForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(startForm);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/live/start', true);

  startBtn.disabled = true;
  uploadBar.style.width = '0%';
  uploadPct.textContent = '0%';

  xhr.upload.onprogress = (ev) => {
    if (ev.lengthComputable) {
      const pct = Math.round((ev.loaded / ev.total) * 100);
      uploadBar.style.width = pct + '%';
      uploadPct.textContent = pct + '%';
    }
  };

  xhr.onload = () => {
    startBtn.disabled = false;
    try {
      const res = JSON.parse(xhr.responseText || '{}');
      if (res.ok) {
        toastr.success('Live dimulai');
        uploadBar.style.width = '100%';
        uploadPct.textContent = '100%';
      } else {
        toastr.error(res.error || 'Gagal start');
        uploadBar.style.width = '0%';
        uploadPct.textContent = '0%';
      }
    } catch {
      toastr.error('Response tidak valid');
    }
  };

  xhr.onerror = () => {
    startBtn.disabled = false;
    toastr.error('Network error');
  };

  xhr.send(fd);
});

// === Stop button ===
stopBtn?.addEventListener('click', async () => {
  const r = await fetch('/live/stop', { method: 'POST' });
  const j = await r.json();
  if (j.ok) {
    toastr.info('Stop signal sent');
  } else {
    toastr.error('Gagal stop');
  }
});

// === Demo: simple table data & pagination ===
const demoData = Array.from({ length: 37 }).map((_, i) => ({
  id: i + 1,
  bid: 'BRDCST-' + (1000 + i),
  privacy: i % 2 ? 'unlisted' : 'public',
  date: new Date(Date.now() - i * 864e5).toISOString().slice(0, 10),
}));
const body = document.getElementById('demoBody');
const pager = document.getElementById('pager');
if (body && pager) {
  let page = 1, per = 8, pages = Math.ceil(demoData.length / per);
  const render = () => {
    body.innerHTML = '';
    demoData.slice((page - 1) * per, page * per).forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.id}</td><td>${r.bid}</td><td>${r.privacy}</td><td>${r.date}</td>`;
      body.appendChild(tr);
    });
    pager.innerHTML = '';
    for (let p = 1; p <= pages; p++) {
      const b = document.createElement('button');
      b.className = 'page' + (p === page ? ' active' : '');
      b.textContent = p;
      b.onclick = () => { page = p; render(); };
      pager.appendChild(b);
    }
  };
  render();
}
