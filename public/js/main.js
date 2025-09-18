// === Sidebar toggle & Profile dropdown ===
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const profileBtn = document.getElementById('profileMenuBtn');
const profileMenu = document.getElementById('profileMenu');

sidebarToggle?.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
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

// === Socket.IO ===
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

// === Filter log agar tidak spam, hanya event penting ===
function addLog(msg, type = "info") {
  if (!logs) return;
  const time = new Date().toLocaleTimeString();
  logs.textContent += `[${time}] ${msg}\n`;
  logs.scrollTop = logs.scrollHeight;
}

// --- Events dari server ---
socket.on('ffmpeg:start', () => {
  ffStatus.textContent = 'RUNNING';
  ffStatus.className = 'badge bg-warning text-dark';
  startUptime();
  retryCnt.textContent = '0';
  addLog('FFmpeg started ✅');
  toastr.success('FFmpeg started');
});

socket.on('ffmpeg:status', (s) => {
  if (s.type === 'encoding') {
    ffStatus.textContent = 'Encoding…';
    ffStatus.className = 'badge bg-info text-dark';
    addLog(s.msg, 'info');
  }

  if (s.type === 'accepted') {
    ffStatus.textContent = 'LIVE ✅';
    ffStatus.className = 'badge bg-success';
    addLog(s.msg, 'success');
    toastr.success(s.msg);

    Swal.fire({
      icon: 'success',
      title: '🚀 LIVE!',
      text: 'Broadcast sudah tayang di YouTube.',
      confirmButtonColor: '#198754',
      background: '#fff'
    });
  }

  if (s.type === 'error') {
    ffStatus.textContent = 'ERROR';
    ffStatus.className = 'badge bg-danger';
    addLog(s.msg, 'error');
    toastr.error(s.msg);

    Swal.fire({
      icon: 'error',
      title: 'Live Failed',
      text: s.msg,
      confirmButtonColor: '#dc3545'
    });
  }

  if (s.type === 'retry') {
    ffStatus.textContent = 'Retrying…';
    ffStatus.className = 'badge bg-warning text-dark';
    retryCnt.textContent = (parseInt(retryCnt.textContent) + 1).toString();
    addLog(s.msg, 'warn');
    toastr.warning(s.msg);
  }
});

socket.on('ffmpeg:stop', () => {
  ffStatus.textContent = 'STOPPED';
  ffStatus.className = 'badge bg-secondary';
  stopUptime();
  addLog('FFmpeg stopped');
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
        toastr.success('Live started');
        uploadBar.style.width = '100%';
        uploadPct.textContent = '100%';
        loadBroadcasts();
      } else {
        toastr.error(res.error || 'Start failed');
        uploadBar.style.width = '0%';
        uploadPct.textContent = '0%';
      }
    } catch {
      toastr.error('Invalid response');
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
  const result = await Swal.fire({
    title: 'Stop Live?',
    text: 'Are you sure you want to end the broadcast?',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    cancelButtonColor: '#6c757d',
    confirmButtonText: 'Yes, stop it',
  });

  if (result.isConfirmed) {
    const r = await fetch('/live/stop', { method: 'POST' });
    const j = await r.json();
    if (j.ok) {
      Swal.fire({
        icon: 'success',
        title: 'Stopped',
        text: 'Your broadcast has ended.',
        confirmButtonColor: '#198754'
      });
      loadBroadcasts();
    } else {
      Swal.fire({
        icon: 'error',
        title: 'Failed',
        text: 'Could not stop the broadcast.'
      });
    }
  }
});

// === Load Broadcasts ===
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
          <td><span class="badge bg-secondary">${b.status.lifeCycleStatus}</span></td>
          <td>${date.toLocaleString()}</td>
          <td><a href="https://youtube.com/watch?v=${b.id}" target="_blank"><i class="fa fa-external-link"></i></a></td>
        `;
        body.appendChild(tr);
      });
    } else {
      body.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No broadcasts</td></tr>';
    }
  } catch (e) {
    console.error(e);
  }
}
loadBroadcasts();
setInterval(loadBroadcasts, 15000);

// === Load Categories ===
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
      if (cat.id === "22") opt.selected = true;
      sel.appendChild(opt);
    });
  } catch (e) {
    console.error(e);
  }
}
loadCategories();
