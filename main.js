// HLS Video Segmentation Application
// Comprehensive implementation with segment management, caching, and analysis

class HLSSegmentationManager {
    constructor() {
        this.manifestUrl = 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8';
        this.hls = null;
        this.video = null;
        this.segments = new Map();
        this.cachedSegments = new Set();
        this.currentSegmentIndex = -1;
        this.segmentFilter = 'all';
        
        this.initDB();
        this.initElements();
        this.initHLS();
        this.bindEvents();
    }

    async initDB() {
        this.dbPromise = idb.openDB('HLSSegmentDB', 2, {
            upgrade(db, oldVersion) {
                if (!db.objectStoreNames.contains('segments')) {
                    db.createObjectStore('segments');
                }
                if (!db.objectStoreNames.contains('manifests')) {
                    db.createObjectStore('manifests');
                }
            }
        });
    }

    initElements() {
        this.video = document.getElementById('videoElement');
        this.hlsStatus = document.getElementById('hlsStatus');
        this.currentQuality = document.getElementById('currentQuality');
        this.segmentCount = document.getElementById('segmentCount');
        this.currentSegment = document.getElementById('currentSegment');
        this.segmentsList = document.getElementById('segmentsList');
        this.videoMessage = document.getElementById('videoMessage');
        this.networkStatus = document.getElementById('networkStatus');
    }

