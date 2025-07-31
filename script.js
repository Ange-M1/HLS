// Video Stream Configuration with working URLs
const HLS_STREAMS = [
    { 
        id: 'stream1', 
        title: 'Sample Video Stream', 
        description: 'High quality video streaming with offline support',
        src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4'
    },
    { 
        id: 'stream2', 
        title: 'Demo Video Content', 
        description: 'Professional content delivery',
        src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
    },
    { 
        id: 'stream3', 
        title: 'Sample Content', 
        description: 'Smooth streaming experience',
        src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4'
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
 * Initialize IndexedDB with proper structure
 */
function initializeDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('VideoStreamDB', 3);

        request.onupgradeneeded = (event) => {
            db = event.target.result;
            
            // Clear existing stores if they exist
            if (db.objectStoreNames.contains('segments')) {
                db.deleteObjectStore('segments');
            }
            
            // Create object store with auto-incrementing key
            const segmentStore = db.createObjectStore('segments', { 
                keyPath: 'id'
            });
            
            // Create indexes for querying
            segmentStore.createIndex('streamId', 'streamId', { unique: false });
            segmentStore.createIndex('segmentIndex', 'segmentIndex', { unique: false });
            
            console.log('Database created with proper structure');
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('Database opened successfully');
            resolve();
        };

        request.onerror = (event) => {
            console.error('Database error:', event.target.error);
            reject(new Error('Failed to open database'));
        };
    });
}

/**
 * Store segment data
 */
async function storeSegment(streamId, segmentIndex, data, duration) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }
        
        const transaction = db.transaction(['segments'], 'readwrite');
        const store = transaction.objectStore('segments');
        
        const segmentData = {
            id: `${streamId}_seg_${segmentIndex}`,
            streamId: streamId,
            segmentIndex: segmentIndex,
            data: data,
            duration: duration || 3,
            timestamp: Date.now()
        };
        
        const request = store.put(segmentData);
        
        request.onsuccess = () => {
            console.log(`Stored segment ${segmentIndex} for ${streamId}`);
            resolve();
        };
        
        request.onerror = (event) => {
            console.error('Store error:', event.target.error);
            reject(new Error('Failed to store segment'));
        };
        
        transaction.onerror = (event) => {
            console.error('Transaction error:', event.target.error);
            reject(new Error('Transaction failed'));
        };
    });
}

/**
 * Get cached segments for a stream
 */
async function getCachedSegments(streamId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            resolve([]);
            return;
        }
        
        const transaction = db.transaction(['segments'], 'readonly');
        const store = transaction.objectStore('segments');
        const index = store.index('streamId');
        const request = index.getAll(streamId);
        
        request.onsuccess = () => {
            const segments = request.result || [];
            segments.sort((a, b) => a.segmentIndex - b.segmentIndex);
            resolve(segments);
        };
        
        request.onerror = (event) => {
            console.error('Get error:', event.target.error);
            resolve([]);
        };
    });
}

/**
 * Clear all cached data
 */
async function clearCache() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }
        
        const transaction = db.transaction(['segments'], 'readwrite');
        const store = transaction.objectStore('segments');
        const request = store.clear();
        
        request.onsuccess = () => {
            cachedData.clear();
            console.log('Cache cleared');
            resolve();
        };
        
        request.onerror = (event) => {
            console.error('Clear error:', event.target.error);
            reject(new Error('Failed to clear cache'));
        };
    });
}

// --- Video Processing Functions ---

/**
 * Create video segments from a video file
 */
async function createVideoSegments(videoUrl, streamId) {
    try {
        console.log(`Creating segments for ${streamId}`);
        
        // Test if video URL is accessible
        const testResponse = await fetch(videoUrl, { 
            method: 'HEAD',
            mode: 'cors'
        });
        
        if (!testResponse.ok) {
            throw new Error(`Video not accessible: ${testResponse.status}`);
        }
        
        const contentLength = parseInt(testResponse.headers.get('content-length') || '0');
        
        // Create 5 segments of 3 seconds each = 15 seconds total
        const segments = [];
        const segmentDuration = 3;
        
        if (contentLength > 0) {
            // Use byte ranges if content-length is available
            const segmentSize = Math.floor(contentLength / 8); // Conservative segment size
            
            for (let i = 0; i < 5; i++) {
                const start = i * segmentSize;
                const end = Math.min(start + segmentSize - 1, contentLength - 1);
                
                segments.push({
                    url: videoUrl,
                    duration: segmentDuration,
                    range: `bytes=${start}-${end}`,
                    index: i
                });
            }
        } else {
            // Fallback: create time-based segments
            for (let i = 0; i < 5; i++) {
                segments.push({
                    url: videoUrl,
                    duration: segmentDuration,
                    index: i
                });
            }
        }
        
        return segments;
    } catch (error) {
        console.error(`Error creating segments for ${streamId}:`, error);
        return [];
    }
}

