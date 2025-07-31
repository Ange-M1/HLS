// HLS Video Segmentation and Streaming Implementation
class HLSVideoSegmentation {
  constructor() {
    this.manifestUrl = 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8';
    this.hls = null;
    this.video = null;
    this.currentSegments = [];
    this.cachedSegments = new Map();
    this.qualityLevels = [];
    this.currentQuality = -1; // -1 for auto
    this.segmentCache = null;
    this.preloadBuffer = 3; // Number of segments to preload ahead
    this.maxCacheSize = 100; // Maximum number of segments to cache
    
    this.initDB();
    this.initPlayer();
    this.setupEventListeners();
  }

  async initDB() {
    try {
      this.segmentCache = await idb.openDB('HLSSegmentCache', 2, {
        upgrade(db, oldVersion) {
          if (oldVersion < 1) {
            const segmentStore = db.createObjectStore('segments', { keyPath: 'url' });
            segmentStore.createIndex('timestamp', 'timestamp');
          }
          if (oldVersion < 2) {
            const manifestStore = db.createObjectStore('manifests', { keyPath: 'url' });
            manifestStore.createIndex('timestamp', 'timestamp');
          }
        }
      });
      console.log('✅ IndexedDB initialized');
    } catch (error) {
      console.error('❌ Failed to initialize IndexedDB:', error);
    }
  }

  initPlayer() {
    this.video = document.getElementById('videoElement');
    
    if (Hls.isSupported()) {
      this.hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 30,
        maxBufferSize: 60 * 1000 * 1000, // 60MB
        maxBufferHole: 0.5,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 3,
        maxLoadingDelay: 4,
        maxFragLookUpTolerance: 0.25,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: Infinity,
        liveDurationInfinity: false,
        enableSoftwareAES: true,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 1,
        manifestLoadingRetryDelay: 1000,
        levelLoadingTimeOut: 10000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 1000,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,
        startFragPrefetch: true,
        testBandwidth: true
      });

