import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import cookieSession from 'cookie-session';
import helmet from 'helmet';
import expressLayouts from 'express-ejs-layouts';
import http from 'http';
import { Server } from 'socket.io';

import authRouter from './routes/auth.js';
import liveRouter, { attachIO } from './routes/live.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
attachIO(io);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'devkey'],
  maxAge: 24 * 60 * 60 * 1000
}));

// Views
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Static
app.use('/public', express.static(path.join(process.cwd(), 'public')));

// Routes
app.use('/auth', authRouter);
app.use('/live', liveRouter);

app.get('/', (req, res) => {
  if (!req.session?.tokens) return res.redirect('/auth/login');
  res.redirect('/live/dashboard');
});

// 404
app.use((req, res) => res.status(404).send('Not Found'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running → http://localhost:' + PORT));
