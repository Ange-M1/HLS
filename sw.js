// Service Worker for HLS Video Player
// Handles local segment requests and serves them from IndexedDB cache

const CACHE_NAME = 'hls-video-cache-v1';

// Install event - set up the cache
self.addEventListener('install', (event) => {
    console.log('Service Worker installing...');
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('Service Worker activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch event - handle requests
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Check if this is a request for a local segment
    if (url.hostname === 'localhost' && url.pathname.includes('/playlist.m3u8/segment')) {
        console.log('Intercepting local segment request:', url.pathname);
        event.respondWith(handleLocalSegmentRequest(event.request));
    }
});

/**
 * Handles requests for local segments by serving them from IndexedDB
 * @param {Request} request - The fetch request
 * @returns {Promise<Response>} The response with segment data
 */
async function handleLocalSegmentRequest(request) {
    try {
        const url = new URL(request.url);
        const segmentId = url.pathname.split('/').pop().replace('.ts', '');
        
        console.log('Looking for segment in IndexedDB:', segmentId);
        
        // Get segment from IndexedDB
        const segmentData = await getSegmentFromIndexedDB(segmentId);
        
        if (segmentData) {
            console.log('Serving segment from IndexedDB:', segmentId);
            return new Response(segmentData, {
                status: 200,
                statusText: 'OK',
                headers: {
                    'Content-Type': 'video/mp2t',
                    'Content-Length': segmentData.byteLength.toString(),
                    'Cache-Control': 'public, max-age=31536000',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        } else {
            console.log('Segment not found in IndexedDB:', segmentId);
            return new Response('Segment not found', {
                status: 404,
                statusText: 'Not Found'
            });
        }
    } catch (error) {
        console.error('Error handling local segment request:', error);
        return new Response('Internal Server Error', {
            status: 500,
            statusText: 'Internal Server Error'
        });
    }
}

/**
 * Retrieves a segment from IndexedDB
 * @param {string} segmentId - The segment ID
 * @returns {Promise<ArrayBuffer|null>} The segment data or null if not found
 */
async function getSegmentFromIndexedDB(segmentId) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('HLSVideoCacheDB', 1);
        
        request.onerror = () => {
            console.error('Failed to open IndexedDB in service worker');
            resolve(null);
        };
        
        request.onsuccess = (event) => {
            const db = event.target.result;
            const transaction = db.transaction(['videoSegments'], 'readonly');
            const store = transaction.objectStore('videoSegments');
            const getRequest = store.get(segmentId);
            
            getRequest.onsuccess = () => {
                if (getRequest.result) {
                    console.log('Segment found in IndexedDB:', segmentId);
                    resolve(getRequest.result.data);
                } else {
                    console.log('Segment not found in IndexedDB:', segmentId);
                    resolve(null);
                }
            };
            
            getRequest.onerror = () => {
                console.error('Error retrieving segment from IndexedDB:', segmentId);
                resolve(null);
            };
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('videoSegments')) {
                db.createObjectStore('videoSegments', { keyPath: 'id' });
            }
        };
    });
}

// Handle messages from the main thread
self.addEventListener('message', (event) => {
    console.log('Service Worker received message:', event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});