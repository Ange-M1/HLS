// HLS Video Stream Configuration
const HLS_STREAMS = [
    { 
        id: 'stream1', 
        title: 'Sample HLS Stream 1', 
        src: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8' 
    },
    { 
        id: 'stream2', 
        title: 'Apple HLS Demo', 
        src: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8' 
    },
    { 
        id: 'stream3', 
        title: 'Big Buck Bunny HLS', 
        src: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' 
    }
];

// Configuration
const CACHE_SEGMENT_COUNT = 3; // Number of segments to cache offline
const SEGMENT_BUFFER_CHECK_INTERVAL = 1000; // Check every second

// Global state variables
let currentStreamIndex = 0;
let isOnline = navigator.onLine;
let db; // IndexedDB instance
let hls; // HLS.js instance
let cachedSegments = new Map(); // Track cached segments for current stream
let segmentUrls = []; // Current stream's segment URLs
let isPlayingFromCache = false;
let currentSegmentIndex = 0;
let totalCachedDuration = 0;
let connectionCheckInterval;
let bufferCheckInterval;
let pendingTransition = false;

// DOM Elements
const networkStatusElem = document.getElementById('networkStatus');
const networkMessageElem = document.getElementById('networkMessage');
const videoTitleElem = document.getElementById('videoTitle');
const videoElement = document.getElementById('videoElement');
const videoLoadingOverlay = document.getElementById('videoLoadingOverlay');
const connectionOverlay = document.getElementById('connectionOverlay');
const connectionStatus = document.getElementById('connectionStatus');
const videoMessageElem = document.getElementById('videoMessage');
const noVideoSourceElem = document.getElementById('noVideoSource');
const cachedVideosListElem = document.getElementById('cachedVideosList');
const segmentProgress = document.getElementById('segmentProgress');
const cacheInfo = document.getElementById('cacheInfo');
const prevButton = document.getElementById('prevButton');
const nextButton = document.getElementById('nextButton');
const clearCacheButton = document.getElementById('clearCacheButton');

// --- IndexedDB Functions ---

/**
 * Opens the IndexedDB database for HLS segments.
 */
function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('HLSCacheDB', 1);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Create stores for segments and manifests
            if (!db.objectStoreNames.contains('segments')) {
                db.createObjectStore('segments', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('manifests')) {
                db.createObjectStore('manifests', { keyPath: 'id' });
            }
            
            console.log('IndexedDB stores created/upgraded.');
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('IndexedDB opened successfully.');
            resolve(db);
        };

        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.errorCode);
            reject('Error opening IndexedDB');
        };
    });
}

/**
 * Stores a segment in IndexedDB.
 */
