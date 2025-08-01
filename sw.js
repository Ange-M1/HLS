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
    
    // Check if this is a request for HLS files (.m3u8, .ts, .m4s)
    if (url.pathname.includes('.m3u8') || url.pathname.includes('.ts') || url.pathname.includes('.m4s')) {
        console.log('Intercepting HLS request:', url.href);
        event.respondWith(handleHLSRequest(event.request));
    }
});

/**
 * Handles requests for HLS files (manifests and segments) by serving cached segments from IndexedDB or fetching from network
 * @param {Request} request - The fetch request
 * @returns {Promise<Response>} The response with HLS data
 */
async function handleHLSRequest(request) {
    try {
        const url = new URL(request.url);
        const requestUrl = url.href;
        
        // Check if this is a manifest request (.m3u8)
        if (url.pathname.includes('.m3u8')) {
            console.log('Handling manifest request:', requestUrl);
            // Always fetch manifests from network
            const response = await fetch(request);
            return response;
        }
        
        // Check if this is a segment request (.ts or .m4s)
        if (url.pathname.includes('.ts') || url.pathname.includes('.m4s')) {
            console.log('Looking for segment in IndexedDB:', requestUrl);
            
            // Check if we have a mapping for this segment
            const segmentId = await getSegmentIdForUrl(requestUrl);
            
            if (segmentId) {
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
                }
            }
            
            // If not in cache, fetch from network
            console.log('Fetching segment from network:', requestUrl);
            const response = await fetch(request);
            return response;
        }
        
        // For any other HLS-related files, fetch from network
        console.log('Fetching from network:', requestUrl);
        const response = await fetch(request);
        return response;
        
    } catch (error) {
        console.error('Error handling HLS request:', error);
        // Fallback to network request
        try {
            return await fetch(request);
        } catch (fetchError) {
            console.error('Network fetch also failed:', fetchError);
            return new Response('HLS file not available', {
                status: 404,
                statusText: 'Not Found'
            });
        }
    }
}

/**
 * Gets the segment ID for a given URL by checking the mapping
 * @param {string} segmentUrl - The segment URL
 * @returns {Promise<string|null>} A promise that resolves with the segment ID or null if not found
 */
async function getSegmentIdForUrl(segmentUrl) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('HLSVideoCacheDB', 1);
        
        request.onerror = () => {
            console.error('Failed to open IndexedDB in service worker');
            resolve(null);
        };
        
        request.onsuccess = (event) => {
            const db = event.target.result;
            const transaction = db.transaction(['segmentMapping'], 'readonly');
            const store = transaction.objectStore('segmentMapping');
            const getRequest = store.get(segmentUrl);
            
            getRequest.onsuccess = () => {
                if (getRequest.result) {
                    console.log('Found segment mapping:', segmentUrl, '->', getRequest.result.segmentId);
                    resolve(getRequest.result.segmentId);
                } else {
                    console.log('No segment mapping found for:', segmentUrl);
                    resolve(null);
                }
            };
            
            getRequest.onerror = () => {
                console.error('Error retrieving segment mapping:', segmentUrl);
                resolve(null);
            };
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('videoSegments')) {
                db.createObjectStore('videoSegments', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('segmentMapping')) {
                db.createObjectStore('segmentMapping', { keyPath: 'url' });
            }
        };
    });
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
            if (!db.objectStoreNames.contains('segmentMapping')) {
                db.createObjectStore('segmentMapping', { keyPath: 'url' });
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