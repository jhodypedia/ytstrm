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

// === Multer Storage dengan ekstensi asli ===
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, Date.now() + '-' + file.fieldname + ext);
  }
});
const upload = multer({ storage });

let ioRef = null;
let currentBroadcastId = null;

// attach IO for logs
export const attachIO = (io) => {
  ioRef = io;
  streamer.on('start', (p) => ioRef.emit('ffmpeg:start', p));
  streamer.on('log', (l) => ioRef.emit('ffmpeg:log', l));
  streamer.on('status', (s) => ioRef.emit('ffmpeg:status', s));
  streamer.on('stop', (s) => ioRef.emit('ffmpeg:stop', s));
};

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
        title, description,
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

      const { broadcastId, rtmpUrl } = await createStreamAndBroadcast({
        tokens: req.session.tokens,
        title, description, privacyStatus, categoryId
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

      // Paksa langsung LIVE setelah encoding jalan
      streamer.once('status', async (s) => {
        if (s.type === 'encoding') {
          try {
            await goLiveNow(req.session.tokens, broadcastId);
            ioRef?.emit('ffmpeg:status', { type: 'accepted', msg: '✅ Broadcast langsung LIVE!' });
          } catch (err) {
            ioRef?.emit('ffmpeg:status', { type: 'error', msg: '❌ Transition gagal: ' + err.message });
          }
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
    // Stop ffmpeg
    const stopped = streamer.stop();

    // Hentikan broadcast di YouTube
    if (currentBroadcastId) {
      try {
        await endBroadcast(req.session.tokens, currentBroadcastId);
        ioRef?.emit('ffmpeg:log', { line: '✅ Broadcast diakhiri (complete)\n' });
      } catch (err) {
        ioRef?.emit('ffmpeg:log', { line: '⚠️ Gagal endBroadcast: ' + err.message + '\n' });
      }
      currentBroadcastId = null;
    }

    // Hapus semua file di uploads/
    const uploadDir = path.join(process.cwd(), 'uploads');
    rimraf.sync(uploadDir);
    fs.mkdirSync(uploadDir);
    ioRef?.emit('ffmpeg:log', { line: '🧹 Semua file uploads dihapus\n' });

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
