const manifestUrl = 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8';

const dbPromise = idb.openDB('VideoCacheDB', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('segments')) {
      db.createObjectStore('segments');
    }
  }
});

async function fetchManifest(url) {
  console.log('Fetching manifest...');
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Manifest fetch failed: ${resp.status}`);
  return resp.text();
}

function extractSegmentUrls(manifestText, baseUrl) {
  // Parse manifest and get .ts segment URLs (relative or absolute)
  const lines = manifestText.split('\n');
  const tsUrls = [];
  for (const line of lines) {
    if (line.trim().endsWith('.ts')) {
      // If relative URL, resolve it against baseUrl
      const url = new URL(line.trim(), baseUrl).href;
      tsUrls.push(url);
    }
  }
  return tsUrls;
}

async function cacheSegments(urls) {
  const db = await dbPromise;
  for (const url of urls) {
    const cached = await db.get('segments', url);
    if (cached) {
      console.log(`Segment already cached: ${url}`);
      continue;
    }
    console.log(`Fetching and caching: ${url}`);
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`Failed to fetch segment: ${url}`);
      continue;
    }
    const data = await resp.arrayBuffer();
    await db.put('segments', data, url);
    console.log(`Cached: ${url}`);
  }
}

async function preloadSegments() {
  try {
    const manifestText = await fetchManifest(manifestUrl);
    const tsUrls = extractSegmentUrls(manifestText, manifestUrl);
    console.log(`Found ${tsUrls.length} TS files.`);
    await cacheSegments(tsUrls.slice(0, 5)); // cache first 5 segments only for demo
    console.log('✅ Preloading complete');
  } catch (err) {
    console.error('❌ Error in preloadSegments:', err);
  }
}

document.getElementById('preloadBtn').onclick = preloadSegments;
