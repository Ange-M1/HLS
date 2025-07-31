const VIDEOS = [
    { 
        id: 'video1', 
        title: 'Elephants Dream', 
        description: 'Beautiful nature content',
        src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4'
    },
    { 
        id: 'video2', 
        title: 'Big Buck Bunny', 
        description: 'Animated short film',
        src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
    },
    { 
        id: 'video3', 
        title: 'Sintel', 
        description: 'Fantasy adventure',
        src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4'
    }
];

const CACHE_DURATION = 15; // 15 seconds cache
const SEGMENT_SIZE = 1024 * 1024; // 1MB per segment

let currentIndex = 0;
let isOnline = navigator.onLine;
let db;
let videos = [];
let currentVideo = null;
let container;
let cacheStatus = new Map(); // Track cache status for each video

document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    initUI();
    setupEvents();
    await loadCacheStatus();
    await loadVideo(0);
    updateNetworkStatus();
    startCacheProcess();
});

async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('VideoCache', 2);
        
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            
            // Clear old stores if they exist
            if (db.objectStoreNames.contains('segments')) {
                db.deleteObjectStore('segments');
            }
            if (db.objectStoreNames.contains('metadata')) {
                db.deleteObjectStore('metadata');
            }
            
            // Create new stores
            const segmentStore = db.createObjectStore('segments', { keyPath: 'id' });
            segmentStore.createIndex('videoId', 'videoId', { unique: false });
            
            const metaStore = db.createObjectStore('metadata', { keyPath: 'videoId' });
            
            console.log('Database initialized');
        };
        
        request.onsuccess = (e) => {
            db = e.target.result;
            console.log('Database ready');
            resolve();
        };
        
        request.onerror = () => {
            console.error('Database failed');
            reject();
        };
    });
}

async function loadCacheStatus() {
    for (const video of VIDEOS) {
        const cached = await checkCacheExists(video.id);
        cacheStatus.set(video.id, cached);
        updateVideoCache(video.id, cached);
    }
}

async function checkCacheExists(videoId) {
    return new Promise((resolve) => {
        if (!db) return resolve(false);
        
        const tx = db.transaction(['metadata'], 'readonly');
        const store = tx.objectStore('metadata');
        const request = store.get(videoId);
        
        request.onsuccess = () => {
            const meta = request.result;
            if (meta && meta.cached && meta.segments >= 3) {
                console.log(`${videoId} found in cache (${meta.duration}s)`);
                resolve(true);
            } else {
                resolve(false);
            }
        };
        
        request.onerror = () => resolve(false);
    });
}

function initUI() {
    container = document.getElementById('videoContainer');
    
    VIDEOS.forEach((video, i) => {
        const item = document.createElement('div');
        item.className = 'video-item';
        item.setAttribute('data-index', i);
        
        item.innerHTML = `
            <video class="video-player" playsinline muted loop preload="none" data-id="${video.id}"></video>
            <div class="video-overlay"></div>
            
            <div class="loading-overlay hidden">
                <div class="spinner"></div>
            </div>
            
            <div class="connection-overlay hidden">
                <div class="connection-spinner"></div>
                <div class="connection-title">Internet Connection Required</div>
                <div class="connection-message">
                    Your 15-second cached video has finished.<br>
                    Please connect to the internet to continue watching.
                </div>
                <div class="connection-status">Waiting for connection...</div>
            </div>
            
            <div class="error-message hidden">
                <div>⚠️ Video Error</div>
                <div style="font-size: 12px; margin-top: 8px;">Swipe to try another video</div>
            </div>
            
            <div class="video-info">
                <div class="video-title">${video.title}</div>
                <div class="video-description">${video.description}</div>
                <div class="video-status">Ready</div>
            </div>
            
            <div class="side-controls">
                <button class="control-btn" onclick="togglePlay(${i})">⏯️</button>
                <button class="control-btn" onclick="clearCache()">🗑️</button>
                <button class="control-btn" onclick="refresh(${i})">🔄</button>
            </div>
            
            <div class="progress-bar">
                <div class="progress-fill"></div>
            </div>
            
            <div class="cache-info">
                <span class="cache-indicator none"></span>
                <span class="cache-text">No cache</span>
            </div>
            
            ${i === 0 ? '<div class="scroll-hint"><span class="scroll-arrow">↓</span><span>Swipe up</span></div>' : ''}
        `;
        
        container.appendChild(item);
        
        const videoEl = item.querySelector('.video-player');
        videos.push(videoEl);
        setupVideoEvents(videoEl, i);
    });
}

