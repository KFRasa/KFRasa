import { writeFile } from "node:fs/promises";

const HANDLE = "@KFRasa";
const API_KEY = process.env.YOUTUBE_API_KEY;

if (!API_KEY) {
  console.error("Missing YOUTUBE_API_KEY environment variable.");
  process.exit(1);
}

async function ytApi(endpoint, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [k, v] of Object.entries({ ...params, key: API_KEY })) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    const reason = data?.error?.errors?.[0]?.reason || res.statusText;
    const err = new Error(`YouTube API error (${res.status}): ${reason}`);
    err.status = res.status;
    err.reason = reason;
    throw err;
  }
  return data;
}

async function getChannelId(handle) {
  const data = await ytApi("channels", {
    part: "id",
    forHandle: handle
  });
  const id = data.items?.[0]?.id;
  if (!id) throw new Error(`Channel not found for handle: ${handle}`);
  return id;
}

async function getAllPlaylistVideoIds(playlistId) {
  const ids = [];
  let pageToken;

  do {
    try {
      const data = await ytApi("playlistItems", {
        part: "contentDetails",
        playlistId,
        maxResults: "50",
        pageToken
      });

      for (const item of data.items || []) {
        if (item.contentDetails?.videoId) {
          ids.push(item.contentDetails.videoId);
        }
      }
      pageToken = data.nextPageToken;
    } catch (err) {
      // 404 happens if the channel has 0 regular videos or 0 shorts
      if (err.status === 404) return [];
      throw err;
    }
  } while (pageToken);

  return ids;
}

async function getVideoDetails(ids) {
  const results = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const data = await ytApi("videos", {
      part: "snippet,statistics",
      id: chunk.join(",")
    });

    for (const v of data.items || []) {
      results.push({
        id: v.id,
        title: v.snippet?.title || "",
        publishedAt: v.snippet?.publishedAt || "",
        views: Number(v.statistics?.viewCount || 0)
      });
    }
  }
  return results;
}

function pickThree(items, firstLabel) {
  if (!items.length) return [];

  const byDateDesc = [...items].sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );
  const byViewsDesc = [...items].sort((a, b) => b.views - a.views);

  const recent = byDateDesc[0];
  const popular = byViewsDesc[0];
  const first = byDateDesc[byDateDesc.length - 1];

  return [
    { label: "most recent", id: recent.id, title: recent.title, views: recent.views },
    { label: "most popular", id: popular.id, title: popular.title, views: popular.views },
    { label: firstLabel, id: first.id, title: first.title, views: first.views }
  ];
}

async function main() {
  const channelId = await getChannelId(HANDLE);
  // UULF = public regular videos, UUSH = public shorts
  const suffix = channelId.slice(2);
  const [videoIds, shortIds] = await Promise.all([
    getAllPlaylistVideoIds(`UULF${suffix}`),
    getAllPlaylistVideoIds(`UUSH${suffix}`)
  ]);

  const [videos, shorts] = await Promise.all([
    getVideoDetails(videoIds),
    getVideoDetails(shortIds)
  ]);

  const output = {
    updatedAt: new Date().toISOString(),
    videos: pickThree(videos, "first video"),
    shorts: pickThree(shorts, "first short")
  };

  await writeFile("data.json", JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`Updated data.json (${videos.length} videos, ${shorts.length} shorts)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});