function storeSegment(streamId, segmentIndex, data) {
    return new Promise((resolve, reject) => {
        if (!db) return reject('IndexedDB not initialized.');
        
        const transaction = db.transaction(['segments'], 'readwrite');
        const store = transaction.objectStore('segments');
        const id = `${streamId}_segment_${segmentIndex}`;
        
        const request = store.put({ 
            id: id, 
            streamId: streamId,
            segmentIndex: segmentIndex,
            data: data,
            timestamp: Date.now()
        });

        request.onsuccess = () => {
            console.log(`Segment ${segmentIndex} for stream ${streamId} stored.`);
            resolve();
        };

        request.onerror = (event) => {
            console.error(`Error storing segment:`, event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Retrieves a segment from IndexedDB.
 */
function getSegment(streamId, segmentIndex) {
    return new Promise((resolve, reject) => {
        if (!db) return resolve(null);
        
        const transaction = db.transaction(['segments'], 'readonly');
        const store = transaction.objectStore('segments');
        const id = `${streamId}_segment_${segmentIndex}`;
        const request = store.get(id);

        request.onsuccess = () => {
            if (request.result) {
                resolve(request.result.data);
            } else {
                resolve(null);
            }
        };

        request.onerror = (event) => {
            console.error(`Error retrieving segment:`, event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Get all cached segments for a stream.
 */
function getCachedSegmentsForStream(streamId) {
    return new Promise((resolve, reject) => {
        if (!db) return resolve([]);
        
        const transaction = db.transaction(['segments'], 'readonly');
        const store = transaction.objectStore('segments');
        const request = store.getAll();

        request.onsuccess = () => {
            const allSegments = request.result || [];
            const streamSegments = allSegments
                .filter(segment => segment.streamId === streamId)
                .sort((a, b) => a.segmentIndex - b.segmentIndex);
            resolve(streamSegments);
        };

        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

/**
 * Clear all cached data.
 */
function clearAllCache() {
    return new Promise((resolve, reject) => {
        if (!db) return reject('IndexedDB not initialized.');
        
        const transaction = db.transaction(['segments', 'manifests'], 'readwrite');
        const segmentStore = transaction.objectStore('segments');
        const manifestStore = transaction.objectStore('manifests');
        
        const clearSegments = segmentStore.clear();
        const clearManifests = manifestStore.clear();
        
        Promise.all([
            new Promise(res => { clearSegments.onsuccess = () => res(); }),
            new Promise(res => { clearManifests.onsuccess = () => res(); })
        ]).then(() => {
            console.log('All cache cleared.');
            resolve();
        }).catch(reject);
    });
}

// --- HLS Processing Functions ---

/**
 * Fetches and parses HLS manifest to extract segment URLs.
 */
async function parseHLSManifest(manifestUrl) {
    try {
        const response = await fetch(manifestUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const manifestText = await response.text();
        const lines = manifestText.split('\n');
        const segments = [];
        
        let segmentDuration = 0;
        const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1);
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (line.startsWith('#EXTINF:')) {
                // Extract duration
                const durationMatch = line.match(/#EXTINF:([\d.]+)/);
                if (durationMatch) {
                    segmentDuration = parseFloat(durationMatch[1]);
                }
            } else if (line && !line.startsWith('#')) {
                // This is a segment URL
                const segmentUrl = line.startsWith('http') ? line : baseUrl + line;
                segments.push({
                    url: segmentUrl,
                    duration: segmentDuration
                });
            }
        }
        
        return segments;
    } catch (error) {
        console.error('Error parsing HLS manifest:', error);
        return [];
    }
}

/**
 * Downloads and caches the first N segments.
 */
async function cacheInitialSegments(streamId, segments) {
    const segmentsToCache = segments.slice(0, CACHE_SEGMENT_COUNT);
    cachedSegments.clear();
    totalCachedDuration = 0;
    
    for (let i = 0; i < segmentsToCache.length; i++) {
        const segment = segmentsToCache[i];
        
        try {
            // Check if already cached
            const cached = await getSegment(streamId, i);
            if (cached) {
                cachedSegments.set(i, segment.url);
                totalCachedDuration += segment.duration;
                console.log(`Segment ${i} already cached`);
                continue;
            }
            
            if (!isOnline) break; // Can't download if offline
            
            console.log(`Downloading segment ${i}...`);
            const response = await fetch(segment.url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.arrayBuffer();
            await storeSegment(streamId, i, data);
            cachedSegments.set(i, segment.url);
            totalCachedDuration += segment.duration;
            
            updateCacheInfo();
            
        } catch (error) {
            console.error(`Error caching segment ${i}:`, error);
            break;
        }
    }
    
    console.log(`Cached ${cachedSegments.size} segments (${totalCachedDuration.toFixed(1)}s)`);
    updateCachedVideosList();
}

// --- Video Player Functions ---

/**
 * Creates a Blob URL from cached segment data.
 */
async function createBlobFromCachedSegments(streamId) {
    const segments = [];
    
    for (let i = 0; i < CACHE_SEGMENT_COUNT; i++) {
        const data = await getSegment(streamId, i);
        if (data) {
            segments.push(data);
        } else {
            break;
        }
    }
    
    if (segments.length === 0) return null;
    
    // Combine all segment data
    const totalLength = segments.reduce((sum, data) => sum + data.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    
    for (const data of segments) {
        combined.set(new Uint8Array(data), offset);
        offset += data.byteLength;
    }
    
    return URL.createObjectURL(new Blob([combined], { type: 'video/mp2t' }));
}

/**
 * Initializes HLS.js player.
 */
function initializeHLS() {
    if (hls) {
        hls.destroy();
    }
    
    if (Hls.isSupported()) {
        hls = new Hls({
            debug: false,
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 90
        });
        
        hls.attachMedia(videoElement);
        
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
            console.log('HLS media attached');
        });
        
        hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
            console.log('HLS manifest parsed, levels:', data.levels.length);
        });
        
        hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('HLS error:', data);
            if (data.fatal) {
                handleHLSError(data);
            }
        });
        
        hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
            // Track loaded fragments
            updateSegmentProgress();
        });
        
    } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (Safari)
        console.log('Using native HLS support');
    } else {
        console.error('HLS not supported');
        videoMessageElem.textContent = 'HLS playback not supported in this browser.';
    }
}

/**
 * Handles HLS errors.
 */
function handleHLSError(data) {
    switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
            if (!isOnline) {
                showConnectionRequired();
            } else {
                console.log('Network error, attempting recovery...');
                hls.startLoad();
            }
            break;
        case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('Media error, attempting recovery...');
            hls.recoverMediaError();
            break;
        default:
            console.error('Fatal HLS error, destroying player');
            hls.destroy();
            break;
    }
}

/**
 * Loads and plays the current stream.
 */
async function loadCurrentStream() {
    const stream = HLS_STREAMS[currentStreamIndex];
    if (!stream) return;
    
    showLoading(true);
    videoTitleElem.textContent = stream.title;
    
    // Parse manifest to get segment information
    if (isOnline) {
        segmentUrls = await parseHLSManifest(stream.src);
        if (segmentUrls.length > 0) {
            await cacheInitialSegments(stream.id, segmentUrls);
        }
    }
    
    // Check if we have cached segments
    const cachedSegmentData = await getCachedSegmentsForStream(stream.id);
    const hasCachedSegments = cachedSegmentData.length > 0;
    
    if (hasCachedSegments && !isOnline) {
        // Play from cache only (offline)
        await playFromCache(stream.id);
    } else if (hasCachedSegments && isOnline) {
        // Start from cache then transition to live
        await playFromCacheWithTransition(stream);
    } else if (isOnline) {
        // Play live directly
        await playLiveStream(stream);
    } else {
        // No cache and offline
        showOfflineMessage();
    }
    
    showLoading(false);
}

/**
 * Plays video from cached segments only.
 */
async function playFromCache(streamId) {
    try {
        const blobUrl = await createBlobFromCachedSegments(streamId);
        if (blobUrl) {
            videoElement.src = blobUrl;
            isPlayingFromCache = true;
            videoMessageElem.textContent = `Playing from cache (${totalCachedDuration.toFixed(1)}s cached)`;
            
            // Set up monitoring for when cached content ends
            startBufferMonitoring();
            videoElement.play();
        } else {
            showOfflineMessage();
        }
    } catch (error) {
        console.error('Error playing from cache:', error);
        showOfflineMessage();
    }
}

/**
 * Plays from cache initially, then transitions to live stream.
 */
async function playFromCacheWithTransition(stream) {
    try {
        // Start with cached segments
        await playFromCache(stream.id);
        
        // Prepare live stream in background
        initializeHLS();
        if (hls) {
            hls.loadSource(stream.src);
        } else {
            // Native HLS support
            const liveVideo = document.createElement('video');
            liveVideo.src = stream.src;
        }
        
        // Monitor for transition point
        startTransitionMonitoring(stream);
        
    } catch (error) {
        console.error('Error in cache-to-live transition:', error);
        // Fallback to live stream
        await playLiveStream(stream);
    }
}

/**
 * Plays live HLS stream directly.
 */
async function playLiveStream(stream) {
    try {
        initializeHLS();
        
        if (hls) {
            hls.loadSource(stream.src);
            videoMessageElem.textContent = 'Streaming live...';
        } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
            videoElement.src = stream.src;
            videoMessageElem.textContent = 'Streaming live (native HLS)...';
        }
        
        isPlayingFromCache = false;
        videoElement.play();
        
    } catch (error) {
        console.error('Error playing live stream:', error);
        videoMessageElem.textContent = 'Error loading stream.';
    }
}

/**
 * Monitors buffer for transition from cache to live.
 */
function startTransitionMonitoring(stream) {
    if (bufferCheckInterval) clearInterval(bufferCheckInterval);
    
    bufferCheckInterval = setInterval(() => {
        if (!isPlayingFromCache || pendingTransition) return;
        
        const currentTime = videoElement.currentTime;
        const buffered = videoElement.buffered;
        
        if (buffered.length > 0) {
            const bufferedEnd = buffered.end(buffered.length - 1);
            const remainingBuffer = bufferedEnd - currentTime;
            
            // Transition when we're close to the end of cached content
            if (remainingBuffer <= 2 && isOnline) {
                transitionToLiveStream(stream);
            } else if (remainingBuffer <= 0.5 && !isOnline) {
                showConnectionRequired();
            }
        }
    }, 500);
}

/**
 * Transitions from cached playback to live stream.
 */
async function transitionToLiveStream(stream) {
    if (pendingTransition) return;
    pendingTransition = true;
    
    try {
        console.log('Transitioning to live stream...');
        const currentTime = videoElement.currentTime;
        
        // Initialize HLS for live stream
        initializeHLS();
        
        if (hls) {
            // Calculate the live position based on cached duration
            hls.loadSource(stream.src);
            
            hls.once(Hls.Events.MANIFEST_PARSED, () => {
                // Start live stream from appropriate position
                const targetTime = currentTime; // Approximate position
                hls.startLoad(targetTime);
                
                videoElement.currentTime = targetTime;
                videoElement.play();
                
                isPlayingFromCache = false;
                videoMessageElem.textContent = 'Transitioned to live stream';
                
                clearInterval(bufferCheckInterval);
            });
        }
    } catch (error) {
        console.error('Error transitioning to live stream:', error);
    } finally {
        pendingTransition = false;
    }
}

/**
 * Starts monitoring buffer status.
 */
function startBufferMonitoring() {
    if (bufferCheckInterval) clearInterval(bufferCheckInterval);
    
    bufferCheckInterval = setInterval(() => {
        updateSegmentProgress();
        
        if (isPlayingFromCache && !isOnline) {
            const currentTime = videoElement.currentTime;
            const buffered = videoElement.buffered;
            
            if (buffered.length > 0) {
                const bufferedEnd = buffered.end(buffered.length - 1);
                const remainingBuffer = bufferedEnd - currentTime;
                
                if (remainingBuffer <= 1) {
                    showConnectionRequired();
                }
            }
        }
    }, 1000);
}

/**
 * Shows the connection required overlay.
 */
function showConnectionRequired() {
    connectionOverlay.classList.remove('hidden');
    videoElement.pause();
    
    // Start checking for connection
    if (connectionCheckInterval) clearInterval(connectionCheckInterval);
    
    connectionCheckInterval = setInterval(() => {
        if (isOnline) {
            hideConnectionRequired();
            // Resume or transition to live stream
            const stream = HLS_STREAMS[currentStreamIndex];
            if (stream) {
                playLiveStream(stream);
            }
        }
    }, 1000);
}

/**
 * Hides the connection required overlay.
 */
function hideConnectionRequired() {
    connectionOverlay.classList.add('hidden');
    if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
        connectionCheckInterval = null;
    }
}

/**
 * Shows/hides loading overlay.
 */
function showLoading(show) {
    if (show) {
        videoLoadingOverlay.classList.remove('hidden');
    } else {
        videoLoadingOverlay.classList.add('hidden');
    }
}

/**
 * Shows offline message.
 */
function showOfflineMessage() {
    videoMessageElem.textContent = 'No cached content available. Please connect to the internet.';
    noVideoSourceElem.classList.remove('hidden');
    videoElement.classList.add('hidden');
}

// --- UI Update Functions ---

/**
 * Updates network status display.
 */
function updateNetworkStatus() {
    networkStatusElem.textContent = `Network Status: ${isOnline ? 'Online' : 'Offline'}`;
    networkStatusElem.classList.toggle('text-green-400', isOnline);
    networkStatusElem.classList.toggle('text-red-400', !isOnline);
    
    if (isOnline) {
        hideConnectionRequired();
        connectionStatus.textContent = 'Connected!';
    } else {
        connectionStatus.textContent = 'Waiting for connection...';
    }
}

/**
 * Updates segment progress information.
 */
function updateSegmentProgress() {
    if (!videoElement.buffered.length) return;
    
    const currentTime = videoElement.currentTime;
    const buffered = videoElement.buffered;
    const duration = videoElement.duration;
    
    if (buffered.length > 0 && duration) {
        const bufferedEnd = buffered.end(buffered.length - 1);
        const bufferedPercent = (bufferedEnd / duration * 100).toFixed(1);
        const currentPercent = (currentTime / duration * 100).toFixed(1);
        
        segmentProgress.textContent = `Progress: ${currentPercent}% | Buffered: ${bufferedPercent}%`;
    }
}

/**
 * Updates cache information display.
 */
function updateCacheInfo() {
    const stream = HLS_STREAMS[currentStreamIndex];
    if (stream && cachedSegments.size > 0) {
        cacheInfo.textContent = `Cached: ${cachedSegments.size} segments (${totalCachedDuration.toFixed(1)}s)`;
    } else {
        cacheInfo.textContent = 'No segments cached';
    }
}

/**
 * Updates the cached videos list display.
 */
async function updateCachedVideosList() {
    cachedVideosListElem.innerHTML = '';
    
    let hasCachedContent = false;
    
    for (const stream of HLS_STREAMS) {
        const segments = await getCachedSegmentsForStream(stream.id);
        if (segments.length > 0) {
            hasCachedContent = true;
            const div = document.createElement('div');
            div.className = 'bg-gray-700 p-3 rounded-lg flex items-center justify-between';
            div.innerHTML = `
                <span class="text-gray-200 text-sm">${stream.title}</span>
                <span class="text-green-400 text-xs">${segments.length} segments</span>
            `;
            cachedVideosListElem.appendChild(div);
        }
    }
    
    if (!hasCachedContent) {
        cachedVideosListElem.innerHTML = '<p class="text-gray-400 text-center text-sm">No segments cached yet.</p>';
    }
}

// --- Navigation Functions ---

/**
 * Goes to the next stream.
 */
function goToNextStream() {
    currentStreamIndex = (currentStreamIndex + 1) % HLS_STREAMS.length;
    loadCurrentStream();
}

/**
 * Goes to the previous stream.
 */
function goToPreviousStream() {
    currentStreamIndex = (currentStreamIndex - 1 + HLS_STREAMS.length) % HLS_STREAMS.length;
    loadCurrentStream();
}

/**
 * Clears all cached content.
 */
async function clearCache() {
    try {
        await clearAllCache();
        cachedSegments.clear();
        totalCachedDuration = 0;
        updateCachedVideosList();
        updateCacheInfo();
        networkMessageElem.textContent = 'Cache cleared successfully!';
        setTimeout(() => {
            networkMessageElem.textContent = '';
        }, 3000);
    } catch (error) {
        console.error('Error clearing cache:', error);
        networkMessageElem.textContent = 'Error clearing cache.';
    }
}

// --- Event Listeners and Initialization ---

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Initialize IndexedDB
        await openDatabase();
        updateNetworkStatus();
        
        // Load initial stream
        await loadCurrentStream();
        await updateCachedVideosList();
        
        // Network status listeners
        window.addEventListener('online', () => {
            isOnline = true;
            updateNetworkStatus();
            networkMessageElem.textContent = 'Connection restored!';
            
            // If we were showing connection required, try to resume
            if (!connectionOverlay.classList.contains('hidden')) {
                const stream = HLS_STREAMS[currentStreamIndex];
                if (stream) {
                    playLiveStream(stream);
                }
            }
        });
        
        window.addEventListener('offline', () => {
            isOnline = false;
            updateNetworkStatus();
            networkMessageElem.textContent = 'Connection lost. Playing from cache if available.';
        });
        
        // Video event listeners
        videoElement.addEventListener('timeupdate', updateSegmentProgress);
        videoElement.addEventListener('error', (e) => {
            console.error('Video error:', e);
            if (!isOnline) {
                showConnectionRequired();
            }
        });
        
        // Button listeners
        prevButton.addEventListener('click', goToPreviousStream);
        nextButton.addEventListener('click', goToNextStream);
        clearCacheButton.addEventListener('click', clearCache);
        
    } catch (error) {
        console.error('Initialization error:', error);
        networkMessageElem.textContent = 'Application initialization failed.';
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (hls) {
        hls.destroy();
    }
    if (bufferCheckInterval) {
        clearInterval(bufferCheckInterval);
    }
    if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
    }
});