function setupVideoEvents(video, index) {
    const item = video.closest('.video-item');
    const status = item.querySelector('.video-status');
    const progress = item.querySelector('.progress-fill');
    const error = item.querySelector('.error-message');
    
    video.addEventListener('loadstart', () => {
        status.textContent = 'Loading...';
        error.classList.add('hidden');
    });
    
    video.addEventListener('canplay', () => {
        status.textContent = 'Ready';
        // Auto-play when ready
        if (index === currentIndex) {
            video.play().catch(() => console.log('Auto-play blocked'));
        }
    });
    
    video.addEventListener('playing', () => status.textContent = 'Playing');
    video.addEventListener('pause', () => status.textContent = 'Paused');
    
    video.addEventListener('timeupdate', () => {
        if (video.duration && video.currentTime >= 0) {
            const percent = (video.currentTime / video.duration) * 100;
            progress.style.width = Math.min(percent, 100) + '%';
            
            // Check if cached video is ending
            const videoData = VIDEOS[index];
            const isCached = cacheStatus.get(videoData.id);
            if (isCached && !isOnline && video.duration <= CACHE_DURATION + 1) {
                const timeLeft = video.duration - video.currentTime;
                if (timeLeft <= 2 && timeLeft > 0) {
                    showConnectionOverlay(item);
                }
            }
        }
    });
    
    video.addEventListener('ended', () => {
        status.textContent = 'Ended';
        const videoData = VIDEOS[index];
        const isCached = cacheStatus.get(videoData.id);
        if (isCached && !isOnline) {
            showConnectionOverlay(item);
        }
    });
    
    video.addEventListener('error', () => {
        status.textContent = 'Error';
        showError('Failed to load video', item);
    });
    
    video.addEventListener('click', () => togglePlay(index));
}

function setupEvents() {
    window.addEventListener('online', () => {
        isOnline = true;
        updateNetworkStatus();
        hideAllConnectionOverlays();
        if (currentVideo) {
            const videoData = VIDEOS[currentIndex];
            loadVideoContent(currentVideo, videoData);
        }
        startCacheProcess(); // Resume caching when online
    });
    
    window.addEventListener('offline', () => {
        isOnline = false;
        updateNetworkStatus();
    });
    
    let scrollTimeout;
    container.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(handleScroll, 150);
    });
    
    let touchY = 0;
    container.addEventListener('touchstart', (e) => touchY = e.touches[0].clientY);
    container.addEventListener('touchend', (e) => {
        const diff = touchY - e.changedTouches[0].clientY;
        if (Math.abs(diff) > 50) {
            diff > 0 ? scrollToNext() : scrollToPrev();
        }
    });
}

function handleScroll() {
    const items = document.querySelectorAll('.video-item');
    const containerRect = container.getBoundingClientRect();
    let maxVisible = 0;
    let targetIndex = 0;
    
    items.forEach((item, i) => {
        const rect = item.getBoundingClientRect();
        const visible = Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top);
        if (visible > maxVisible) {
            maxVisible = visible;
            targetIndex = i;
        }
    });
    
    if (targetIndex !== currentIndex) {
        loadVideo(targetIndex);
    }
}

async function loadVideo(index) {
    if (currentVideo) currentVideo.pause();
    
    currentIndex = index;
    currentVideo = videos[index];
    const video = VIDEOS[index];
    
    console.log(`Loading video: ${video.title}`);
    await loadVideoContent(currentVideo, video);
}

async function loadVideoContent(videoEl, videoData) {
    const item = videoEl.closest('.video-item');
    showLoading(item, true);
    
    try {
        const isCached = cacheStatus.get(videoData.id);
        
        if (isCached) {
            // Play from cache
            console.log(`Playing ${videoData.id} from cache`);
            const cachedUrl = await getCachedVideo(videoData.id);
            if (cachedUrl) {
                videoEl.src = cachedUrl;
                videoEl.load();
                updateCacheDisplay(item, true);
                
                // Wait for video to be ready then auto-play
                videoEl.addEventListener('canplay', () => {
                    videoEl.play().catch(() => console.log('Auto-play blocked'));
                }, { once: true });
            } else {
                throw new Error('Cache corrupted');
            }
        } else if (isOnline) {
            // Stream live and cache simultaneously
            console.log(`Streaming ${videoData.id} live`);
            videoEl.src = videoData.src;
            videoEl.load();
            updateCacheDisplay(item, false);
            
            // Auto-play when ready
            videoEl.addEventListener('canplay', () => {
                videoEl.play().catch(() => console.log('Auto-play blocked'));
            }, { once: true });
            
            // Start caching this video
            cacheVideo(videoData);
        } else {
            // No cache and offline
            throw new Error('No cache and offline');
        }
    } catch (error) {
        console.error(`Failed to load ${videoData.id}:`, error);
        showError('Failed to load', item);
    } finally {
        showLoading(item, false);
    }
}

