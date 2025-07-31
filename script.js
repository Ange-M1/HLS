// HLS Video Stream Configuration
const HLS_STREAMS = [
    { 
        id: 'stream1', 
        title: 'Sample HLS Stream', 
        description: 'High quality video streaming with offline support',
        src: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8' 
    },
    { 
        id: 'stream2', 
        title: 'Demo Video Stream', 
        description: 'Professional content delivery',
        src: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8' 
    },
    { 
        id: 'stream3', 
        title: 'Sample Content', 
        description: 'Smooth streaming experience',
        src: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' 
    }
];

// Configuration
const MAX_CACHE_DURATION = 15; // Maximum 15 seconds of cached content
const SEGMENT_CHECK_INTERVAL = 500; // Check every 500ms

// Global state
let currentVideoIndex = 0;
let isOnline = navigator.onLine;
let db; // IndexedDB instance
let videoElements = []; // Array of video elements
let currentPlayingVideo = null;
let cachedData = new Map(); // Track cached segments per stream
let scrollContainer;
let isScrolling = false;
let lastScrollTime = 0;

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initializeDatabase();
        initializeUI();
        setupEventListeners();
        await loadAllStreams();
        updateNetworkStatus();
        startPeriodicChecks();
    } catch (error) {
        console.error('Initialization failed:', error);
        showError('Failed to initialize application');
    }
});

// --- IndexedDB Functions ---

/**
 * Initialize IndexedDB
 */
function initializeDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('HLSCacheDB', 1);

        request.onupgradeneeded = (event) => {
            db = event.target.result;
            
            if (!db.objectStoreNames.contains('segments')) {
                db.createObjectStore('segments', { keyPath: 'id' });
            }
            
            console.log('Database initialized');
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve();
        };

        request.onerror = () => {
            reject(new Error('Failed to open database'));
        };
    });
}

/**
 * Store segment data with 15-second limit
 */
async function storeSegment(streamId, segmentIndex, data, duration) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialized'));
        
        const transaction = db.transaction(['segments'], 'readwrite');
        const store = transaction.objectStore('segments');
        const id = `${streamId}_${segmentIndex}`;
        
        const segmentData = {
            id: id,
            streamId: streamId,
            segmentIndex: segmentIndex,
            data: data,
            duration: duration,
            timestamp: Date.now()
        };
        
        const request = store.put(segmentData);
        
        request.onsuccess = () => {
            console.log(`Stored segment ${segmentIndex} (${duration}s) for ${streamId}`);
            resolve();
        };
        
        request.onerror = () => {
            reject(new Error('Failed to store segment'));
        };
    });
}

/**
 * Get cached segments for a stream
 */
async function getCachedSegments(streamId) {
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
        
        request.onerror = () => {
            reject(new Error('Failed to get cached segments'));
        };
    });
}

/**
 * Clear all cached data
 */
async function clearCache() {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialized'));
        
        const transaction = db.transaction(['segments'], 'readwrite');
        const store = transaction.objectStore('segments');
        const request = store.clear();
        
        request.onsuccess = () => {
            cachedData.clear();
            console.log('Cache cleared');
            resolve();
        };
        
        request.onerror = () => {
            reject(new Error('Failed to clear cache'));
        };
    });
}

// --- HLS Processing Functions ---

/**
 * Parse HLS manifest and extract segment URLs
 */
async function parseHLSManifest(manifestUrl) {
    try {
        const response = await fetch(manifestUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const manifestText = await response.text();
        const lines = manifestText.split('\n');
        const segments = [];
        
        let duration = 0;
        const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1);
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (line.startsWith('#EXTINF:')) {
                const match = line.match(/#EXTINF:([\d.]+)/);
                if (match) {
                    duration = parseFloat(match[1]);
                }
            } else if (line && !line.startsWith('#')) {
                const url = line.startsWith('http') ? line : baseUrl + line;
                segments.push({ url, duration });
            }
        }
        
        return segments;
    } catch (error) {
        console.error('Failed to parse manifest:', error);
        return [];
    }
}

