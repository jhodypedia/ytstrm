import { google } from 'googleapis';
import fs from 'fs';

export const yt = (tokens) => {
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth.setCredentials(tokens);
  return google.youtube({ version: 'v3', auth: oauth });
};

// === Buat stream + broadcast langsung LIVE ===
export async function createStreamAndBroadcast({ tokens, title, description, privacyStatus='unlisted', categoryId='22' }) {
  const youtube = yt(tokens);

  // Stream RTMP
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

  // Broadcast langsung (NOW)
  const b = await youtube.liveBroadcasts.insert({
    part: ['snippet,contentDetails,status'],
    requestBody: {
      snippet: {
        title,
        description,
        scheduledStartTime: new Date().toISOString(), // langsung sekarang
        categoryId
      },
      contentDetails: { enableAutoStart: true, enableAutoStop: true },
      status: { privacyStatus }
    }
  });

  // Bind stream → broadcast
  await youtube.liveBroadcasts.bind({
    part: ['id,contentDetails'],
    id: b.data.id,
    streamId: s.data.id
  });

  return { broadcastId: b.data.id, rtmpUrl };
}

// Paksa LIVE
export async function goLiveNow(tokens, broadcastId) {
  const youtube = yt(tokens);
  return await youtube.liveBroadcasts.transition({
    broadcastStatus: 'live',
    id: broadcastId,
    part: 'id,status'
  });
}

// Akhiri broadcast
export async function endBroadcast(tokens, broadcastId) {
  const youtube = yt(tokens);
  return await youtube.liveBroadcasts.transition({
    broadcastStatus: 'complete',
    id: broadcastId,
    part: 'id,status'
  });
}

// Thumbnail (pakai videoId = broadcastId)
export async function setThumbnail(tokens, broadcastId, filePath) {
  const youtube = yt(tokens);
  const stream = fs.createReadStream(filePath);
  return await youtube.thumbnails.set({ videoId: broadcastId, media: { body: stream } });
}

// List kategori (region Indonesia, bisa diubah)
export async function listCategories(tokens) {
  const youtube = yt(tokens);
  const { data } = await youtube.videoCategories.list({
    part: 'id,snippet',
    regionCode: 'ID'
  });
  return data.items || [];
}

// List broadcast user
export async function listBroadcasts(tokens) {
  const youtube = yt(tokens);
  const { data } = await youtube.liveBroadcasts.list({
    part: 'id,snippet,status',
    mine: true,
    maxResults: 25
  });
  return data.items || [];
}
