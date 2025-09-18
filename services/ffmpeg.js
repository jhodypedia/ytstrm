import { spawn } from 'child_process';
import EventEmitter from 'events';
import fs from 'fs';

class FFStreamer extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.running = false;
    this.lastArgs = null;
    this.retry = 0;
    this.maxRetry = 3;
  }

  start({ inputPath, rtmpUrl, coverPath=null, vbit='4500k', abit='128k', fps=30, loop=true, maxRetry=3 }) {
    if (this.running) throw new Error('FFmpeg sudah berjalan');
    this.lastArgs = { inputPath, rtmpUrl, coverPath, vbit, abit, fps, loop };
    this.retry = 0;
    this.maxRetry = Number(maxRetry) || 3;
    this._spawn();
  }

  _spawn() {
    const { inputPath, rtmpUrl, coverPath, vbit, abit, fps, loop } = this.lastArgs;
    let args;

    if (coverPath) {
      // Cover 10 detik lalu loop video utama
      args = [
        '-stream_loop', '1', '-t', '10', '-re', '-i', coverPath,
        ...(loop ? ['-stream_loop', '-1'] : []), '-re', '-i', inputPath,
        '-filter_complex', '[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]',
        '-map', '[outv]', '-map', '[outa]',
        '-c:v', 'libx264', '-preset', 'veryfast',
        '-b:v', vbit, '-maxrate', vbit, '-bufsize', '8M',
        '-pix_fmt', 'yuv420p', '-r', `${fps}`, '-g', `${fps*2}`,
        '-c:a', 'aac', '-b:a', abit, '-ar', '44100',
        '-f', 'flv', rtmpUrl
      ];
    } else {
      args = [
        ...(loop ? ['-stream_loop', '-1'] : []),
        '-re', '-i', inputPath,
        '-c:v', 'libx264', '-preset', 'veryfast',
        '-b:v', vbit, '-maxrate', vbit, '-bufsize', '8M',
        '-pix_fmt', 'yuv420p', '-r', `${fps}`, '-g', `${fps*2}`,
        '-c:a', 'aac', '-b:a', abit, '-ar', '44100',
        '-f', 'flv', rtmpUrl
      ];
    }

    this.proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.running = true;
    this.emit('start', { pid: this.proc.pid, args });

    this.proc.stderr.on('data', (d) => this.emit('log', { line: d.toString() }));

    this.proc.on('close', (code) => {
      this.running = false;
      this.proc = null;
      this.emit('stop', { code });

      if (this.retry < this.maxRetry) {
        this.retry++;
        this.emit('log', { line: `⚠️ Restart attempt ${this.retry}/${this.maxRetry}\n` });
        setTimeout(() => this._spawn(), 3000);
      } else {
        this.emit('log', { line: '❌ FFmpeg gagal setelah beberapa percobaan.\n' });
      }
    });
  }

  stop() {
    if (!this.running) return false;
    this.proc.kill('SIGINT');
    this.running = false;
    this.proc = null;
    return true;
  }

  status() {
    return { running: this.running, retry: this.retry, maxRetry: this.maxRetry };
  }
}

export const streamer = new FFStreamer();

export async function generateThumbnail(videoPath, outPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-ss', '00:00:02', '-i', videoPath, '-frames:v', '1', outPath]);
    ff.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath)) resolve(outPath);
      else reject(new Error('Gagal generate thumbnail'));
    });
  });
}