/**
 * Cache segments up to 15 seconds total duration
 */
async function cacheSegmentsForStream(streamId, segments) {
    if (!isOnline || segments.length === 0) return;
    
    let totalDuration = 0;
    let cachedCount = 0;
    
    // Check existing cache
    const existingSegments = await getCachedSegments(streamId);
    if (existingSegments.length > 0) {
        totalDuration = existingSegments.reduce((sum, seg) => sum + (seg.duration || 0), 0);
        cachedCount = existingSegments.length;
    }
    
    // Cache additional segments if needed
    for (let i = cachedCount; i < segments.length && totalDuration < MAX_CACHE_DURATION; i++) {
        const segment = segments[i];
        
        try {
            console.log(`Downloading segment ${i} for ${streamId}...`);
            const response = await fetch(segment.url);
            if (!response.ok) continue;
            
            const data = await response.arrayBuffer();
            await storeSegment(streamId, i, data, segment.duration);
            
            totalDuration += segment.duration;
            cachedCount++;
            
            // Update cache info for this stream
            updateCacheStatus(streamId, cachedCount, totalDuration);
            
            if (totalDuration >= MAX_CACHE_DURATION) {
                console.log(`Reached ${MAX_CACHE_DURATION}s cache limit for ${streamId}`);
                break;
            }
        } catch (error) {
            console.error(`Failed to cache segment ${i}:`, error);
            break;
        }
    }
    
    // Store cache info
    cachedData.set(streamId, { count: cachedCount, duration: totalDuration });
}

/**
 * Create video blob from cached segments
 */