      this.setupHLSEventListeners();
      this.loadStream();
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS support
      this.video.src = this.manifestUrl;
      this.setupNativeHLSListeners();
    } else {
      this.showError('HLS is not supported in this browser');
    }
  }

  setupHLSEventListeners() {
    // Manifest loaded - extract quality levels
    this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      console.log('📋 Manifest parsed');
      this.qualityLevels = data.levels;
      this.updateQualitySelector();
      this.cacheManifest(this.manifestUrl, data);
      this.updateVideoTitle(`Stream loaded (${this.qualityLevels.length} quality levels)`);
    });

    // Fragment (segment) loading
    this.hls.on(Hls.Events.FRAG_LOADING, (event, data) => {
      console.log(`⬇️ Loading segment: ${data.frag.url}`);
      this.preloadUpcomingSegments(data.frag);
    });

    // Fragment loaded successfully
    this.hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
      console.log(`✅ Segment loaded: ${data.frag.url} (${(data.payload.byteLength / 1024).toFixed(1)}KB)`);
      this.cacheSegment(data.frag.url, data.payload, data.frag);
      this.updateCachedVideosList();
    });

    // Level switched (quality change)
    this.hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
      const level = this.qualityLevels[data.level];
      console.log(`🔄 Quality switched to: ${level.height}p (${(level.bitrate / 1000).toFixed(0)}kbps)`);
      this.updateNetworkStatus(`Quality: ${level.height}p`);
    });

    // Error handling
    this.hls.on(Hls.Events.ERROR, (event, data) => {
      console.error('❌ HLS Error:', data);
      if (data.fatal) {
        this.handleFatalError(data);
      }
    });

    // Buffer events
    this.hls.on(Hls.Events.BUFFER_APPENDED, (event, data) => {
      this.updateBufferInfo();
    });

    this.hls.on(Hls.Events.BUFFER_EOS, (event, data) => {
      console.log('📺 End of stream reached');
    });
  }

  setupNativeHLSListeners() {
    this.video.addEventListener('loadedmetadata', () => {
      console.log('📋 Native HLS metadata loaded');
      this.updateVideoTitle('Stream loaded (Native HLS)');
    });

    this.video.addEventListener('error', (e) => {
      console.error('❌ Native HLS Error:', e);
      this.showError('Failed to load video stream');
    });
  }

  setupEventListeners() {
    // Network status monitoring
    window.addEventListener('online', () => this.updateNetworkStatus('Online'));
    window.addEventListener('offline', () => this.updateNetworkStatus('Offline'));

    // Quality selector
    document.addEventListener('DOMContentLoaded', () => {
      this.createQualitySelector();
      this.createSegmentControls();
      this.loadAvailableVideos();
    });

    // Navigation buttons
    document.getElementById('prevButton')?.addEventListener('click', () => this.seekToPreviousSegment());
    document.getElementById('nextButton')?.addEventListener('click', () => this.seekToNextSegment());
    
    // Clear cache button
    document.getElementById('clearCacheButton')?.addEventListener('click', () => this.clearCache());
    
    // Upload form
    document.getElementById('uploadForm')?.addEventListener('submit', (e) => this.handleVideoUpload(e));
    
    // Refresh videos button
    document.getElementById('refreshVideosButton')?.addEventListener('click', () => this.loadAvailableVideos());

    // Video time update for segment tracking
    if (this.video) {
      this.video.addEventListener('timeupdate', () => this.onTimeUpdate());
      this.video.addEventListener('seeking', () => this.onSeeking());
      this.video.addEventListener('seeked', () => this.onSeeked());
    }
  }

  loadStream() {
    this.showLoading(true);
    this.hls.loadSource(this.manifestUrl);
    this.hls.attachMedia(this.video);
    
    this.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      console.log('📺 Media attached');
      this.showLoading(false);
    });
  }

  async cacheManifest(url, data) {
    if (!this.segmentCache) return;
    
    try {
      await this.segmentCache.put('manifests', {
        url,
        data,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Failed to cache manifest:', error);
    }
  }

  async cacheSegment(url, data, fragment) {
    if (!this.segmentCache) return;
    
    try {
      const segmentData = {
        url,
        data,
        size: data.byteLength,
        duration: fragment.duration,
        level: fragment.level,
        sn: fragment.sn,
        timestamp: Date.now()
      };

      await this.segmentCache.put('segments', segmentData);
      this.cachedSegments.set(url, segmentData);
      
      // Clean up old segments if cache is full
      await this.cleanupCache();
    } catch (error) {
      console.error('Failed to cache segment:', error);
    }
  }

  async cleanupCache() {
    if (!this.segmentCache) return;
    
    const tx = this.segmentCache.transaction('segments', 'readwrite');
    const store = tx.objectStore('segments');
    const count = await store.count();
    
    if (count > this.maxCacheSize) {
      const index = store.index('timestamp');
      const oldestSegments = await index.getAll(null, count - this.maxCacheSize);
      
      for (const segment of oldestSegments) {
        await store.delete(segment.url);
        this.cachedSegments.delete(segment.url);
      }
      
      console.log(`🧹 Cleaned up ${oldestSegments.length} old segments`);
    }
  }

  async preloadUpcomingSegments(currentFragment) {
    if (!this.hls) return;
    
    const currentLevel = this.hls.levels[currentFragment.level];
    if (!currentLevel) return;
    
    const currentSegmentIndex = currentFragment.sn;
    const segments = currentLevel.details?.fragments || [];
    
    // Preload next few segments
    for (let i = 1; i <= this.preloadBuffer; i++) {
      const nextIndex = currentSegmentIndex + i;
      if (nextIndex < segments.length) {
        const nextSegment = segments[nextIndex];
        if (nextSegment && !this.cachedSegments.has(nextSegment.url)) {
          this.preloadSegment(nextSegment.url);
        }
      }
    }
  }

  async preloadSegment(url) {
    try {
      console.log(`⏳ Preloading segment: ${url}`);
      const response = await fetch(url);
      const data = await response.arrayBuffer();
      
      // Cache the preloaded segment
      if (this.segmentCache) {
        await this.segmentCache.put('segments', {
          url,
          data,
          size: data.byteLength,
          timestamp: Date.now(),
          preloaded: true
        });
        this.cachedSegments.set(url, { url, data, size: data.byteLength });
      }
    } catch (error) {
      console.error(`Failed to preload segment ${url}:`, error);
    }
  }

  createQualitySelector() {
    const container = document.getElementById('videoPlayerContainer');
    if (!container) return;

    const qualityControl = document.createElement('div');
    qualityControl.className = 'mt-4 flex items-center space-x-2';
    qualityControl.innerHTML = `
      <label class="text-white text-sm font-medium">Quality:</label>
      <select id="qualitySelector" class="bg-gray-700 text-white rounded px-2 py-1 text-sm">
        <option value="-1">Auto</option>
      </select>
    `;
    container.appendChild(qualityControl);

    const selector = document.getElementById('qualitySelector');
    selector.addEventListener('change', (e) => {
      this.setQuality(parseInt(e.target.value));
    });
  }

  createSegmentControls() {
    const container = document.getElementById('videoPlayerContainer');
    if (!container) return;

    const segmentInfo = document.createElement('div');
    segmentInfo.className = 'mt-4 text-center';
    segmentInfo.innerHTML = `
      <div class="bg-gray-800 rounded-lg p-3">
        <div class="text-sm text-gray-300 mb-2">Segment Information</div>
        <div id="currentSegmentInfo" class="text-xs text-gray-400">-</div>
        <div id="bufferInfo" class="text-xs text-gray-400 mt-1">-</div>
        <div class="mt-2 flex justify-center space-x-2">
          <button id="segmentPrevBtn" class="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded">Prev Segment</button>
          <button id="segmentNextBtn" class="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded">Next Segment</button>
        </div>
      </div>
    `;
    container.appendChild(segmentInfo);

    document.getElementById('segmentPrevBtn')?.addEventListener('click', () => this.seekToPreviousSegment());
    document.getElementById('segmentNextBtn')?.addEventListener('click', () => this.seekToNextSegment());
  }

  updateQualitySelector() {
    const selector = document.getElementById('qualitySelector');
    if (!selector || !this.qualityLevels) return;

    // Clear existing options except auto
    while (selector.children.length > 1) {
      selector.removeChild(selector.lastChild);
    }

    // Add quality options
    this.qualityLevels.forEach((level, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = `${level.height}p (${(level.bitrate / 1000).toFixed(0)}kbps)`;
      selector.appendChild(option);
    });
  }

  setQuality(levelIndex) {
    if (!this.hls) return;
    
    this.currentQuality = levelIndex;
    this.hls.currentLevel = levelIndex;
    
    const qualityText = levelIndex === -1 ? 'Auto' : 
      `${this.qualityLevels[levelIndex].height}p`;
    console.log(`🎯 Quality set to: ${qualityText}`);
  }

  onTimeUpdate() {
    this.updateCurrentSegmentInfo();
    this.updateBufferInfo();
  }

  onSeeking() {
    this.showLoading(true);
  }

  onSeeked() {
    this.showLoading(false);
    this.updateCurrentSegmentInfo();
  }

  updateCurrentSegmentInfo() {
    const infoElement = document.getElementById('currentSegmentInfo');
    if (!infoElement || !this.hls || !this.video) return;

    const currentTime = this.video.currentTime;
    const duration = this.video.duration;
    const level = this.hls.levels[this.hls.currentLevel];
    
    if (level && level.details) {
      const fragments = level.details.fragments;
      const currentFragment = fragments.find(frag => 
        currentTime >= frag.start && currentTime < frag.start + frag.duration
      );

      if (currentFragment) {
        infoElement.textContent = `Segment ${currentFragment.sn + 1}/${fragments.length} | ${currentTime.toFixed(1)}s / ${duration.toFixed(1)}s`;
      }
    }
  }

  updateBufferInfo() {
    const bufferElement = document.getElementById('bufferInfo');
    if (!bufferElement || !this.video) return;

    const buffered = this.video.buffered;
    const currentTime = this.video.currentTime;
    
    if (buffered.length > 0) {
      // Find the buffer range containing current time
      for (let i = 0; i < buffered.length; i++) {
        if (currentTime >= buffered.start(i) && currentTime <= buffered.end(i)) {
          const bufferAhead = buffered.end(i) - currentTime;
          bufferElement.textContent = `Buffer: ${bufferAhead.toFixed(1)}s ahead`;
          return;
        }
      }
    }
    
    bufferElement.textContent = 'Buffer: 0s ahead';
  }

  seekToPreviousSegment() {
    if (!this.hls || !this.video) return;
    
    const level = this.hls.levels[this.hls.currentLevel];
    if (!level || !level.details) return;
    
    const fragments = level.details.fragments;
    const currentTime = this.video.currentTime;
    
    // Find current segment and go to previous
    for (let i = fragments.length - 1; i >= 0; i--) {
      if (fragments[i].start < currentTime - 0.1) {
        const targetSegment = fragments[Math.max(0, i - 1)];
        this.video.currentTime = targetSegment.start;
        break;
      }
    }
  }

  seekToNextSegment() {
    if (!this.hls || !this.video) return;
    
    const level = this.hls.levels[this.hls.currentLevel];
    if (!level || !level.details) return;
    
    const fragments = level.details.fragments;
    const currentTime = this.video.currentTime;
    
    // Find current segment and go to next
    for (let i = 0; i < fragments.length; i++) {
      if (fragments[i].start > currentTime + 0.1) {
        this.video.currentTime = fragments[i].start;
        break;
      }
    }
  }

  async updateCachedVideosList() {
    const listElement = document.getElementById('cachedVideosList');
    if (!listElement) return;

    if (this.cachedSegments.size === 0) {
      listElement.innerHTML = '<p class="text-gray-400 text-center text-sm">No segments cached yet.</p>';
      return;
    }

    const totalSize = Array.from(this.cachedSegments.values())
      .reduce((sum, segment) => sum + (segment.size || 0), 0);

    listElement.innerHTML = `
      <div class="col-span-full text-center mb-4">
        <p class="text-green-400 text-sm">${this.cachedSegments.size} segments cached (${(totalSize / 1024 / 1024).toFixed(1)}MB)</p>
      </div>
      ${Array.from(this.cachedSegments.values()).slice(0, 10).map(segment => `
        <div class="bg-gray-700 rounded p-3">
          <div class="text-sm text-white font-medium">Segment ${segment.sn || '?'}</div>
          <div class="text-xs text-gray-400">${(segment.size / 1024).toFixed(1)}KB</div>
          ${segment.duration ? `<div class="text-xs text-gray-400">${segment.duration.toFixed(1)}s</div>` : ''}
        </div>
      `).join('')}
      ${this.cachedSegments.size > 10 ? `<div class="col-span-full text-center text-xs text-gray-400">...and ${this.cachedSegments.size - 10} more</div>` : ''}
    `;
  }

  async clearCache() {
    if (!this.segmentCache) return;
    
    try {
      const tx = this.segmentCache.transaction(['segments', 'manifests'], 'readwrite');
      await tx.objectStore('segments').clear();
      await tx.objectStore('manifests').clear();
      await tx.done;
      
      this.cachedSegments.clear();
      this.updateCachedVideosList();
      console.log('🧹 Cache cleared successfully');
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  }

  handleFatalError(data) {
    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        console.error('Network error, trying to recover...');
        this.hls.startLoad();
        break;
      case Hls.ErrorTypes.MEDIA_ERROR:
        console.error('Media error, trying to recover...');
        this.hls.recoverMediaError();
        break;
      default:
        console.error('Fatal error, cannot recover');
        this.showError('Playback failed');
        break;
    }
  }

  showLoading(show) {
    const overlay = document.getElementById('videoLoadingOverlay');
    if (overlay) {
      overlay.classList.toggle('hidden', !show);
    }
  }

  showError(message) {
    const messageElement = document.getElementById('videoMessage');
    if (messageElement) {
      messageElement.textContent = message;
      messageElement.className = 'mt-4 text-red-400 text-sm text-center';
    }
  }

  updateVideoTitle(title) {
    const titleElement = document.getElementById('videoTitle');
    if (titleElement) {
      titleElement.textContent = title;
    }
  }

  updateNetworkStatus(status, message = '') {
    const statusElement = document.getElementById('networkStatus');
    const messageElement = document.getElementById('networkMessage');
    
    if (statusElement) {
      statusElement.textContent = `Network Status: ${status}`;
      statusElement.className = status === 'Online' ? 
        'text-lg font-medium text-green-400' : 
        'text-lg font-medium text-red-400';
    }
    
    if (messageElement) {
      messageElement.textContent = message;
    }
  }

  async handleVideoUpload(event) {
    event.preventDefault();
    
    const formData = new FormData();
    const videoFile = document.getElementById('videoFile').files[0];
    const segmentDuration = document.getElementById('segmentDuration').value;
    const outputName = document.getElementById('outputName').value;
    
    if (!videoFile) {
      alert('Please select a video file');
      return;
    }
    
    formData.append('video', videoFile);
    formData.append('segmentDuration', segmentDuration);
    formData.append('outputName', outputName || videoFile.name.split('.')[0]);
    
    const uploadProgress = document.getElementById('uploadProgress');
    const progressBar = document.getElementById('progressBar');
    const uploadStatus = document.getElementById('uploadStatus');
    const uploadBtn = document.getElementById('uploadBtn');
    
    try {
      uploadProgress.classList.remove('hidden');
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Processing...';
      
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          progressBar.style.width = percentComplete + '%';
          uploadStatus.textContent = `Uploading: ${percentComplete.toFixed(1)}%`;
        }
      });
      
      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          const response = JSON.parse(xhr.responseText);
          uploadStatus.textContent = 'Segmentation completed successfully!';
          progressBar.style.width = '100%';
          progressBar.className = 'bg-green-600 h-2 rounded-full transition-all duration-300';
          
          // Reset form
          document.getElementById('uploadForm').reset();
          
          // Refresh video list
          setTimeout(() => {
            this.loadAvailableVideos();
            uploadProgress.classList.add('hidden');
            uploadBtn.disabled = false;
            uploadBtn.textContent = 'Upload & Segment Video';
            progressBar.className = 'bg-blue-600 h-2 rounded-full transition-all duration-300';
          }, 2000);
          
        } else {
          throw new Error('Upload failed');
        }
      });
      
      xhr.addEventListener('error', () => {
        uploadStatus.textContent = 'Upload failed. Please try again.';
        progressBar.className = 'bg-red-600 h-2 rounded-full transition-all duration-300';
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload & Segment Video';
      });
      
      xhr.open('POST', '/api/upload');
      xhr.send(formData);
      
    } catch (error) {
      console.error('Upload error:', error);
      uploadStatus.textContent = 'Upload failed. Please try again.';
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload & Segment Video';
    }
  }

  async loadAvailableVideos() {
    try {
      const response = await fetch('/api/videos');
      const data = await response.json();
      
      const videosList = document.getElementById('availableVideosList');
      if (!videosList) return;
      
      if (data.videos.length === 0) {
        videosList.innerHTML = '<p class="text-gray-400 text-center text-sm">No HLS streams available yet.</p>';
        return;
      }
      
      videosList.innerHTML = data.videos.map(video => `
        <div class="bg-gray-700 rounded-lg p-4">
          <div class="flex justify-between items-start mb-2">
            <h3 class="text-lg font-semibold text-white">${video.name}</h3>
            <button onclick="window.hlsPlayer.deleteVideo('${video.id}')" 
                    class="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded">
              Delete
            </button>
          </div>
          <div class="text-sm text-gray-300 mb-2">
            Quality levels: ${video.qualities.map(q => q.name).join(', ')}
          </div>
          <div class="text-xs text-gray-400 mb-3">
            Created: ${new Date(video.createdAt).toLocaleString()}
          </div>
          <button onclick="window.hlsPlayer.loadVideoStream('${video.masterPlaylistUrl}')" 
                  class="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm">
            Load Stream
          </button>
        </div>
      `).join('');
      
    } catch (error) {
      console.error('Failed to load videos:', error);
    }
  }

  async deleteVideo(videoId) {
    if (!confirm('Are you sure you want to delete this video?')) {
      return;
    }
    
    try {
      const response = await fetch(`/api/videos/${videoId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        this.loadAvailableVideos();
      } else {
        alert('Failed to delete video');
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('Failed to delete video');
    }
  }

  loadVideoStream(manifestUrl) {
    this.manifestUrl = manifestUrl;
    if (this.hls) {
      this.hls.destroy();
    }
    this.initPlayer();
  }
}

// Initialize the HLS Video Segmentation system
document.addEventListener('DOMContentLoaded', () => {
  window.hlsPlayer = new HLSVideoSegmentation();
});

// Export for potential module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HLSVideoSegmentation;
}
