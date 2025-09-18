import express from 'express';
import { google } from 'googleapis';

const router = express.Router();

const getOAuth = () => new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.force-ssl'
];

router.get('/login', (req, res) => {
  res.render('login', { title: 'Login' });
});

router.get('/google', (req, res) => {
  const o = getOAuth();
  const url = o.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });
  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  try {
    const o = getOAuth();
    const { tokens } = await o.getToken(req.query.code);
    req.session.tokens = tokens;
    res.redirect('/live/dashboard');
  } catch (e) {
    console.error(e);
    res.status(500).send('Auth error: ' + e.message);
  }
});

router.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/auth/login');
});

export default router;
