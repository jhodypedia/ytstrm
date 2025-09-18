// === Sidebar toggle & Profile dropdown ===
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const profileBtn = document.getElementById('profileMenuBtn');
const profileMenu = document.getElementById('profileMenu');

sidebarToggle?.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  // hide label text when collapsed (optional)
  document.querySelectorAll('.side-link .txt').forEach(el => {
    el.style.display = sidebar.classList.contains('collapsed') ? 'none' : 'inline';
  });
});

document.addEventListener('click', (e) => {
  if (e.target === profileBtn) {
    profileMenu.style.display = profileMenu.style.display === 'block' ? 'none' : 'block';
  } else if (profileMenu && !profileMenu.contains(e.target)) {
    profileMenu.style.display = 'none';
  }
});

// === Toastr defaults ===
toastr.options = { positionClass: 'toast-bottom-right', timeOut: 2500 };

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
  ffStatus.classList.add('text-success');
  startUptime();
  retryCnt.textContent = '0';
  toastr.success('FFmpeg started');
});
socket.on('ffmpeg:log', (d) => {
  if (!logs) return;
  const line = (d.line || d).toString();
  logs.textContent += line;
  if (logs.textContent.length > 120000) {
    logs.textContent = logs.textContent.slice(-90000);
  }
  logs.scrollTop = logs.scrollHeight;

  if (line.includes('Restart attempt')) {
    const match = line.match(/attempt (\d+)/);
    if (match) retryCnt.textContent = match[1];
  }
});
socket.on('ffmpeg:stop', () => {
  ffStatus.textContent = 'STOPPED';
  ffStatus.classList.remove('text-success');
  stopUptime();
  toastr.info('FFmpeg stopped');
});

// === Upload with progress bar ===
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
        loadBroadcasts();
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
    loadBroadcasts();
  } else {
    toastr.error('Gagal stop');
  }
});

// === Load Broadcasts real ===
async function loadBroadcasts() {
  try {
    const res = await fetch('/live/list');
    const j = await res.json();
    const body = document.getElementById('broadcastTable');
    if (!body) return;
    body.innerHTML = '';
    if (j.items && j.items.length) {
      j.items.forEach(b => {
        const tr = document.createElement('tr');
        const date = new Date(b.snippet.scheduledStartTime || b.snippet.publishedAt || Date.now());
        tr.className = 'fade-in';
        tr.innerHTML = `
          <td>${b.snippet.title}</td>
          <td><span class="badge ${b.status.lifeCycleStatus}">${b.status.lifeCycleStatus}</span></td>
          <td>${date.toLocaleString()}</td>
          <td><a href="https://youtube.com/watch?v=${b.id}" target="_blank">
              <i class="fa fa-external-link"></i></a></td>`;
        body.appendChild(tr);
      });
    } else {
      body.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Tidak ada broadcast</td></tr>';
    }
  } catch (e) {
    console.error(e);
  }
}
// initial & interval refresh
loadBroadcasts();
setInterval(loadBroadcasts, 15000);

// === Load Kategori real ===
async function loadCategories() {
  try {
    const res = await fetch('/live/categories');
    const j = await res.json();
    const sel = document.querySelector('select[name="categoryId"]');
    if (!sel) return;
    sel.innerHTML = '';
    j.items.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.snippet.title;
      if (cat.id === "22") opt.selected = true; // default People & Blogs
      sel.appendChild(opt);
    });
  } catch (e) {
    console.error(e);
  }
}
loadCategories();