    initHLS() {
        if (Hls.isSupported()) {
            this.hls = new Hls({
                debug: true,
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: 90,
                maxBufferLength: 60,
                maxMaxBufferLength: 600,
                maxBufferSize: 60 * 1000 * 1000,
                maxBufferHole: 0.5,
                manifestLoadingTimeOut: 10000,
                manifestLoadingMaxRetry: 1,
                manifestLoadingRetryDelay: 1000,
                levelLoadingTimeOut: 10000,
                levelLoadingMaxRetry: 1,
                fragLoadingTimeOut: 20000,
                fragLoadingMaxRetry: 1,
                startLevel: -1,
                testBandwidth: true,
                progressive: false,
                enableSoftwareAES: true
            });

            this.bindHLSEvents();
            this.loadVideo();
        } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS support (Safari)
            this.video.src = this.manifestUrl;
            this.updateStatus('Native HLS support');
        } else {
            this.updateStatus('HLS not supported');
            console.error('HLS is not supported in this browser');
        }
    }

    bindHLSEvents() {
        // Manifest loaded
        this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
            console.log('Manifest parsed, found levels:', data.levels);
            this.updateStatus('Manifest loaded');
            this.updateQuality(data.levels[data.firstLevel]);
            this.analyzeManifest(data);
        });

        // Level loaded (playlist with segments)
        this.hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
            console.log('Level loaded:', data);
            this.processSegments(data.details);
        });

        // Fragment loaded
        this.hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
            console.log('Fragment loaded:', data.frag.url);
            this.onSegmentLoaded(data.frag);
        });

        // Fragment changed
        this.hls.on(Hls.Events.FRAG_CHANGED, (event, data) => {
            console.log('Fragment changed:', data.frag.url);
            this.updateCurrentSegment(data.frag);
        });

        // Error handling
        this.hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('HLS error:', data);
            if (data.fatal) {
                this.handleFatalError(data);
            }
        });

        // Buffer events
        this.hls.on(Hls.Events.BUFFER_APPENDED, (event, data) => {
            console.log('Buffer appended');
        });

        this.hls.on(Hls.Events.BUFFER_EOS, (event, data) => {
            console.log('Buffer end of stream');
        });
    }

    loadVideo() {
        this.hls.loadSource(this.manifestUrl);
        this.hls.attachMedia(this.video);
        
        this.video.addEventListener('loadedmetadata', () => {
            this.updateStatus('Video ready');
            this.videoMessage.textContent = 'HLS stream loaded successfully';
        });

        this.video.addEventListener('timeupdate', () => {
            this.updatePlaybackInfo();
        });
    }

    analyzeManifest(data) {
        const analysis = {
            levels: data.levels.length,
            qualities: data.levels.map(level => ({
                width: level.width,
                height: level.height,
                bitrate: level.bitrate,
                codec: level.videoCodec
            })),
            audioTracks: data.audioTracks ? data.audioTracks.length : 0,
            subtitleTracks: data.subtitleTracks ? data.subtitleTracks.length : 0
        };
        
        console.log('Stream analysis:', analysis);
        this.displayStreamAnalysis(analysis);
    }

    processSegments(levelDetails) {
        console.log('Processing segments from level details:', levelDetails);
        
        if (levelDetails && levelDetails.fragments) {
            levelDetails.fragments.forEach((fragment, index) => {
                const segmentInfo = {
                    index: index,
                    url: fragment.url,
                    duration: fragment.duration,
                    start: fragment.start,
                    level: fragment.level,
                    sn: fragment.sn,
                    cc: fragment.cc,
                    cached: this.cachedSegments.has(fragment.url),
                    size: null,
                    type: 'video'
                };
                
                this.segments.set(fragment.url, segmentInfo);
            });
            
            this.updateSegmentCount();
            this.displaySegments();
        }
    }

    onSegmentLoaded(fragment) {
        const segmentInfo = this.segments.get(fragment.url);
        if (segmentInfo) {
            segmentInfo.cached = true;
            segmentInfo.loadTime = Date.now();
            this.cachedSegments.add(fragment.url);
            this.displaySegments();
        }
    }

    updateCurrentSegment(fragment) {
        this.currentSegmentIndex = fragment.sn;
        const segmentInfo = this.segments.get(fragment.url);
        if (segmentInfo) {
            this.currentSegment.textContent = `${segmentInfo.index + 1} (${fragment.sn})`;
        }
    }

    updateStatus(status) {
        this.hlsStatus.textContent = status;
        this.hlsStatus.className = status.includes('error') ? 'text-red-400' : 
                                   status.includes('ready') || status.includes('loaded') ? 'text-green-400' : 
                                   'text-yellow-400';
    }

    updateQuality(level) {
        if (level) {
            this.currentQuality.textContent = `${level.width}x${level.height} (${Math.round(level.bitrate/1000)}kbps)`;
        }
    }

    updateSegmentCount() {
        const total = this.segments.size;
        const cached = this.cachedSegments.size;
        this.segmentCount.textContent = `${cached}/${total}`;
    }

    updatePlaybackInfo() {
        if (this.video && !this.video.paused) {
            // Update network status
            this.updateNetworkStatus();
        }
    }

    updateNetworkStatus() {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (connection) {
            const effectiveType = connection.effectiveType || 'unknown';
            const downlink = connection.downlink || 0;
            this.networkStatus.textContent = `Network: ${effectiveType} (${downlink}Mbps)`;
        }
    }

    displaySegments() {
        const filteredSegments = this.getFilteredSegments();
        
        if (filteredSegments.length === 0) {
            this.segmentsList.innerHTML = '<p class="text-gray-400 text-center text-sm">No segments match the current filter.</p>';
            return;
        }

        const segmentsHTML = filteredSegments.map((segment, index) => {
            const statusClass = segment.cached ? 'bg-green-600' : 'bg-gray-600';
            const statusText = segment.cached ? 'Cached' : 'Pending';
            const isCurrent = segment.sn === this.currentSegmentIndex;
            const currentClass = isCurrent ? 'ring-2 ring-blue-400' : '';
            
            return `
                <div class="bg-gray-800 rounded-lg p-3 mb-2 ${currentClass}">
                    <div class="flex justify-between items-center mb-2">
                        <span class="text-white font-medium">Segment ${segment.index + 1}</span>
                        <span class="px-2 py-1 rounded text-xs text-white ${statusClass}">${statusText}</span>
                    </div>
                    <div class="text-xs text-gray-400 space-y-1">
                        <p>Duration: ${segment.duration?.toFixed(2)}s</p>
                        <p>Start: ${segment.start?.toFixed(2)}s</p>
                        <p>SN: ${segment.sn}</p>
                        ${isCurrent ? '<p class="text-blue-400 font-bold">▶ Currently Playing</p>' : ''}
                    </div>
                    <div class="mt-2 flex gap-2">
                        <button class="download-segment-btn px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs rounded transition" 
                                data-url="${segment.url}">
                            Download
                        </button>
                        <button class="analyze-segment-btn px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition" 
                                data-url="${segment.url}">
                            Analyze
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        this.segmentsList.innerHTML = segmentsHTML;
        this.bindSegmentEvents();
    }

    getFilteredSegments() {
        const allSegments = Array.from(this.segments.values());
        
        switch (this.segmentFilter) {
            case 'cached':
                return allSegments.filter(segment => segment.cached);
            case 'pending':
                return allSegments.filter(segment => !segment.cached);
            default:
                return allSegments;
        }
    }

    bindSegmentEvents() {
        // Download segment buttons
        document.querySelectorAll('.download-segment-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const url = e.target.dataset.url;
                this.downloadSegment(url);
            });
        });

        // Analyze segment buttons
        document.querySelectorAll('.analyze-segment-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const url = e.target.dataset.url;
                this.analyzeSegment(url);
            });
        });
    }

    async downloadSegment(url) {
        try {
            console.log('Downloading segment:', url);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const blob = await response.blob();
            const downloadUrl = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `segment_${Date.now()}.ts`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(downloadUrl);
            
            // Cache the segment
            const db = await this.dbPromise;
            await db.put('segments', await blob.arrayBuffer(), url);
            this.cachedSegments.add(url);
            
            console.log('Segment downloaded and cached:', url);
            this.displaySegments();
        } catch (error) {
            console.error('Failed to download segment:', error);
            alert('Failed to download segment: ' + error.message);
        }
    }

    async analyzeSegment(url) {
        try {
            const response = await fetch(url, { method: 'HEAD' });
            const size = response.headers.get('content-length');
            const type = response.headers.get('content-type');
            
            const segment = this.segments.get(url);
            if (segment) {
                const analysis = {
                    url: url,
                    size: size ? parseInt(size) : 'Unknown',
                    type: type || 'Unknown',
                    duration: segment.duration,
                    bitrate: size && segment.duration ? Math.round((parseInt(size) * 8) / segment.duration / 1000) : 'Unknown'
                };
                
                alert(`Segment Analysis:\n\nURL: ${analysis.url}\nSize: ${analysis.size} bytes\nType: ${analysis.type}\nDuration: ${analysis.duration}s\nEstimated Bitrate: ${analysis.bitrate} kbps`);
            }
        } catch (error) {
            console.error('Failed to analyze segment:', error);
            alert('Failed to analyze segment: ' + error.message);
        }
    }

    async preloadSegments(count = 5) {
        const segments = Array.from(this.segments.values()).slice(0, count);
        const total = segments.length;
        let completed = 0;

        this.videoMessage.textContent = `Preloading ${total} segments...`;

        for (const segment of segments) {
            try {
                if (!segment.cached) {
                    console.log(`Preloading segment ${completed + 1}/${total}:`, segment.url);
                    const response = await fetch(segment.url);
                    if (response.ok) {
                        const data = await response.arrayBuffer();
                        const db = await this.dbPromise;
                        await db.put('segments', data, segment.url);
                        segment.cached = true;
                        this.cachedSegments.add(segment.url);
                    }
                }
                completed++;
                this.videoMessage.textContent = `Preloaded ${completed}/${total} segments`;
            } catch (error) {
                console.error('Failed to preload segment:', segment.url, error);
            }
        }

        this.updateSegmentCount();
        this.displaySegments();
        this.videoMessage.textContent = `Preloading complete: ${completed}/${total} segments cached`;
    }

    async clearCache() {
        try {
            const db = await this.dbPromise;
            await db.clear('segments');
            await db.clear('manifests');
            this.cachedSegments.clear();
            
            // Update segment cache status
            this.segments.forEach(segment => {
                segment.cached = false;
            });
            
            this.updateSegmentCount();
            this.displaySegments();
            this.videoMessage.textContent = 'Cache cleared successfully';
            console.log('Cache cleared');
        } catch (error) {
            console.error('Failed to clear cache:', error);
            this.videoMessage.textContent = 'Failed to clear cache';
        }
    }

    displayStreamAnalysis(analysis) {
        console.log('Stream Analysis:', analysis);
        // You can extend this to show more detailed analysis in the UI
    }

    handleFatalError(data) {
        switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
                this.updateStatus('Network error - attempting recovery');
                this.hls.startLoad();
                break;
            case Hls.ErrorTypes.MEDIA_ERROR:
                this.updateStatus('Media error - attempting recovery');
                this.hls.recoverMediaError();
                break;
            default:
                this.updateStatus('Fatal error occurred');
                break;
        }
    }

    bindEvents() {
        // Preload button
        document.getElementById('preloadBtn').addEventListener('click', () => {
            this.preloadSegments();
        });

        // Analyze button
        document.getElementById('analyzeBtn').addEventListener('click', () => {
            this.analyzeCurrentStream();
        });

        // Download segment button (main)
        document.getElementById('downloadSegmentBtn').addEventListener('click', () => {
            if (this.currentSegmentIndex >= 0) {
                const currentSegment = Array.from(this.segments.values()).find(s => s.sn === this.currentSegmentIndex);
                if (currentSegment) {
                    this.downloadSegment(currentSegment.url);
                }
            } else {
                alert('No segment is currently playing');
            }
        });

        // Clear cache button
        document.getElementById('clearCacheButton').addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all cached segments?')) {
                this.clearCache();
            }
        });

        // Refresh segments button
        document.getElementById('refreshSegments').addEventListener('click', () => {
            this.displaySegments();
        });

        // Filter buttons
        document.getElementById('showAllSegments').addEventListener('click', () => {
            this.segmentFilter = 'all';
            this.displaySegments();
        });

        document.getElementById('showCachedSegments').addEventListener('click', () => {
            this.segmentFilter = 'cached';
            this.displaySegments();
        });

        document.getElementById('showPendingSegments').addEventListener('click', () => {
            this.segmentFilter = 'pending';
            this.displaySegments();
        });

        // Navigation buttons
        document.getElementById('prevButton').addEventListener('click', () => {
            this.video.currentTime = Math.max(0, this.video.currentTime - 10);
        });

        document.getElementById('nextButton').addEventListener('click', () => {
            this.video.currentTime = Math.min(this.video.duration, this.video.currentTime + 10);
        });
    }

    analyzeCurrentStream() {
        if (!this.hls) {
            alert('HLS not initialized');
            return;
        }

        const levels = this.hls.levels;
        const currentLevel = this.hls.currentLevel;
        const loadLevel = this.hls.loadLevel;
        const nextLevel = this.hls.nextLevel;
        
        const analysis = {
            totalLevels: levels.length,
            currentLevel: currentLevel,
            loadLevel: loadLevel,
            nextLevel: nextLevel,
            autoLevelEnabled: this.hls.autoLevelEnabled,
            totalSegments: this.segments.size,
            cachedSegments: this.cachedSegments.size,
            currentTime: this.video.currentTime,
            duration: this.video.duration,
            buffered: this.video.buffered.length > 0 ? {
                start: this.video.buffered.start(0),
                end: this.video.buffered.end(0)
            } : null
        };

        const analysisText = `
HLS Stream Analysis:

Quality Levels: ${analysis.totalLevels}
Current Level: ${analysis.currentLevel}
Load Level: ${analysis.loadLevel}
Next Level: ${analysis.nextLevel}
Auto Level: ${analysis.autoLevelEnabled}

Segments:
- Total: ${analysis.totalSegments}
- Cached: ${analysis.cachedSegments}
- Cache Ratio: ${((analysis.cachedSegments / analysis.totalSegments) * 100).toFixed(1)}%

Playback:
- Current Time: ${analysis.currentTime.toFixed(2)}s
- Duration: ${analysis.duration ? analysis.duration.toFixed(2) + 's' : 'Unknown'}
- Buffer: ${analysis.buffered ? `${analysis.buffered.start.toFixed(2)}s - ${analysis.buffered.end.toFixed(2)}s` : 'No buffer'}
        `;

        alert(analysisText);
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.hlsManager = new HLSSegmentationManager();
});
