import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import rimraf from 'rimraf';

import { requireAuth } from '../middleware/auth.js';
import { createStreamAndBroadcast, setThumbnail } from '../services/youtube.js';
import { streamer, generateThumbnail } from '../services/ffmpeg.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

let ioRef = null;
export const attachIO = (io) => {
  ioRef = io;
  streamer.on('start', (p) => ioRef.emit('ffmpeg:start', p));
  streamer.on('log', (l) => ioRef.emit('ffmpeg:log', l));
  streamer.on('stop', (s) => ioRef.emit('ffmpeg:stop', s));
};

router.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard', { title: 'Dashboard' });
});

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
      const { title, description, privacyStatus='unlisted', categoryId='22', vbitrate='4500k', abitrate='128k', loop='yes' } = req.body;
      const video = req.files?.video?.[0];
      if (!video) return res.status(400).json({ ok: false, error: 'Video wajib diupload' });

      const cover = req.files?.cover?.[0];
      let coverPath = cover ? cover.path : null;

      const { broadcastId, rtmpUrl } = await createStreamAndBroadcast({
        tokens: req.session.tokens,
        title, description, privacyStatus, categoryId
      });

      if (req.files?.thumbnail?.[0]) {
        await setThumbnail(req.session.tokens, broadcastId, req.files.thumbnail[0].path);
      } else {
        const thumbPath = path.join('uploads', `thumb-${Date.now()}.jpg`);
        await generateThumbnail(video.path, thumbPath);
        await setThumbnail(req.session.tokens, broadcastId, thumbPath);
      }

      streamer.start({
        inputPath: video.path,
        rtmpUrl,
        coverPath,
        vbit: vbitrate,
        abit: abitrate,
        fps: 30,
        loop: loop !== 'no'
      });

      res.json({ ok: true, broadcastId, rtmpUrl });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

router.post('/stop', requireAuth, (req, res) => {
  const ok = streamer.stop();
  res.json({ ok: true, stopped: ok });
});

router.get('/status', requireAuth, (req, res) => {
  res.json({ ok: true, status: streamer.status() });
});

router.post('/cleanup', requireAuth, (req, res) => {
  rimraf.sync(path.join(process.cwd(), 'uploads'));
  fs.mkdirSync('uploads');
  res.json({ ok: true, msg: 'uploads cleared' });
});

export default router;