/**
 * Cache segments for a stream
 */
async function cacheSegmentsForStream(streamId, videoUrl) {
    if (!isOnline) return;
    
    try {
        // Check existing cache
        const existingSegments = await getCachedSegments(streamId);
        if (existingSegments.length >= 5) {
            console.log(`Stream ${streamId} already fully cached`);
            const totalDuration = existingSegments.reduce((sum, seg) => sum + seg.duration, 0);
            updateCacheStatus(streamId, existingSegments.length, totalDuration);
            return;
        }
        
        // Create segments
        const segments = await createVideoSegments(videoUrl, streamId);
        if (segments.length === 0) return;
        
        let cachedCount = existingSegments.length;
        let totalDuration = existingSegments.reduce((sum, seg) => sum + seg.duration, 0);
        
        // Cache remaining segments
        for (let i = cachedCount; i < Math.min(segments.length, 5); i++) {
            const segment = segments[i];
            
            try {
                console.log(`Downloading segment ${i} for ${streamId}...`);
                
                let response;
                if (segment.range) {
                    response = await fetch(segment.url, {
                        headers: { 'Range': segment.range },
                        mode: 'cors'
                    });
                } else {
                    response = await fetch(segment.url, { mode: 'cors' });
                }
                
                if (!response.ok) {
                    console.warn(`Failed to fetch segment ${i}: ${response.status}`);
                    continue;
                }
                
                const data = await response.arrayBuffer();
                
                // Only store if we got reasonable data
                if (data.byteLength > 1000) {
                    await storeSegment(streamId, i, data, segment.duration);
                    cachedCount++;
                    totalDuration += segment.duration;
                    
                    updateCacheStatus(streamId, cachedCount, totalDuration);
                    
                    if (totalDuration >= MAX_CACHE_DURATION) break;
                } else {
                    console.warn(`Segment ${i} too small, skipping`);
                }
                
            } catch (error) {
                console.error(`Failed to cache segment ${i}:`, error);
                break;
            }
        }
        
        cachedData.set(streamId, { count: cachedCount, duration: totalDuration });
        console.log(`Cached ${cachedCount} segments for ${streamId} (${totalDuration}s)`);
        
    } catch (error) {
        console.error(`Error caching ${streamId}:`, error);
    }
}

/**
 * Create video from cached segments
 */
async function createVideoFromCache(streamId) {
    try {
        const segments = await getCachedSegments(streamId);
        if (segments.length === 0) return null;
        
        console.log(`Creating video from ${segments.length} cached segments`);
        
        // Combine segments
        const totalSize = segments.reduce((sum, seg) => sum + seg.data.byteLength, 0);
        const combined = new Uint8Array(totalSize);
        let offset = 0;
        
        for (const segment of segments) {
            combined.set(new Uint8Array(segment.data), offset);
            offset += segment.data.byteLength;
        }
        
        return URL.createObjectURL(new Blob([combined], { type: 'video/mp4' }));
    } catch (error) {
        console.error(`Error creating cached video for ${streamId}:`, error);
        return null;
    }
}

// --- UI Functions ---

/**
 * Initialize UI
 */
function initializeUI() {
    scrollContainer = document.getElementById('videoContainer');
    
    HLS_STREAMS.forEach((stream, index) => {
        createVideoItem(stream, index);
    });
}

/**
 * Create video item
 */
