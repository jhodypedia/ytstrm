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

export const attachIO = (io) => {
  ioRef = io;
  streamer.on('start', () => ioRef.emit('ffmpeg:status', { msg: '🚀 FFmpeg started' }));
  streamer.on('log', (l) => ioRef.emit('ffmpeg:log', l));
  streamer.on('stop', () => ioRef.emit('ffmpeg:status', { msg: '🛑 FFmpeg stopped' }));
};

// Poll status broadcast
async function waitUntilReady(youtube, broadcastId, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await youtube.liveBroadcasts.list({
      part: 'id,status',
      id: broadcastId
    });
    const item = data.items?.[0];
    if (item?.status?.lifeCycleStatus === 'ready') return true;
    await new Promise(r => setTimeout(r, 5000));
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
  upload.fields([{ name: 'video' }, { name: 'thumbnail' }]),
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
      if (!video) return res.status(400).json({ ok: false, error: 'Video wajib diupload' });

      // Create broadcast
      const { broadcastId, rtmpUrl } = await createStreamAndBroadcast({
        tokens: req.session.tokens,
        title,
        description,
        privacyStatus,
        categoryId
      });
      currentBroadcastId = broadcastId;
      ioRef?.emit('ffmpeg:status', { msg: '📡 Broadcast dibuat' });

      // Thumbnail
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

      // Poll ready → go live
      streamer.once('start', async () => {
        const youtube = yt(req.session.tokens);
        const ready = await waitUntilReady(youtube, broadcastId);
        if (ready) {
          try {
            await goLiveNow(req.session.tokens, broadcastId);
            ioRef?.emit('ffmpeg:status', { msg: '✅ Transition → LIVE' });
          } catch (err) {
            ioRef?.emit('ffmpeg:status', { msg: '❌ Gagal LIVE: ' + err.message });
          }
        } else {
          ioRef?.emit('ffmpeg:status', { msg: '❌ Broadcast tidak siap untuk LIVE' });
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
        ioRef?.emit('ffmpeg:status', { msg: '🛑 Broadcast ended' });
      } catch (err) {
        ioRef?.emit('ffmpeg:status', { msg: '⚠️ endBroadcast gagal: ' + err.message });
      }
      currentBroadcastId = null;
    }

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