async function startCacheProcess() {
    if (!isOnline) return;
    
    console.log('Starting cache process...');
    
    // Cache videos that aren't cached yet
    for (const video of VIDEOS) {
        const isCached = cacheStatus.get(video.id);
        if (!isCached) {
            console.log(`Caching ${video.id}...`);
            await cacheVideo(video);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Delay between downloads
        }
    }
}

async function cacheVideo(video) {
    if (!isOnline) return false;
    
    try {
        console.log(`Starting cache for ${video.id}`);
        
        // Test video accessibility
        const headResponse = await fetch(video.src, { method: 'HEAD', mode: 'cors' });
        if (!headResponse.ok) {
            console.error(`Cannot access ${video.id}: ${headResponse.status}`);
            return false;
        }
        
        const contentLength = parseInt(headResponse.headers.get('content-length') || '0');
        console.log(`${video.id} size: ${contentLength} bytes`);
        
        // Calculate how much data we need for 15 seconds
        // Estimate: for a typical video, 15 seconds ≈ 2-3MB
        const estimatedSizeFor15Sec = Math.min(contentLength * 0.15, 3 * 1024 * 1024); // 15% or 3MB max
        const segmentCount = 3; // Split into 3 segments
        const segmentSize = Math.floor(estimatedSizeFor15Sec / segmentCount);
        
        const segments = [];
        for (let i = 0; i < segmentCount; i++) {
            const start = i * segmentSize;
            const end = Math.min(start + segmentSize - 1, contentLength - 1);
            segments.push({
                start: start,
                end: end,
                range: `bytes=${start}-${end}`
            });
        }
        
        console.log(`Downloading ${segmentCount} segments for ${video.id}`);
        
        // Download and store segments
        const storedSegments = [];
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            
            try {
                const response = await fetch(video.src, {
                    headers: { 'Range': segment.range },
                    mode: 'cors'
                });
                
                if (response.ok || response.status === 206) { // 206 = Partial Content
                    const data = await response.arrayBuffer();
                    console.log(`Segment ${i} downloaded: ${data.byteLength} bytes`);
                    
                    await storeSegment(video.id, i, data);
                    storedSegments.push(i);
                } else {
                    console.warn(`Segment ${i} failed: ${response.status}`);
                }
            } catch (error) {
                console.error(`Error downloading segment ${i}:`, error);
                break;
            }
        }
        
        if (storedSegments.length > 0) {
            // Store metadata
            await storeMetadata(video.id, {
                cached: true,
                segments: storedSegments.length,
                duration: CACHE_DURATION,
                timestamp: Date.now()
            });
            
            cacheStatus.set(video.id, true);
            updateVideoCache(video.id, true);
            console.log(`✅ ${video.id} cached successfully (${storedSegments.length} segments)`);
            return true;
        } else {
            console.error(`❌ Failed to cache ${video.id}`);
            return false;
        }
        
    } catch (error) {
        console.error(`Error caching ${video.id}:`, error);
        return false;
    }
}

async function storeSegment(videoId, index, data) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('DB not ready'));
        
        const tx = db.transaction(['segments'], 'readwrite');
        const store = tx.objectStore('segments');
        
        const segmentData = {
            id: `${videoId}_segment_${index}`,
            videoId: videoId,
            index: index,
            data: data,
            size: data.byteLength,
            timestamp: Date.now()
        };
        
        const request = store.put(segmentData);
        
        request.onsuccess = () => {
            console.log(`Stored segment ${index} for ${videoId} (${data.byteLength} bytes)`);
            resolve();
        };
        
        request.onerror = () => {
            console.error(`Failed to store segment ${index} for ${videoId}`);
            reject(request.error);
        };
    });
}

async function storeMetadata(videoId, metadata) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('DB not ready'));
        
        const tx = db.transaction(['metadata'], 'readwrite');
        const store = tx.objectStore('metadata');
        
        const metaData = {
            videoId: videoId,
            ...metadata
        };
        
        const request = store.put(metaData);
        
        request.onsuccess = () => {
            console.log(`Metadata stored for ${videoId}`);
            resolve();
        };
        
        request.onerror = () => {
            console.error(`Failed to store metadata for ${videoId}`);
            reject(request.error);
        };
    });
}

