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

export const attachIO = (io) => {
  ioRef = io;
  streamer.on('start', (p) => ioRef.emit('ffmpeg:start', p));
  streamer.on('log', (l) => ioRef.emit('ffmpeg:log', l));
  streamer.on('status', (s) => ioRef.emit('ffmpeg:status', s));
  streamer.on('stop', (s) => ioRef.emit('ffmpeg:stop', s));
};

// Dashboard
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
        title, description, privacyStatus='unlisted', categoryId='22',
        vbitrate='4500k', abitrate='128k', fps=30, loop='yes', maxRetry='3'
      } = req.body;

      const video = req.files?.video?.[0];
      if (!video) return res.status(400).json({ ok: false, error: 'Video wajib diupload' });

      const cover = req.files?.cover?.[0];
      let coverPath = cover ? cover.path : null;

      // Buat broadcast + stream langsung
      const { broadcastId, rtmpUrl } = await createStreamAndBroadcast({
        tokens: req.session.tokens,
        title, description, privacyStatus, categoryId
      });
      currentBroadcastId = broadcastId;

      // Thumbnail manual/auto
      if (req.files?.thumbnail?.[0]) {
        await setThumbnail(req.session.tokens, broadcastId, req.files.thumbnail[0].path);
      } else {
        const thumbPath = path.join('uploads', `thumb-${Date.now()}.jpg`);
        await generateThumbnail(video.path, thumbPath);
        await setThumbnail(req.session.tokens, broadcastId, thumbPath);
      }

      // Mulai FFmpeg
      streamer.start({
        inputPath: video.path,
        rtmpUrl,
        coverPath,
        vbit: vbitrate,
        abit: abitrate,
        fps,
        loop: loop !== 'no',
        maxRetry
      });

      // Paksa langsung LIVE begitu FFmpeg jalan
      streamer.once('start', async () => {
        try {
          await goLiveNow(req.session.tokens, broadcastId);
          ioRef?.emit('ffmpeg:log', { line: '✅ Broadcast langsung LIVE\n' });
        } catch (err) {
          ioRef?.emit('ffmpeg:log', { line: '❌ Transition gagal: ' + err.message + '\n' });
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
    const ok = streamer.stop();
    if (currentBroadcastId) {
      await endBroadcast(req.session.tokens, currentBroadcastId);
      ioRef?.emit('ffmpeg:log', { line: '✅ Broadcast diakhiri (complete)\n' });
      currentBroadcastId = null;
    }
    res.json({ ok: true, stopped: ok });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Cleanup uploads
router.post('/cleanup', requireAuth, (req, res) => {
  rimraf.sync(path.join(process.cwd(), 'uploads'));
  fs.mkdirSync('uploads');
  res.json({ ok: true, msg: 'uploads cleared' });
});

// === API dashboard ===
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