async function createVideoFromCache(streamId) {
    const segments = await getCachedSegments(streamId);
    if (segments.length === 0) return null;
    
    console.log(`Creating video from ${segments.length} cached segments`);
    
    // Combine segment data
    const totalSize = segments.reduce((sum, seg) => sum + seg.data.byteLength, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    
    for (const segment of segments) {
        combined.set(new Uint8Array(segment.data), offset);
        offset += segment.data.byteLength;
    }
    
    return URL.createObjectURL(new Blob([combined], { type: 'video/mp2t' }));
}

// --- UI Functions ---

/**
 * Initialize the user interface
 */
function initializeUI() {
    scrollContainer = document.getElementById('videoContainer');
    
    // Create video items for each stream
    HLS_STREAMS.forEach((stream, index) => {
        createVideoItem(stream, index);
    });
}

/**
 * Create a video item element
 */
function createVideoItem(stream, index) {
    const videoItem = document.createElement('div');
    videoItem.className = 'video-item';
    videoItem.setAttribute('data-index', index);
    
    videoItem.innerHTML = `
        <!-- Video Player -->
        <video class="video-player" 
               playsinline 
               muted 
               loop 
               data-stream-id="${stream.id}">
            Your browser does not support video playback.
        </video>
        
        <!-- Video Overlay -->
        <div class="video-overlay"></div>
        
        <!-- Loading Overlay -->
        <div class="loading-overlay hidden">
            <div class="spinner"></div>
        </div>
        
        <!-- Connection Overlay -->
        <div class="connection-overlay hidden">
            <div class="connection-spinner"></div>
            <div class="connection-title">Internet Connection Required</div>
            <div class="connection-message">
                The cached video (${MAX_CACHE_DURATION}s) has finished playing.<br>
                Please connect to the internet to continue watching.
            </div>
            <div class="connection-status">Waiting for connection...</div>
        </div>
        
        <!-- Error Message -->
        <div class="error-message hidden">
            <div>⚠️ Error Loading Video</div>
            <div style="font-size: 12px; margin-top: 8px; opacity: 0.8;">
                Swipe to try another video
            </div>
        </div>
        
        <!-- Video Info -->
        <div class="video-info">
            <div class="video-title">${stream.title}</div>
            <div class="video-description">${stream.description}</div>
            <div class="video-status" data-status="loading">Loading...</div>
        </div>
        
        <!-- Side Controls -->
        <div class="side-controls">
            <button class="control-btn" onclick="togglePlay(${index})" title="Play/Pause">
                ⏯️
            </button>
            <button class="control-btn" onclick="clearCache()" title="Clear Cache">
                🗑️
            </button>
            <button class="control-btn" onclick="refreshVideo(${index})" title="Refresh">
                🔄
            </button>
        </div>
        
        <!-- Progress Bar -->
        <div class="progress-bar">
            <div class="progress-fill"></div>
        </div>
        
        <!-- Cache Info -->
        <div class="cache-info">
            <span class="cache-indicator none"></span>
            <span class="cache-text">No cache</span>
        </div>
        
        <!-- Scroll Hint (only on first video) -->
        ${index === 0 ? `
        <div class="scroll-hint">
            <span class="scroll-arrow">↓</span>
            <span>Swipe up for next video</span>
        </div>
        ` : ''}
    `;
    
    scrollContainer.appendChild(videoItem);
    
    const video = videoItem.querySelector('.video-player');
    videoElements.push(video);
    
    // Add video event listeners
    setupVideoEvents(video, index);
}

/**
 * Setup event listeners for a video element
 */
function setupVideoEvents(video, index) {
    const videoItem = video.closest('.video-item');
    const progressFill = videoItem.querySelector('.progress-fill');
    const statusElement = videoItem.querySelector('.video-status');
    
    video.addEventListener('loadstart', () => {
        statusElement.textContent = 'Loading...';
        statusElement.setAttribute('data-status', 'loading');
    });
    
    video.addEventListener('canplay', () => {
        statusElement.textContent = 'Ready to play';
        statusElement.setAttribute('data-status', 'ready');
    });
    
    video.addEventListener('playing', () => {
        statusElement.textContent = 'Playing';
        statusElement.setAttribute('data-status', 'playing');
    });
    
    video.addEventListener('pause', () => {
        statusElement.textContent = 'Paused';
        statusElement.setAttribute('data-status', 'paused');
    });
    
    video.addEventListener('timeupdate', () => {
        if (video.duration) {
            const progress = (video.currentTime / video.duration) * 100;
            progressFill.style.width = progress + '%';
        }
    });
    
    video.addEventListener('ended', () => {
        statusElement.textContent = 'Ended';
        statusElement.setAttribute('data-status', 'ended');
        
        // Check if we need to show connection overlay
        if (!isOnline) {
            showConnectionOverlay(videoItem);
        }
    });
    
    video.addEventListener('error', (e) => {
        console.error('Video error:', e);
        statusElement.textContent = 'Error';
        statusElement.setAttribute('data-status', 'error');
        showError('Video playback error', videoItem);
    });
    
    // Click to play/pause
    video.addEventListener('click', () => togglePlay(index));
}

/**
 * Setup global event listeners
 */
function setupEventListeners() {
    // Network status
    window.addEventListener('online', () => {
        isOnline = true;
        updateNetworkStatus();
        handleConnectionRestored();
    });
    
    window.addEventListener('offline', () => {
        isOnline = false;
        updateNetworkStatus();
    });
    
    // Scroll handling for TikTok-like behavior
    let scrollTimeout;
    scrollContainer.addEventListener('scroll', () => {
        isScrolling = true;
        clearTimeout(scrollTimeout);
        
        scrollTimeout = setTimeout(() => {
            isScrolling = false;
            handleScrollEnd();
        }, 150);
    });
    
    // Touch events for mobile
    let touchStartY = 0;
    scrollContainer.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
    });
    
    scrollContainer.addEventListener('touchend', (e) => {
        const touchEndY = e.changedTouches[0].clientY;
        const diffY = touchStartY - touchEndY;
        
        if (Math.abs(diffY) > 50) { // Minimum swipe distance
            if (diffY > 0) {
                // Swipe up - next video
                scrollToNextVideo();
            } else {
                // Swipe down - previous video
                scrollToPreviousVideo();
            }
        }
    });
}

