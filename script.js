// YouTube-like Video Player with HLS Manifest Manipulation and Offline Capabilities

// Global state variables
let isOnline = navigator.onLine;
let currentStreamUrl = null;
let hls = null;
let db = null; // IndexedDB instance
let currentManifest = null;
let modifiedManifest = null;
let cachedSegments = new Set();
let currentSegmentIndex = 0;
let totalSegments = 0;

// DOM Elements - will be initialized after DOM is loaded
let networkStatusElem;
let networkMessageElem;
let videoTitleElem;
let videoElement;
let videoLoadingOverlay;
let onlineSegmentSpinner;
let videoMessageElem;
let noVideoSourceElem;
let cachedSegmentsListElem;
let clearCacheButton;
let downloadManifestButton;
let loadVideoButton;
let videoUrlInput;
let segmentInfo;
let currentSegmentElem;
let playbackModeElem;
let cacheStatusElem;
let debugInfo;

/**
 * Initialize DOM element references
 */
function initializeDOMElements() {
    networkStatusElem = document.getElementById('networkStatus');
    networkMessageElem = document.getElementById('networkMessage');
    videoTitleElem = document.getElementById('videoTitle');
    videoElement = document.getElementById('videoElement');
    videoLoadingOverlay = document.getElementById('videoLoadingOverlay');
    onlineSegmentSpinner = document.getElementById('onlineSegmentSpinner');
    videoMessageElem = document.getElementById('videoMessage');
    noVideoSourceElem = document.getElementById('noVideoSource');
    cachedSegmentsListElem = document.getElementById('cachedSegmentsList');
    clearCacheButton = document.getElementById('clearCacheButton');
    downloadManifestButton = document.getElementById('downloadManifestButton');
    loadVideoButton = document.getElementById('loadVideoButton');
    videoUrlInput = document.getElementById('videoUrlInput');
    segmentInfo = document.getElementById('segmentInfo');
    currentSegmentElem = document.getElementById('currentSegment');
    playbackModeElem = document.getElementById('playbackMode');
    cacheStatusElem = document.getElementById('cacheStatus');
    debugInfo = document.getElementById('debugInfo');
}

// --- IndexedDB Functions ---

/**
 * Opens the IndexedDB database.
 * @returns {Promise<IDBDatabase>} A promise that resolves with the database instance.
 */
