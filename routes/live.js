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
import { google } from 'googleapis';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

let ioRef = null;
let currentBroadcastId = null;

// === Attach Socket.IO for realtime logs ===
export const attachIO = (io) => {
  ioRef = io;
  streamer.on('start', (p) => ioRef.emit('ffmpeg:start', p));
  streamer.on('log', (l) => ioRef.emit('ffmpeg:log', l));
  streamer.on('status', (s) => ioRef.emit('ffmpeg:status', s));
  streamer.on('stop', (s) => ioRef.emit('ffmpeg:stop', s));
};

// Helper buat polling lifecycle status YouTube
async function waitUntilReady(tokens, broadcastId, maxAttempts = 8) {
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth.setCredentials(tokens);
  const youtube = google.youtube({ version: 'v3', auth: oauth });

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const { data } = await youtube.liveBroadcasts.list({
        part: 'id,status',
        id: broadcastId
      });
      const life = data.items?.[0]?.status?.lifeCycleStatus;
      if (life === 'ready') return true;
      ioRef?.emit('ffmpeg:status', { type: 'encoding', msg: `⏳ Broadcast masih ${life}, cek ulang...` });
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
        privacyStatus = 'unlisted',
        categoryId = '22',
        loop = 'yes',
        maxRetry = '3'
      } = req.body;

      const vbitrate = '4500k';
      const abitrate = '128k';
      const fps = 30;

      const video = req.files?.video?.[0];
      if (!video) return res.status(400).json({ ok: false, error: 'Video wajib diupload' });

      // Buat broadcast + stream
      const { broadcastId, rtmpUrl } = await createStreamAndBroadcast({
        tokens: req.session.tokens,
        title,
        description,
        privacyStatus,
        categoryId
      });
      currentBroadcastId = broadcastId;

      // Thumbnail
      if (req.files?.thumbnail?.[0]) {
        await setThumbnail(req.session.tokens, broadcastId, req.files.thumbnail[0].path);
      } else {
        const thumbPath = path.join('uploads', `thumb-${Date.now()}.jpg`);
        await generateThumbnail(video.path, thumbPath);
        await setThumbnail(req.session.tokens, broadcastId, thumbPath);
      }

      // Mulai FFmpeg push
      streamer.start({
        inputPath: video.path,
        rtmpUrl,
        vbit: vbitrate,
        abit: abitrate,
        fps,
        loop: loop !== 'no',
        maxRetry
      });

      // Begitu FFmpeg jalan → tunggu broadcast ready → goLive
      streamer.once('start', async () => {
        try {
          ioRef?.emit('ffmpeg:status', { type: 'encoding', msg: '🚀 FFmpeg mulai stream, cek status YouTube...' });

          const ready = await waitUntilReady(req.session.tokens, broadcastId);
          if (!ready) {
            ioRef?.emit('ffmpeg:status', { type: 'error', msg: '❌ Broadcast tidak pernah READY' });
            return;
          }

          await goLiveNow(req.session.tokens, broadcastId);
          ioRef?.emit('ffmpeg:status', { type: 'accepted', msg: '✅ Broadcast LIVE di YouTube!' });
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
    // Cleanup
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