function createVideoItem(stream, index) {
    const videoItem = document.createElement('div');
    videoItem.className = 'video-item';
    videoItem.setAttribute('data-index', index);
    
    videoItem.innerHTML = `
        <video class="video-player" 
               playsinline 
               muted 
               loop 
               preload="none"
               data-stream-id="${stream.id}">
        </video>
        
        <div class="video-overlay"></div>
        
        <div class="loading-overlay hidden">
            <div class="spinner"></div>
        </div>
        
        <div class="connection-overlay hidden">
            <div class="connection-spinner"></div>
            <div class="connection-title">Internet Connection Required</div>
            <div class="connection-message">
                The cached video (${MAX_CACHE_DURATION}s) has finished.<br>
                Please connect to continue watching.
            </div>
            <div class="connection-status">Waiting for connection...</div>
        </div>
        
        <div class="error-message hidden">
            <div>⚠️ Video Loading Error</div>
            <div style="font-size: 12px; margin-top: 8px; opacity: 0.8;">
                Swipe to try another video
            </div>
        </div>
        
        <div class="video-info">
            <div class="video-title">${stream.title}</div>
            <div class="video-description">${stream.description}</div>
            <div class="video-status" data-status="loading">Ready</div>
        </div>
        
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
        
        <div class="progress-bar">
            <div class="progress-fill"></div>
        </div>
        
        <div class="cache-info">
            <span class="cache-indicator none"></span>
            <span class="cache-text">No cache</span>
        </div>
        
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
    
    setupVideoEvents(video, index);
}

/**
 * Setup video events
 */
function setupVideoEvents(video, index) {
    const videoItem = video.closest('.video-item');
    const progressFill = videoItem.querySelector('.progress-fill');
    const statusElement = videoItem.querySelector('.video-status');
    const errorElement = videoItem.querySelector('.error-message');
    
    video.addEventListener('loadstart', () => {
        statusElement.textContent = 'Loading...';
        statusElement.setAttribute('data-status', 'loading');
        errorElement.classList.add('hidden');
    });
    
    video.addEventListener('canplay', () => {
        statusElement.textContent = 'Ready';
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
        if (video.duration && video.currentTime >= 0) {
            const progress = (video.currentTime / video.duration) * 100;
            progressFill.style.width = Math.min(progress, 100) + '%';
        }
    });
    
    video.addEventListener('ended', () => {
        statusElement.textContent = 'Ended';
        statusElement.setAttribute('data-status', 'ended');
        
        if (!isOnline) {
            showConnectionOverlay(videoItem);
        }
    });
    
    video.addEventListener('error', (e) => {
        console.error('Video error:', e, video.error);
        statusElement.textContent = 'Error';
        statusElement.setAttribute('data-status', 'error');
        showError('Failed to load video', videoItem);
    });
    
    video.addEventListener('click', () => togglePlay(index));
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    window.addEventListener('online', () => {
        isOnline = true;
        updateNetworkStatus();
        handleConnectionRestored();
    });
    
    window.addEventListener('offline', () => {
        isOnline = false;
        updateNetworkStatus();
    });
    
    let scrollTimeout;
    scrollContainer.addEventListener('scroll', () => {
        isScrolling = true;
        clearTimeout(scrollTimeout);
        
        scrollTimeout = setTimeout(() => {
            isScrolling = false;
            handleScrollEnd();
        }, 150);
    });
    
    let touchStartY = 0;
    scrollContainer.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
    });
    
    scrollContainer.addEventListener('touchend', (e) => {
        const touchEndY = e.changedTouches[0].clientY;
        const diffY = touchStartY - touchEndY;
        
        if (Math.abs(diffY) > 50) {
            if (diffY > 0) {
                scrollToNextVideo();
            } else {
                scrollToPreviousVideo();
            }
        }
    });
}

/**
 * Handle scroll end
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
 * Switch to video
 */
async function switchToVideo(index) {
    if (currentPlayingVideo) {
        currentPlayingVideo.pause();
    }
    
    currentVideoIndex = index;
    currentPlayingVideo = videoElements[index];
    const stream = HLS_STREAMS[index];
    
    console.log(`Switching to video ${index}: ${stream.title}`);
    
    await loadVideoContent(currentPlayingVideo, stream);
}

/**
 * Load video content
 */
async function loadVideoContent(video, stream) {
    const videoItem = video.closest('.video-item');
    showLoading(videoItem, true);
    
    try {
        const cachedUrl = await createVideoFromCache(stream.id);
        
        if (cachedUrl) {
            console.log(`Playing ${stream.id} from cache`);
            video.src = cachedUrl;
            video.load();
            updateCacheDisplay(videoItem, true);
            
            try {
                await video.play();
            } catch (playError) {
                console.log('Auto-play blocked, user will need to click');
            }
        } else if (isOnline) {
            console.log(`Streaming ${stream.id} live`);
            video.src = stream.src;
            video.load();
            updateCacheDisplay(videoItem, false);
            
            try {
                await video.play();
            } catch (playError) {
                console.log('Auto-play blocked, user will need to click');
            }
            
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
        await cacheSegmentsForStream(stream.id, stream.src);
    } catch (error) {
        console.error(`Background caching failed for ${stream.id}:`, error);
    }
}

/**
 * Load all streams
 */
async function loadAllStreams() {
    await switchToVideo(0);
    
    if (isOnline) {
        for (let i = 1; i < HLS_STREAMS.length; i++) {
            setTimeout(() => {
                cacheStreamInBackground(HLS_STREAMS[i]);
            }, i * 2000);
        }
    }
}

// --- Utility Functions ---

function updateNetworkStatus() {
    const statusElement = document.getElementById('networkStatus');
    const dotElement = document.getElementById('networkDot');
    
    statusElement.textContent = isOnline ? 'Online' : 'Offline';
    dotElement.className = isOnline ? 'network-dot' : 'network-dot offline';
}

function updateCacheStatus(streamId, count, duration) {
    const videoItems = document.querySelectorAll('.video-item');
    
    videoItems.forEach(item => {
        const video = item.querySelector('.video-player');
        if (video.getAttribute('data-stream-id') === streamId) {
            updateCacheDisplay(item, true, count, duration);
        }
    });
}

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

function showLoading(videoItem, show) {
    const overlay = videoItem.querySelector('.loading-overlay');
    overlay.classList.toggle('hidden', !show);
}

function showConnectionOverlay(videoItem) {
    const overlay = videoItem.querySelector('.connection-overlay');
    overlay.classList.remove('hidden');
}

function hideConnectionOverlay(videoItem) {
    const overlay = videoItem.querySelector('.connection-overlay');
    overlay.classList.add('hidden');
}

function showError(message, videoItem = null) {
    if (videoItem) {
        const errorElement = videoItem.querySelector('.error-message');
        errorElement.querySelector('div').textContent = message;
        errorElement.classList.remove('hidden');
        
        setTimeout(() => {
            errorElement.classList.add('hidden');
        }, 5000);
    } else {
        console.error(message);
    }
}

function handleConnectionRestored() {
    document.querySelectorAll('.connection-overlay').forEach(overlay => {
        overlay.classList.add('hidden');
    });
    
    if (currentPlayingVideo) {
        const stream = HLS_STREAMS[currentVideoIndex];
        loadVideoContent(currentPlayingVideo, stream);
    }
}

function scrollToNextVideo() {
    const nextIndex = (currentVideoIndex + 1) % HLS_STREAMS.length;
    const nextVideo = document.querySelector(`[data-index="${nextIndex}"]`);
    if (nextVideo) {
        nextVideo.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function scrollToPreviousVideo() {
    const prevIndex = (currentVideoIndex - 1 + HLS_STREAMS.length) % HLS_STREAMS.length;
    const prevVideo = document.querySelector(`[data-index="${prevIndex}"]`);
    if (prevVideo) {
        prevVideo.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function startPeriodicChecks() {
    setInterval(() => {
        if (currentPlayingVideo && !isOnline) {
            const video = currentPlayingVideo;
            if (video.duration && video.currentTime) {
                const timeLeft = video.duration - video.currentTime;
                
                if (timeLeft <= 2 && timeLeft > 0) {
                    const videoItem = video.closest('.video-item');
                    showConnectionOverlay(videoItem);
                }
            }
        }
    }, SEGMENT_CHECK_INTERVAL);
}

// --- Control Functions ---

function togglePlay(index) {
    const video = videoElements[index];
    if (video.paused) {
        video.play().catch(e => console.log('Play failed:', e));
    } else {
        video.pause();
    }
}

async function refreshVideo(index) {
    const video = videoElements[index];
    const stream = HLS_STREAMS[index];
    
    video.pause();
    video.src = '';
    
    await loadVideoContent(video, stream);
}

// Global functions
window.togglePlay = togglePlay;
window.refreshVideo = refreshVideo;
window.clearCache = async () => {
    try {
        await clearCache();
        
        document.querySelectorAll('.video-item').forEach(item => {
            updateCacheDisplay(item, false);
        });
        
        console.log('Cache cleared successfully');
    } catch (error) {
        console.error('Failed to clear cache:', error);
    }
};