function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('HLSVideoCacheDB', 1);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            // Create object stores for video segments and manifests
            if (!db.objectStoreNames.contains('videoSegments')) {
                db.createObjectStore('videoSegments', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('manifests')) {
                db.createObjectStore('manifests', { keyPath: 'url' });
            }
            console.log('IndexedDB object stores created/upgraded.');
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
 * Stores a video segment in IndexedDB.
 * @param {string} segmentId - The ID of the segment.
 * @param {ArrayBuffer} data - The segment data as an ArrayBuffer.
 * @returns {Promise<void>}
 */
function storeSegmentInIndexedDB(segmentId, data) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject('IndexedDB not initialized.');
        }
        const transaction = db.transaction(['videoSegments'], 'readwrite');
        const store = transaction.objectStore('videoSegments');
        const request = store.put({ id: segmentId, data: data, timestamp: Date.now() });

        request.onsuccess = () => {
            console.log(`Segment ${segmentId} stored in IndexedDB.`);
            cachedSegments.add(segmentId);
            resolve();
        };

        request.onerror = (event) => {
            console.error(`Error storing segment ${segmentId}:`, event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Retrieves a video segment from IndexedDB.
 * @param {string} segmentId - The ID of the segment.
 * @returns {Promise<ArrayBuffer|null>} A promise that resolves with the ArrayBuffer data or null if not found.
 */
function getSegmentFromIndexedDB(segmentId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return resolve(null);
        }
        const transaction = db.transaction(['videoSegments'], 'readonly');
        const store = transaction.objectStore('videoSegments');
        const request = store.get(segmentId);

        request.onsuccess = () => {
            if (request.result) {
                console.log(`Segment ${segmentId} retrieved from IndexedDB.`);
                resolve(request.result.data);
            } else {
                console.log(`Segment ${segmentId} not found in IndexedDB.`);
                resolve(null);
            }
        };

        request.onerror = (event) => {
            console.error(`Error retrieving segment ${segmentId}:`, event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Stores a manifest in IndexedDB.
 * @param {string} url - The manifest URL.
 * @param {string} manifestContent - The manifest content.
 * @returns {Promise<void>}
 */
function storeManifestInIndexedDB(url, manifestContent) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject('IndexedDB not initialized.');
        }
        const transaction = db.transaction(['manifests'], 'readwrite');
        const store = transaction.objectStore('manifests');
        const request = store.put({ url: url, content: manifestContent, timestamp: Date.now() });

        request.onsuccess = () => {
            console.log(`Manifest for ${url} stored in IndexedDB.`);
            resolve();
        };

        request.onerror = (event) => {
            console.error(`Error storing manifest for ${url}:`, event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Retrieves a manifest from IndexedDB.
 * @param {string} url - The manifest URL.
 * @returns {Promise<string|null>} A promise that resolves with the manifest content or null if not found.
 */
function getManifestFromIndexedDB(url) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return resolve(null);
        }
        const transaction = db.transaction(['manifests'], 'readonly');
        const store = transaction.objectStore('manifests');
        const request = store.get(url);

        request.onsuccess = () => {
            if (request.result) {
                console.log(`Manifest for ${url} retrieved from IndexedDB.`);
                resolve(request.result.content);
            } else {
                console.log(`Manifest for ${url} not found in IndexedDB.`);
                resolve(null);
            }
        };

        request.onerror = (event) => {
            console.error(`Error retrieving manifest for ${url}:`, event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Clears all data from IndexedDB.
 * @returns {Promise<void>}
 */
function clearAllDataFromIndexedDB() {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject('IndexedDB not initialized.');
        }
        
        const transaction = db.transaction(['videoSegments', 'manifests'], 'readwrite');
        const segmentsStore = transaction.objectStore('videoSegments');
        const manifestsStore = transaction.objectStore('manifests');
        
        const segmentsRequest = segmentsStore.clear();
        const manifestsRequest = manifestsStore.clear();

        transaction.oncomplete = () => {
            console.log('All data cleared from IndexedDB.');
            cachedSegments.clear();
            resolve();
        };

        transaction.onerror = (event) => {
            console.error('Error clearing IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Gets all cached segment IDs from IndexedDB.
 * @returns {Promise<string[]>} A promise that resolves with an array of segment IDs.
 */
function getAllCachedSegmentIds() {
    return new Promise((resolve, reject) => {
        if (!db) {
            return resolve([]);
        }
        const transaction = db.transaction(['videoSegments'], 'readonly');
        const store = transaction.objectStore('videoSegments');
        const request = store.getAllKeys();

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = (event) => {
            console.error('Error getting all segment keys from IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });
}

// --- HLS Manifest Manipulation ---

/**
 * Downloads and parses an HLS manifest.
 * @param {string} url - The manifest URL.
 * @returns {Promise<{content: string, segments: string[]}>} A promise that resolves with the manifest content and segments.
 */
async function downloadManifest(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const content = await response.text();
        const segments = parseManifestSegments(content);
        
        return { content, segments };
    } catch (error) {
        console.error('Error downloading manifest:', error);
        throw error;
    }
}

/**
 * Parses segments from an HLS manifest.
 * @param {string} manifestContent - The manifest content.
 * @returns {string[]} Array of segment URLs.
 */
function parseManifestSegments(manifestContent) {
    const segments = [];
    const lines = manifestContent.split('\n');
    
    for (const line of lines) {
        if (line.trim() && !line.startsWith('#') && line.includes('.ts')) {
            segments.push(line.trim());
        }
    }
    
    return segments;
}

/**
 * Downloads a video segment.
 * @param {string} segmentUrl - The segment URL.
 * @returns {Promise<ArrayBuffer>} A promise that resolves with the segment data.
 */
async function downloadSegment(segmentUrl) {
    try {
        const response = await fetch(segmentUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        return await response.arrayBuffer();
    } catch (error) {
        console.error('Error downloading segment:', error);
        throw error;
    }
}

/**
 * Creates a modified manifest with local URLs for the first 3 segments.
 * @param {string} originalManifest - The original manifest content.
 * @param {string} baseUrl - The base URL for the manifest.
 * @param {string[]} segments - Array of segment URLs.
 * @returns {string} The modified manifest content.
 */
function createModifiedManifest(originalManifest, baseUrl, segments) {
    let modifiedManifest = originalManifest;
    
    // Replace the first 3 segments with local URLs
    for (let i = 0; i < Math.min(3, segments.length); i++) {
        const originalSegment = segments[i];
        const localSegment = `http://localhost/playlist.m3u8/segment${i + 1}.ts`;
        
        // Create absolute URL if segment is relative
        const absoluteSegmentUrl = originalSegment.startsWith('http') 
            ? originalSegment 
            : new URL(originalSegment, baseUrl).href;
        
        modifiedManifest = modifiedManifest.replace(originalSegment, localSegment);
        
        // Store the mapping for later use
        window.segmentMapping = window.segmentMapping || {};
        window.segmentMapping[localSegment] = absoluteSegmentUrl;
    }
    
    return modifiedManifest;
}

/**
 * Downloads and caches the first 3 segments.
 * @param {string[]} segments - Array of segment URLs.
 * @param {string} baseUrl - The base URL for the manifest.
 * @returns {Promise<void>}
 */
async function downloadAndCacheFirstSegments(segments, baseUrl) {
    const segmentsToCache = Math.min(3, segments.length);
    
    for (let i = 0; i < segmentsToCache; i++) {
        try {
            const segmentUrl = segments[i].startsWith('http') 
                ? segments[i] 
                : new URL(segments[i], baseUrl).href;
            
            const segmentData = await downloadSegment(segmentUrl);
            const segmentId = `segment${i + 1}`;
            
            await storeSegmentInIndexedDB(segmentId, segmentData);
            console.log(`Cached segment ${i + 1}/${segmentsToCache}`);
            
            updateDebugInfo(`Downloaded and cached segment ${i + 1}`);
        } catch (error) {
            console.error(`Error caching segment ${i + 1}:`, error);
            updateDebugInfo(`Error caching segment ${i + 1}: ${error.message}`);
        }
    }
}

// --- Video Player Functions ---

/**
 * Loads a video stream with HLS support.
 * @param {string} streamUrl - The HLS stream URL.
 */
async function loadVideoStream(streamUrl) {
    try {
        currentStreamUrl = streamUrl;
        updateDebugInfo(`Loading stream: ${streamUrl}`);
        
        // Show loading overlay
        if (videoLoadingOverlay) {
            videoLoadingOverlay.classList.remove('hidden');
        }
        if (noVideoSourceElem) {
            noVideoSourceElem.classList.add('hidden');
        }
        if (videoElement) {
            videoElement.classList.remove('hidden');
        }
        
        // Download and parse manifest
        const { content: manifestContent, segments } = await downloadManifest(streamUrl);
        currentManifest = manifestContent;
        totalSegments = segments.length;
        
        updateDebugInfo(`Manifest downloaded. Found ${segments.length} segments.`);
        
        // Store original manifest
        await storeManifestInIndexedDB(streamUrl, manifestContent);
        
        // Download and cache first 3 segments
        const baseUrl = new URL(streamUrl).origin;
        await downloadAndCacheFirstSegments(segments, baseUrl);
        
        // Create modified manifest
        modifiedManifest = createModifiedManifest(manifestContent, baseUrl, segments);
        
        // Create blob URL for modified manifest
        const manifestBlob = new Blob([modifiedManifest], { type: 'application/vnd.apple.mpegurl' });
        const manifestUrl = URL.createObjectURL(manifestBlob);
        
        // Initialize HLS.js
        if (Hls.isSupported()) {
            if (hls) {
                hls.destroy();
            }
            
            hls = new Hls({
                debug: false,
                enableWorker: true,
                lowLatencyMode: true,
                backBufferLength: 90
            });
            
            hls.loadSource(manifestUrl);
            if (videoElement) {
                hls.attachMedia(videoElement);
            }
            
            // Set up HLS event listeners
            setupHLSEventListeners();
            
        } else if (videoElement && videoElement.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS support (Safari)
            videoElement.src = manifestUrl;
            videoElement.addEventListener('loadedmetadata', () => {
                videoElement.play();
            });
        } else {
            throw new Error('HLS is not supported in this browser');
        }
        
        // Update UI
        if (videoTitleElem) {
            videoTitleElem.textContent = `Stream: ${new URL(streamUrl).hostname}`;
        }
        if (videoMessageElem) {
            videoMessageElem.textContent = 'Stream loaded successfully. First 3 segments cached for offline playback.';
        }
        if (segmentInfo) {
            segmentInfo.classList.remove('hidden');
        }
        updateSegmentInfo();
        
        // Hide loading overlay
        if (videoLoadingOverlay) {
            videoLoadingOverlay.classList.add('hidden');
        }
        
        updateDebugInfo('Stream loaded successfully');
        
    } catch (error) {
        console.error('Error loading video stream:', error);
        if (videoMessageElem) {
            videoMessageElem.textContent = `Error loading stream: ${error.message}`;
        }
        if (videoLoadingOverlay) {
            videoLoadingOverlay.classList.add('hidden');
        }
        updateDebugInfo(`Error: ${error.message}`);
    }
}

/**
 * Sets up HLS event listeners for monitoring playback.
 */
function setupHLSEventListeners() {
    if (!hls) return;
    
    hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        console.log('Manifest parsed, ready to play');
        updateDebugInfo('Manifest parsed successfully');
    });
    
    hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
        console.log('Level loaded:', data.level);
    });
    
    hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
        currentSegmentIndex = data.frag.sn;
        updateSegmentInfo();
        
        // Show spinner for online segments (after first 3)
        if (currentSegmentIndex >= 3) {
            showOnlineSegmentSpinner();
        }
    });
    
    hls.on(Hls.Events.FRAG_PARSED, (event, data) => {
        // Hide spinner when segment is parsed
        if (currentSegmentIndex >= 3) {
            hideOnlineSegmentSpinner();
        }
    });
    
    hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS error:', data);
        updateDebugInfo(`HLS Error: ${data.type} - ${data.details}`);
        
        if (data.fatal) {
            switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                    console.log('Network error, trying to recover...');
                    hls.startLoad();
                    break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                    console.log('Media error, trying to recover...');
                    hls.recoverMediaError();
                    break;
                default:
                    console.log('Fatal error, destroying HLS instance');
                    hls.destroy();
                    break;
            }
        }
    });
}

/**
 * Shows the spinner for online segments.
 */
function showOnlineSegmentSpinner() {
    if (!onlineSegmentSpinner) return;
    onlineSegmentSpinner.classList.remove('hidden');
}

/**
 * Hides the spinner for online segments.
 */
function hideOnlineSegmentSpinner() {
    if (!onlineSegmentSpinner) return;
    onlineSegmentSpinner.classList.add('hidden');
}

/**
 * Updates the segment information display.
 */
function updateSegmentInfo() {
    if (!currentSegmentElem || !playbackModeElem || !cacheStatusElem) return;
    
    currentSegmentElem.textContent = `Segment: ${currentSegmentIndex}/${totalSegments}`;
    playbackModeElem.textContent = `Mode: ${currentSegmentIndex < 3 ? 'Offline' : 'Online'}`;
    cacheStatusElem.textContent = `Cache: ${cachedSegments.size} segments`;
}

/**
 * Updates the debug information display.
 * @param {string} message - The debug message to add.
 */
function updateDebugInfo(message) {
    if (!debugInfo) return;
    
    const timestamp = new Date().toLocaleTimeString();
    const debugLine = `[${timestamp}] ${message}`;
    
    // Add new line to debug info
    const debugLineElem = document.createElement('p');
    debugLineElem.textContent = debugLine;
    debugInfo.appendChild(debugLineElem);
    
    // Keep only last 10 lines
    while (debugInfo.children.length > 10) {
        debugInfo.removeChild(debugInfo.firstChild);
    }
    
    // Scroll to bottom
    debugInfo.scrollTop = debugInfo.scrollHeight;
}

/**
 * Updates the network status display.
 */
function updateNetworkStatusDisplay() {
    if (!networkStatusElem || !networkMessageElem) return;
    
    networkStatusElem.textContent = `Network Status: ${isOnline ? 'Online' : 'Offline'}`;
    networkStatusElem.classList.toggle('text-green-400', isOnline);
    networkStatusElem.classList.toggle('text-red-400', !isOnline);
    
    if (!isOnline) {
        networkMessageElem.textContent = 'Offline mode: Only cached segments available.';
    } else {
        networkMessageElem.textContent = '';
    }
}

/**
 * Updates the cached segments list display.
 */
async function updateCachedSegmentsList() {
    if (!cachedSegmentsListElem) return;
    
    cachedSegmentsListElem.innerHTML = '';
    const cachedIds = await getAllCachedSegmentIds();

    if (cachedIds.length === 0) {
        cachedSegmentsListElem.innerHTML = '<p class="text-gray-400 text-center text-sm">No segments cached yet.</p>';
    } else {
        cachedIds.forEach(segmentId => {
            const div = document.createElement('div');
            div.className = 'bg-gray-700 p-3 rounded-lg flex items-center justify-between shadow-md';
            div.innerHTML = `
                <span class="text-gray-200 text-sm">
                    ${segmentId}
                </span>
                <span class="text-green-400 text-xs font-semibold">CACHED</span>
            `;
            cachedSegmentsListElem.appendChild(div);
        });
    }
}

/**
 * Clears all cached data.
 */
async function clearCache() {
    try {
        await clearAllDataFromIndexedDB();
        cachedSegments.clear();
        updateCachedSegmentsList();
        updateSegmentInfo();
        if (networkMessageElem) {
            networkMessageElem.textContent = 'Cache cleared successfully!';
        }
        updateDebugInfo('Cache cleared');
    } catch (error) {
        console.error('Error clearing cache:', error);
        if (networkMessageElem) {
            networkMessageElem.textContent = 'Error clearing cache.';
        }
        updateDebugInfo(`Error clearing cache: ${error.message}`);
    }
}

/**
 * Downloads the current manifest for inspection.
 */
function downloadManifestForInspection() {
    if (!modifiedManifest) {
        alert('No manifest available to download.');
        return;
    }
    
    const blob = new Blob([modifiedManifest], { type: 'application/vnd.apple.mpegurl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modified_manifest.m3u8';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    updateDebugInfo('Manifest downloaded for inspection');
}

// --- Service Worker Registration ---

/**
 * Registers the service worker for handling local segment requests
 */
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('./sw.js');
            console.log('Service Worker registered successfully:', registration);
            updateDebugInfo('Service Worker registered');
            
            // Handle service worker updates
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        // New service worker available
                        updateDebugInfo('New Service Worker available');
                    }
                });
            });
            
        } catch (error) {
            console.error('Service Worker registration failed:', error);
            updateDebugInfo(`Service Worker registration failed: ${error.message}`);
        }
    } else {
        console.warn('Service Worker not supported');
        updateDebugInfo('Service Worker not supported');
    }
}

