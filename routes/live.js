import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { rimraf } from 'rimraf';

import { requireAuth } from '../middleware/auth.js';
import {
  createStreamAndBroadcast,
  setThumbnail,
  goLiveNow,
  endBroadcast,
  listBroadcasts,
  listCategories
} from '../services/youtube.js';
import { streamer, generateThumbnail } from '../services/ffmpeg.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

let ioRef = null;
let currentBroadcastId = null;

// === Socket attach for logs ===
export const attachIO = (io) => {
  ioRef = io;
  streamer.on('start', () => {
    ioRef.emit('ffmpeg:status', { type: 'encoding', msg: '🎬 FFmpeg started' });
  });
  streamer.on('stop', () => {
    ioRef.emit('ffmpeg:status', { type: 'stopped', msg: '🛑 FFmpeg stopped' });
  });
  streamer.on('log', (d) => {
    // filter log biar tidak spam
    const line = d.line || '';
    if (
      line.includes('bitrate') ||
      line.includes('frame=') ||
      line.includes('speed=')
    ) return;
  });
};

// === Helper: Poll broadcast status ===
async function waitUntilReady(youtube, broadcastId, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const { data } = await youtube.liveBroadcasts.list({
        part: 'id,status',
        id: broadcastId
      });
      const item = data.items?.[0];
      if (item?.status?.lifeCycleStatus === 'ready') {
        return true;
      }
    } catch (err) {
      console.error('poll error', err.message);
    }
    await new Promise(r => setTimeout(r, 5000)); // tunggu 5 detik
  }
  return false;
}

// === Dashboard ===
router.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard', { title: 'Dashboard' });
});

// === Start Live ===
router.post(
  '/start',
  requireAuth,
  upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const {
        title, description,
        privacyStatus = 'public',
        categoryId = '22',
        loop = 'yes',
        maxRetry = '3'
      } = req.body;

      const vbitrate = '4500k';
      const abitrate = '128k';
      const fps = 30;

      const video = req.files?.video?.[0];
      if (!video) return res.status(400).json({ ok: false, error: 'Video wajib diupload' });

      // Buat stream + broadcast
      const { broadcastId, rtmpUrl } = await createStreamAndBroadcast({
        tokens: req.session.tokens,
        title, description, privacyStatus, categoryId
      });
      currentBroadcastId = broadcastId;

      // Thumbnail manual / auto
      if (req.files?.thumbnail?.[0]) {
        await setThumbnail(req.session.tokens, broadcastId, req.files.thumbnail[0].path);
      } else {
        const thumbPath = path.join('uploads', `thumb-${Date.now()}.jpg`);
        await generateThumbnail(video.path, thumbPath);
        await setThumbnail(req.session.tokens, broadcastId, thumbPath);
      }

      // Start FFmpeg
      streamer.start({
        inputPath: video.path,
        rtmpUrl,
        vbit: vbitrate,
        abit: abitrate,
        fps,
        loop: loop !== 'no',
        maxRetry
      });

      // Setelah FFmpeg jalan → tunggu broadcast ready lalu LIVE
      streamer.once('start', async () => {
        try {
          const { yt } = await import('../services/youtube.js');
          const youtube = yt(req.session.tokens);

          ioRef?.emit('ffmpeg:status', { type: 'info', msg: '⏳ Menunggu broadcast ready…' });

          const ready = await waitUntilReady(youtube, broadcastId);

          if (ready) {
            await goLiveNow(req.session.tokens, broadcastId);
            ioRef?.emit('ffmpeg:status', { type: 'accepted', msg: '✅ Broadcast sudah LIVE!' });
          } else {
            ioRef?.emit('ffmpeg:status', { type: 'error', msg: '❌ Broadcast tidak siap untuk LIVE' });
          }
        } catch (err) {
          ioRef?.emit('ffmpeg:status', { type: 'error', msg: '❌ Transition gagal: ' + err.message });
        }
      });

      res.json({ ok: true, broadcastId, rtmpUrl });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// === Stop Live ===
router.post('/stop', requireAuth, async (req, res) => {
  try {
    const stopped = streamer.stop();
    if (currentBroadcastId) {
      try {
        await endBroadcast(req.session.tokens, currentBroadcastId);
        ioRef?.emit('ffmpeg:status', { type: 'stopped', msg: '✅ Broadcast diakhiri' });
      } catch (err) {
        ioRef?.emit('ffmpeg:status', { type: 'error', msg: '⚠️ Gagal endBroadcast: ' + err.message });
      }
      currentBroadcastId = null;
    }

    // Hapus semua file upload
    const uploadDir = path.join(process.cwd(), 'uploads');
    rimraf.sync(uploadDir);
    fs.mkdirSync(uploadDir);

    res.json({ ok: true, stopped });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// === API Dashboard ===
router.get('/categories', requireAuth, async (req, res) => {
  try {
    const items = await listCategories(req.session.tokens);
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, items: [] });
  }
});

router.get('/list', requireAuth, async (req, res) => {
  try {
    const items = await listBroadcasts(req.session.tokens);
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, items: [] });
  }
});

export default router;
