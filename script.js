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

let currentIndex = 0;
let isOnline = navigator.onLine;
let db;
let videos = [];
let currentVideo = null;
let container;

document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    initUI();
    setupEvents();
    await loadVideo(0);
    updateNetworkStatus();
});

async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('VideoCache', 1);
        
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains('segments')) {
                const store = db.createObjectStore('segments', { keyPath: 'id' });
                store.createIndex('videoId', 'videoId', { unique: false });
            }
        };
        
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve();
        };
        
        request.onerror = () => reject();
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
                <div class="connection-title">Connection Required</div>
                <div class="connection-message">Cached content finished. Connect to continue.</div>
                <div class="connection-status">Waiting...</div>
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
    
    video.addEventListener('canplay', () => status.textContent = 'Ready');
    video.addEventListener('playing', () => status.textContent = 'Playing');
    video.addEventListener('pause', () => status.textContent = 'Paused');
    video.addEventListener('ended', () => {
        status.textContent = 'Ended';
        if (!isOnline) showConnectionOverlay(item);
    });
    
    video.addEventListener('timeupdate', () => {
        if (video.duration && video.currentTime >= 0) {
            const percent = (video.currentTime / video.duration) * 100;
            progress.style.width = Math.min(percent, 100) + '%';
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
        if (currentVideo) loadVideoContent(currentVideo, VIDEOS[currentIndex]);
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
    
    await loadVideoContent(currentVideo, video);
}

async function loadVideoContent(videoEl, videoData) {
    const item = videoEl.closest('.video-item');
    showLoading(item, true);
    
    try {
        const cachedUrl = await getCachedVideo(videoData.id);
        
        if (cachedUrl) {
            videoEl.src = cachedUrl;
            videoEl.load();
            updateCacheDisplay(item, true);
            try { await videoEl.play(); } catch (e) {}
        } else if (isOnline) {
            videoEl.src = videoData.src;
            videoEl.load();
            updateCacheDisplay(item, false);
            try { await videoEl.play(); } catch (e) {}
            cacheVideo(videoData);
        } else {
            throw new Error('No cache and offline');
        }
    } catch (error) {
        showError('Failed to load', item);
    } finally {
        showLoading(item, false);
    }
}

async function cacheVideo(video) {
    if (!isOnline) return;
    
    try {
        const segments = await createSegments(video.src, video.id);
        if (segments.length === 0) return;
        
        for (let i = 0; i < Math.min(segments.length, 5); i++) {
            const segment = segments[i];
            try {
                const response = await fetch(segment.url, {
                    headers: segment.range ? { 'Range': segment.range } : {},
                    mode: 'cors'
                });
                
                if (response.ok) {
                    const data = await response.arrayBuffer();
                    if (data.byteLength > 1000) {
                        await storeSegment(video.id, i, data);
                    }
                }
            } catch (e) {
                break;
            }
        }
    } catch (e) {}
}

async function createSegments(url, videoId) {
    try {
        const response = await fetch(url, { method: 'HEAD', mode: 'cors' });
        if (!response.ok) return [];
        
        const length = parseInt(response.headers.get('content-length') || '0');
        const segments = [];
        
        if (length > 0) {
            const size = Math.floor(length / 8);
            for (let i = 0; i < 5; i++) {
                segments.push({
                    url: url,
                    range: `bytes=${i * size}-${Math.min((i + 1) * size - 1, length - 1)}`
                });
            }
        } else {
            for (let i = 0; i < 5; i++) {
                segments.push({ url: url });
            }
        }
        
        return segments;
    } catch (e) {
        return [];
    }
}

async function storeSegment(videoId, index, data) {
    return new Promise((resolve) => {
        if (!db) return resolve();
        
        const tx = db.transaction(['segments'], 'readwrite');
        const store = tx.objectStore('segments');
        
        store.put({
            id: `${videoId}_${index}`,
            videoId: videoId,
            index: index,
            data: data
        });
        
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
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
            if (segments.length === 0) return resolve(null);
            
            segments.sort((a, b) => a.index - b.index);
            
            const totalSize = segments.reduce((sum, seg) => sum + seg.data.byteLength, 0);
            const combined = new Uint8Array(totalSize);
            let offset = 0;
            
            for (const segment of segments) {
                combined.set(new Uint8Array(segment.data), offset);
                offset += segment.data.byteLength;
            }
            
            resolve(URL.createObjectURL(new Blob([combined], { type: 'video/mp4' })));
        };
        
        request.onerror = () => resolve(null);
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
    item.querySelector('.connection-overlay').classList.remove('hidden');
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
        video.play().catch(() => {});
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
        
        const tx = db.transaction(['segments'], 'readwrite');
        const store = tx.objectStore('segments');
        
        store.clear();
        
        tx.oncomplete = () => {
            document.querySelectorAll('.video-item').forEach(item => {
                updateCacheDisplay(item, false);
            });
            resolve();
        };
        
        tx.onerror = () => resolve();
    });
}

window.togglePlay = togglePlay;
window.refresh = refresh;
window.clearCache = clearCache;