/**
 * Handle scroll end to determine current video
 */
function handleScrollEnd() {
    const containerRect = scrollContainer.getBoundingClientRect();
    const videos = document.querySelectorAll('.video-item');
    
    let currentVideo = null;
    let maxVisibleArea = 0;
    
    videos.forEach((videoItem, index) => {
        const rect = videoItem.getBoundingClientRect();
        const visibleHeight = Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top);
        const visibleArea = Math.max(0, visibleHeight) * rect.width;
        
        if (visibleArea > maxVisibleArea) {
            maxVisibleArea = visibleArea;
            currentVideo = { element: videoItem, index };
        }
    });
    
    if (currentVideo && currentVideo.index !== currentVideoIndex) {
        switchToVideo(currentVideo.index);
    }
}

/**
 * Switch to a specific video
 */
async function switchToVideo(index) {
    // Pause current video
    if (currentPlayingVideo) {
        currentPlayingVideo.pause();
    }
    
    currentVideoIndex = index;
    currentPlayingVideo = videoElements[index];
    const stream = HLS_STREAMS[index];
    
    console.log(`Switching to video ${index}: ${stream.title}`);
    
    // Load and play the video
    await loadVideoContent(currentPlayingVideo, stream);
}

/**
 * Load video content (from cache or live)
 */
async function loadVideoContent(video, stream) {
    const videoItem = video.closest('.video-item');
    showLoading(videoItem, true);
    
    try {
        // Try cache first
        const cachedUrl = await createVideoFromCache(stream.id);
        
        if (cachedUrl) {
            console.log(`Playing ${stream.id} from cache`);
            video.src = cachedUrl;
            video.load();
            await video.play();
            updateCacheDisplay(videoItem, true);
        } else if (isOnline) {
            console.log(`Streaming ${stream.id} live`);
            // For simplicity, try direct video URL or fallback
            video.src = stream.src;
            video.load();
            await video.play();
            updateCacheDisplay(videoItem, false);
            
            // Start caching in background
            cacheStreamInBackground(stream);
        } else {
            throw new Error('No cached content and offline');
        }
    } catch (error) {
        console.error(`Failed to load video ${stream.id}:`, error);
        showError('Failed to load video', videoItem);
    } finally {
        showLoading(videoItem, false);
    }
}

/**
 * Cache stream in background
 */
async function cacheStreamInBackground(stream) {
    try {
        const segments = await parseHLSManifest(stream.src);
        if (segments.length > 0) {
            await cacheSegmentsForStream(stream.id, segments);
        }
    } catch (error) {
        console.error(`Background caching failed for ${stream.id}:`, error);
    }
}

/**
 * Load all streams initially
 */
async function loadAllStreams() {
    // Load the first video
    await switchToVideo(0);
    
    // Cache other streams in background if online
    if (isOnline) {
        for (let i = 1; i < HLS_STREAMS.length; i++) {
            cacheStreamInBackground(HLS_STREAMS[i]);
        }
    }
}

// --- Utility Functions ---

/**
 * Update network status display
 */
function updateNetworkStatus() {
    const statusElement = document.getElementById('networkStatus');
    const dotElement = document.getElementById('networkDot');
    
    statusElement.textContent = isOnline ? 'Online' : 'Offline';
    dotElement.className = isOnline ? 'network-dot' : 'network-dot offline';
}

/**
 * Update cache status for a stream
 */
function updateCacheStatus(streamId, count, duration) {
    const videoItems = document.querySelectorAll('.video-item');
    
    videoItems.forEach(item => {
        const video = item.querySelector('.video-player');
        if (video.getAttribute('data-stream-id') === streamId) {
            updateCacheDisplay(item, true, count, duration);
        }
    });
}

/**
 * Update cache display for a video item
 */
