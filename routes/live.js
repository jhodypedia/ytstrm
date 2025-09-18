import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { rimraf } from 'rimraf';

import { requireAuth } from '../middleware/auth.js';
import {
  yt,
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

// === Attach IO untuk logs realtime ===
export const attachIO = (io) => {
  ioRef = io;
  streamer.on('start', (p) => ioRef.emit('ffmpeg:start', p));
  streamer.on('log', (l) => ioRef.emit('ffmpeg:log', l));
  streamer.on('status', (s) => ioRef.emit('ffmpeg:status', s));
  streamer.on('stop', (s) => ioRef.emit('ffmpeg:stop', s));
};

// === Helper: tunggu sampai broadcast ready ===
async function waitUntilReady(youtube, broadcastId, maxAttempts = 6) {
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
    await new Promise((r) => setTimeout(r, 5000)); // tunggu 5 detik
  }
  return false;
}

// === DASHBOARD ===
router.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard', { title: 'Dashboard' });
});

// === START LIVE ===
router.post(
  '/start',
  requireAuth,
  upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
    { name: 'cover', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const {
        title,
        description,
        privacyStatus = 'public',
        categoryId = '22',
        loop = 'yes',
        maxRetry = '3'
      } = req.body;

      const vbitrate = '4500k';
      const abitrate = '128k';
      const fps = 30;

      const video = req.files?.video?.[0];
      if (!video) {
        return res.status(400).json({ ok: false, error: 'Video wajib diupload' });
      }

      const { broadcastId, rtmpUrl } = await createStreamAndBroadcast({
        tokens: req.session.tokens,
        title,
        description,
        privacyStatus,
        categoryId
      });
      currentBroadcastId = broadcastId;

      // === Thumbnail ===
      if (req.files?.thumbnail?.[0]) {
        await setThumbnail(req.session.tokens, broadcastId, req.files.thumbnail[0].path);
      } else {
        const thumbPath = path.join('uploads', `thumb-${Date.now()}.jpg`);
        await generateThumbnail(video.path, thumbPath);
        await setThumbnail(req.session.tokens, broadcastId, thumbPath);
      }

      // === Mulai FFmpeg ===
      streamer.start({
        inputPath: video.path,
        rtmpUrl,
        vbit: vbitrate,
        abit: abitrate,
        fps,
        loop: loop !== 'no',
        maxRetry
      });

      // === Transition ke LIVE ===
      const tryGoLive = async () => {
        const youtube = yt(req.session.tokens);

        ioRef?.emit('ffmpeg:status', {
          type: 'info',
          msg: '⏳ Menunggu broadcast ready...'
        });

        const ready = await waitUntilReady(youtube, broadcastId);

        if (!ready) {
          ioRef?.emit('ffmpeg:status', {
            type: 'error',
            msg: '❌ Broadcast tidak pernah siap untuk live'
          });
          return;
        }

        try {
          await goLiveNow(req.session.tokens, broadcastId);
          ioRef?.emit('ffmpeg:status', {
            type: 'accepted',
            msg: '✅ Transition → LIVE berhasil!'
          });
        } catch (err) {
          ioRef?.emit('ffmpeg:status', {
            type: 'error',
            msg: '❌ Transition gagal: ' + err.message
          });
        }
      };

      // Tunggu encoding dulu baru coba live
      streamer.once('status', (s) => {
        if (s.type === 'encoding') {
          setTimeout(() => tryGoLive(), 10000); // delay 10 detik
        }
      });

      res.json({ ok: true, broadcastId, rtmpUrl });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// === STOP LIVE ===
router.post('/stop', requireAuth, async (req, res) => {
  try {
    const stopped = streamer.stop();
    if (currentBroadcastId) {
      try {
        await endBroadcast(req.session.tokens, currentBroadcastId);
        ioRef?.emit('ffmpeg:log', { line: '✅ Broadcast diakhiri (complete)\n' });
      } catch (err) {
        ioRef?.emit('ffmpeg:log', { line: '⚠️ Gagal endBroadcast: ' + err.message + '\n' });
      }
      currentBroadcastId = null;
    }

    // cleanup uploads
    const uploadDir = path.join(process.cwd(), 'uploads');
    rimraf.sync(uploadDir);
    fs.mkdirSync(uploadDir);
    ioRef?.emit('ffmpeg:log', { line: '🧹 Uploads dibersihkan\n' });

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
