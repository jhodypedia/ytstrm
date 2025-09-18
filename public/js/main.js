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

// === Socket.IO for FFmpeg logs & status ===
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
  ffStatus.className = 'badge bg-warning text-dark';
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

// === Status Events (encoding, retry, live, error) ===
socket.on('ffmpeg:status', (s) => {
  if (s.type === 'encoding') {
    ffStatus.textContent = 'Encoding…';
    ffStatus.className = 'badge bg-info text-dark';
  }

  if (s.type === 'retry') {
    ffStatus.textContent = 'Retrying…';
    ffStatus.className = 'badge bg-warning text-dark';
    toastr.warning(s.msg);
  }

  if (s.type === 'accepted') {
    ffStatus.textContent = 'LIVE ✅';
    ffStatus.className = 'badge bg-success live-badge';

    toastr.success(s.msg);

    // SweetAlert2 popup besar saat LIVE
    Swal.fire({
      icon: 'success',
      title: '🚀 You are LIVE!',
      text: 'Your broadcast is now live on YouTube.',
      confirmButtonText: 'Awesome!',
      confirmButtonColor: '#198754',
      background: '#fff',
      backdrop: `
        rgba(0,0,0,0.6)
        url("https://media.giphy.com/media/3o7abB06u9bNzA8lu8/giphy.gif")
        center top
        no-repeat
      `
    });
  }

  if (s.type === 'error') {
    ffStatus.textContent = 'ERROR';
    ffStatus.className = 'badge bg-danger';
    toastr.error(s.msg);

    Swal.fire({
      icon: 'error',
      title: 'Live Failed',
      text: s.msg,
      confirmButtonColor: '#dc3545'
    });
  }

  if (logs) {
    logs.textContent += `[STATUS] ${s.msg}\n`;
    logs.scrollTop = logs.scrollHeight;
  }
});

socket.on('ffmpeg:stop', () => {
  ffStatus.textContent = 'STOPPED';
  ffStatus.className = 'badge bg-secondary';
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

// === Stop button with confirmation ===
stopBtn?.addEventListener('click', async () => {
  const result = await Swal.fire({
    title: 'Stop Live?',
    text: 'Are you sure you want to end the live broadcast?',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    cancelButtonColor: '#6c757d',
    confirmButtonText: 'Yes, stop it!',
    cancelButtonText: 'Cancel'
  });

  if (result.isConfirmed) {
    const r = await fetch('/live/stop', { method: 'POST' });
    const j = await r.json();
    if (j.ok) {
      Swal.fire({
        icon: 'success',
        title: 'Broadcast Ended',
        text: 'Your live stream has been stopped.',
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

// === Load Broadcasts realtime ===
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
          <td><a href="https://youtube.com/watch?v=${b.id}" target="_blank">
              <i class="fa fa-external-link"></i></a></td>`;
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

// === Load Categories realtime ===
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