async function getCachedVideo(videoId) {
    return new Promise((resolve) => {
        if (!db) return resolve(null);
        
        const tx = db.transaction(['segments'], 'readonly');
        const store = tx.objectStore('segments');
        const index = store.index('videoId');
        const request = index.getAll(videoId);
        
        request.onsuccess = () => {
            const segments = request.result || [];
            if (segments.length === 0) {
                console.log(`No segments found for ${videoId}`);
                return resolve(null);
            }
            
            // Sort segments by index
            segments.sort((a, b) => a.index - b.index);
            console.log(`Found ${segments.length} segments for ${videoId}`);
            
            // Combine segments
            const totalSize = segments.reduce((sum, seg) => sum + seg.data.byteLength, 0);
            const combined = new Uint8Array(totalSize);
            let offset = 0;
            
            for (const segment of segments) {
                combined.set(new Uint8Array(segment.data), offset);
                offset += segment.data.byteLength;
            }
            
            console.log(`Created blob for ${videoId}: ${totalSize} bytes`);
            const blob = new Blob([combined], { type: 'video/mp4' });
            const url = URL.createObjectURL(blob);
            resolve(url);
        };
        
        request.onerror = () => {
            console.error(`Failed to get segments for ${videoId}`);
            resolve(null);
        };
    });
}

function updateVideoCache(videoId, cached) {
    const items = document.querySelectorAll('.video-item');
    items.forEach(item => {
        const video = item.querySelector('.video-player');
        if (video.getAttribute('data-id') === videoId) {
            updateCacheDisplay(item, cached);
        }
    });
}

function updateNetworkStatus() {
    const status = document.getElementById('networkStatus');
    const dot = document.getElementById('networkDot');
    
    status.textContent = isOnline ? 'Online' : 'Offline';
    dot.className = isOnline ? 'network-dot' : 'network-dot offline';
}

function updateCacheDisplay(item, cached) {
    const indicator = item.querySelector('.cache-indicator');
    const text = item.querySelector('.cache-text');
    
    if (cached) {
        indicator.className = 'cache-indicator';
        text.textContent = '15s cached';
    } else {
        indicator.className = 'cache-indicator none';
        text.textContent = 'No cache';
    }
}

function showLoading(item, show) {
    item.querySelector('.loading-overlay').classList.toggle('hidden', !show);
}

function showConnectionOverlay(item) {
    const overlay = item.querySelector('.connection-overlay');
    overlay.classList.remove('hidden');
    
    // Auto-hide when connection is restored
    const checkConnection = () => {
        if (isOnline) {
            hideAllConnectionOverlays();
            const videoData = VIDEOS[currentIndex];
            loadVideoContent(currentVideo, videoData);
        } else {
            setTimeout(checkConnection, 1000);
        }
    };
    setTimeout(checkConnection, 1000);
}

function hideAllConnectionOverlays() {
    document.querySelectorAll('.connection-overlay').forEach(o => o.classList.add('hidden'));
}

function showError(message, item) {
    const error = item.querySelector('.error-message');
    error.querySelector('div').textContent = message;
    error.classList.remove('hidden');
    setTimeout(() => error.classList.add('hidden'), 5000);
}

function scrollToNext() {
    const next = (currentIndex + 1) % VIDEOS.length;
    const item = document.querySelector(`[data-index="${next}"]`);
    if (item) item.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function scrollToPrev() {
    const prev = (currentIndex - 1 + VIDEOS.length) % VIDEOS.length;
    const item = document.querySelector(`[data-index="${prev}"]`);
    if (item) item.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function togglePlay(index) {
    const video = videos[index];
    if (video.paused) {
        video.play().catch(() => console.log('Play failed'));
    } else {
        video.pause();
    }
}

async function refresh(index) {
    const video = videos[index];
    const data = VIDEOS[index];
    
    video.pause();
    video.src = '';
    
    await loadVideoContent(video, data);
}

async function clearCache() {
    return new Promise((resolve) => {
        if (!db) return resolve();
        
        const tx = db.transaction(['segments', 'metadata'], 'readwrite');
        
        const segmentStore = tx.objectStore('segments');
        const metaStore = tx.objectStore('metadata');
        
        segmentStore.clear();
        metaStore.clear();
        
        tx.oncomplete = () => {
            // Reset cache status
            cacheStatus.clear();
            VIDEOS.forEach(video => {
                cacheStatus.set(video.id, false);
                updateVideoCache(video.id, false);
            });
            
            console.log('Cache cleared successfully');
            resolve();
        };
        
        tx.onerror = () => {
            console.error('Failed to clear cache');
            resolve();
        };
    });
}

// Global functions
window.togglePlay = togglePlay;
window.refresh = refresh;
window.clearCache = clearCache;