// --- Event Listeners and Initial Setup ---

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Initialize DOM elements
        initializeDOMElements();
        
        // Register service worker
        await registerServiceWorker();
        
        // Open IndexedDB
        await openDatabase();
        updateNetworkStatusDisplay();
        await updateCachedSegmentsList();
        
        // Add event listeners
        if (loadVideoButton) {
            loadVideoButton.addEventListener('click', () => {
                const url = videoUrlInput ? videoUrlInput.value.trim() : '';
                if (url) {
                    loadVideoStream(url);
                } else {
                    alert('Please enter a valid HLS stream URL.');
                }
            });
        }
        
        if (videoUrlInput) {
            videoUrlInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && loadVideoButton) {
                    loadVideoButton.click();
                }
            });
        }
        
        if (clearCacheButton) {
            clearCacheButton.addEventListener('click', clearCache);
        }
        if (downloadManifestButton) {
            downloadManifestButton.addEventListener('click', downloadManifestForInspection);
        }
        
        // Network status listeners
        window.addEventListener('online', () => {
            isOnline = true;
            updateNetworkStatusDisplay();
            updateDebugInfo('Network connection restored');
        });
        
        window.addEventListener('offline', () => {
            isOnline = false;
            updateNetworkStatusDisplay();
            updateDebugInfo('Network connection lost');
        });
        
        // Video element listeners
        if (videoElement) {
            videoElement.addEventListener('ended', () => {
                updateDebugInfo('Video playback ended');
            });
            
            videoElement.addEventListener('error', (e) => {
                console.error('Video error:', e);
                updateDebugInfo(`Video error: ${e.target.error ? e.target.error.message : 'Unknown error'}`);
            });
        }
        
        updateDebugInfo('Application initialized successfully');
        
    } catch (error) {
        console.error('Failed to initialize application:', error);
        updateDebugInfo(`Initialization error: ${error.message}`);
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (hls) {
        hls.destroy();
    }
});