function updateCacheDisplay(videoItem, isCached, count = 0, duration = 0) {
    const indicator = videoItem.querySelector('.cache-indicator');
    const text = videoItem.querySelector('.cache-text');
    
    if (isCached && duration > 0) {
        indicator.className = duration >= MAX_CACHE_DURATION ? 'cache-indicator' : 'cache-indicator partial';
        text.textContent = `${duration.toFixed(1)}s cached`;
    } else if (isCached) {
        indicator.className = 'cache-indicator partial';
        text.textContent = 'Partially cached';
    } else {
        indicator.className = 'cache-indicator none';
        text.textContent = 'No cache';
    }
}

/**
 * Show/hide loading overlay
 */
function showLoading(videoItem, show) {
    const overlay = videoItem.querySelector('.loading-overlay');
    overlay.classList.toggle('hidden', !show);
}

/**
 * Show connection overlay
 */
function showConnectionOverlay(videoItem) {
    const overlay = videoItem.querySelector('.connection-overlay');
    overlay.classList.remove('hidden');
}

/**
 * Hide connection overlay
 */
function hideConnectionOverlay(videoItem) {
    const overlay = videoItem.querySelector('.connection-overlay');
    overlay.classList.add('hidden');
}

/**
 * Show error message
 */
function showError(message, videoItem = null) {
    if (videoItem) {
        const errorElement = videoItem.querySelector('.error-message');
        errorElement.querySelector('div').textContent = message;
        errorElement.classList.remove('hidden');
    } else {
        console.error(message);
    }
}

/**
 * Handle connection restored
 */
function handleConnectionRestored() {
    // Hide all connection overlays
    document.querySelectorAll('.connection-overlay').forEach(overlay => {
        overlay.classList.add('hidden');
    });
    
    // Resume current video if possible
    if (currentPlayingVideo) {
        const stream = HLS_STREAMS[currentVideoIndex];
        loadVideoContent(currentPlayingVideo, stream);
    }
}

/**
 * Scroll to next video
 */
function scrollToNextVideo() {
    const nextIndex = (currentVideoIndex + 1) % HLS_STREAMS.length;
    const nextVideo = document.querySelector(`[data-index="${nextIndex}"]`);
    if (nextVideo) {
        nextVideo.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/**
 * Scroll to previous video
 */
function scrollToPreviousVideo() {
    const prevIndex = (currentVideoIndex - 1 + HLS_STREAMS.length) % HLS_STREAMS.length;
    const prevVideo = document.querySelector(`[data-index="${prevIndex}"]`);
    if (prevVideo) {
        prevVideo.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/**
 * Start periodic checks
 */
function startPeriodicChecks() {
    setInterval(() => {
        // Check if current video is near end and no internet
        if (currentPlayingVideo && !isOnline) {
            const video = currentPlayingVideo;
            const timeLeft = video.duration - video.currentTime;
            
            if (timeLeft <= 2 && timeLeft > 0) { // 2 seconds before end
                const videoItem = video.closest('.video-item');
                showConnectionOverlay(videoItem);
            }
        }
    }, SEGMENT_CHECK_INTERVAL);
}

// --- Control Functions ---

/**
 * Toggle play/pause for a video
 */
function togglePlay(index) {
    const video = videoElements[index];
    if (video.paused) {
        video.play().catch(e => console.error('Play failed:', e));
    } else {
        video.pause();
    }
}

/**
 * Refresh a video
 */
async function refreshVideo(index) {
    const video = videoElements[index];
    const stream = HLS_STREAMS[index];
    
    video.pause();
    video.src = '';
    
    await loadVideoContent(video, stream);
}

// Global functions for button clicks
window.togglePlay = togglePlay;
window.refreshVideo = refreshVideo;
window.clearCache = async () => {
    try {
        await clearCache();
        
        // Update all cache displays
        document.querySelectorAll('.video-item').forEach(item => {
            updateCacheDisplay(item, false);
        });
        
        console.log('Cache cleared successfully');
    } catch (error) {
        console.error('Failed to clear cache:', error);
    }
};
