import { google } from 'googleapis';
import fs from 'fs';

const yt = (tokens) => {
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth.setCredentials(tokens);
  return google.youtube({ version: 'v3', auth: oauth });
};

export async function createStreamAndBroadcast({ tokens, title, description, privacyStatus='unlisted', categoryId='22' }) {
  const youtube = yt(tokens);

  const s = await youtube.liveStreams.insert({
    part: ['snippet,cdn,status'],
    requestBody: {
      snippet: { title: `AutoStream-${Date.now()}` },
      cdn: { ingestionType: 'rtmp', resolution: '720p', frameRate: '30fps' },
      status: { streamStatus: 'active' }
    }
  });
  const ing = s.data.cdn?.ingestionInfo;
  const rtmpUrl = `${ing?.ingestionAddress}/${ing?.streamName}`;

  const startISO = new Date(Date.now() + 60 * 1000).toISOString();
  const b = await youtube.liveBroadcasts.insert({
    part: ['snippet,contentDetails,status'],
    requestBody: {
      snippet: { title, description, scheduledStartTime: startISO, categoryId },
      contentDetails: { enableAutoStart: true, enableAutoStop: true },
      status: { privacyStatus }
    }
  });

  await youtube.liveBroadcasts.bind({
    part: ['id,contentDetails'], id: b.data.id, streamId: s.data.id
  });

  return { broadcastId: b.data.id, rtmpUrl };
}

export async function setThumbnail(tokens, videoOrBroadcastId, filePath) {
  const youtube = yt(tokens);
  const stream = fs.createReadStream(filePath);
  const res = await youtube.thumbnails.set({ videoId: videoOrBroadcastId, media: { body: stream } });
  return res.data;
}
