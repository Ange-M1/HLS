// Mock video data
const MOCK_VIDEOS = [
    { id: 'v1', title: 'Funny Cat Compilation', src: 'https://www.learningcontainer.com/wp-content/uploads/2020/05/sample-mp4-file.mp4' },
    { id: 'v2', title: 'Amazing Nature Scenes', src: 'https://www.learningcontainer.com/wp-content/uploads/2020/05/sample-mp4-file.mp4' },
    { id: 'v3', title: 'Tech Gadget Review', src: 'https://www.learningcontainer.com/wp-content/uploads/2020/05/sample-mp4-file.mp4' },
    { id: 'v4', title: 'Cooking Tutorial', src: 'https://www.learningcontainer.com/wp-content/uploads/2020/05/sample-mp4-file.mp4' },
    { id: 'v5', title: 'Travel Vlog Highlights', src: 'https://www.learningcontainer.com/wp-content/uploads/2020/05/sample-mp4-file.mp4' },
];

// Global state variables
let currentVideoIndex = 0;
let isOnline = navigator.onLine;
let db; // IndexedDB instance

// DOM Elements
const networkStatusElem = document.getElementById('networkStatus');
const networkMessageElem = document.getElementById('networkMessage');
const videoTitleElem = document.getElementById('videoTitle');
const videoElement = document.getElementById('videoElement');
const videoLoadingOverlay = document.getElementById('videoLoadingOverlay');
const videoMessageElem = document.getElementById('videoMessage');
const noVideoSourceElem = document.getElementById('noVideoSource');
const cachedVideosListElem = document.getElementById('cachedVideosList');
const prevButton = document.getElementById('prevButton');
const nextButton = document.getElementById('nextButton');
const clearCacheButton = document.getElementById('clearCacheButton');

// --- IndexedDB Functions ---

/**
 * Opens the IndexedDB database.
 * @returns {Promise<IDBDatabase>} A promise that resolves with the database instance.
 */
function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('VideoCacheDB', 1);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            // Create an object store to hold video segments
            if (!db.objectStoreNames.contains('videoSegments')) {
                db.createObjectStore('videoSegments', { keyPath: 'id' });
                console.log('IndexedDB object store created/upgraded.');
            }
            // No explicit resolve here. onsuccess will handle it after the upgrade transaction commits.
        };

        request.onsuccess = (event) => {
            db = event.target.result; // Assign to global db variable
            console.log('IndexedDB opened successfully.');
            resolve(db); // Always resolve the promise here
        };

        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.errorCode);
            reject('Error opening IndexedDB');
        };
    });
}

/**
 * Stores a video segment (ArrayBuffer) in IndexedDB.
 * @param {string} videoId - The ID of the video.
 * @param {ArrayBuffer} data - The video segment data as an ArrayBuffer.
 * @returns {Promise<void>}
 */
function storeSegmentInIndexedDB(videoId, data) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error('IndexedDB not initialized when trying to store segment.');
            return reject('IndexedDB not initialized.');
        }
        const transaction = db.transaction(['videoSegments'], 'readwrite');
        const store = transaction.objectStore('videoSegments');
        const request = store.put({ id: videoId, data: data });

        request.onsuccess = () => {
            console.log(`Video segment ${videoId} stored in IndexedDB.`);
            resolve();
        };

        request.onerror = (event) => {
            console.error(`Error storing segment ${videoId} in IndexedDB:`, event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Retrieves a video segment (ArrayBuffer) from IndexedDB.
 * @param {string} videoId - The ID of the video.
 * @returns {Promise<ArrayBuffer|null>} A promise that resolves with the ArrayBuffer data or null if not found.
 */
function getSegmentFromIndexedDB(videoId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error('IndexedDB not initialized when trying to get segment.');
            return resolve(null); // Resolve with null if DB not ready, as it means not cached
        }
        const transaction = db.transaction(['videoSegments'], 'readonly');
        const store = transaction.objectStore('videoSegments');
        const request = store.get(videoId);

        request.onsuccess = () => {
            if (request.result) {
                console.log(`Video segment ${videoId} retrieved from IndexedDB.`);
                resolve(request.result.data);
            } else {
                console.log(`Video segment ${videoId} not found in IndexedDB.`);
                resolve(null);
            }
        };

        request.onerror = (event) => {
            console.error(`Error retrieving segment ${videoId} from IndexedDB:`, event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Deletes a video segment from IndexedDB.
 * @param {string} videoId - The ID of the video to delete.
 * @returns {Promise<void>}
 */
function deleteSegmentFromIndexedDB(videoId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error('IndexedDB not initialized when trying to delete segment.');
            return reject('IndexedDB not initialized.');
        }
        const transaction = db.transaction(['videoSegments'], 'readwrite');
        const store = transaction.objectStore('videoSegments');
        const request = store.delete(videoId);

        request.onsuccess = () => {
            console.log(`Video segment ${videoId} deleted from IndexedDB.`);
            resolve();
        };

        request.onerror = (event) => {
            console.error(`Error deleting segment ${videoId} from IndexedDB:`, event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Clears all video segments from IndexedDB.
 * @returns {Promise<void>}
 */
function clearAllSegmentsFromIndexedDB() {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error('IndexedDB not initialized when trying to clear all segments.');
            return reject('IndexedDB not initialized.');
        }
        const transaction = db.transaction(['videoSegments'], 'readwrite');
        const store = transaction.objectStore('videoSegments');
        const request = store.clear();

        request.onsuccess = () => {
            console.log('All video segments cleared from IndexedDB.');
            resolve();
        };

        request.onerror = (event) => {
            console.error('Error clearing IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Retrieves all video IDs from IndexedDB.
 * @returns {Promise<string[]>} A promise that resolves with an array of video IDs.
 */
function getAllCachedVideoIds() {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error('IndexedDB not initialized when trying to get all cached IDs.');
            return resolve([]); // Resolve with empty array if DB not ready
        }
        const transaction = db.transaction(['videoSegments'], 'readonly');
        const store = transaction.objectStore('videoSegments');
        const request = store.getAllKeys();

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = (event) => {
            console.error('Error getting all keys from IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });
}

// --- Core Application Logic ---

/**
 * Updates the network status display.
 */
function updateNetworkStatusDisplay() {
    networkStatusElem.textContent = `Network Status: ${isOnline ? 'Online' : 'Offline'}`;
    networkStatusElem.classList.toggle('text-green-400', isOnline);
    networkStatusElem.classList.toggle('text-red-400', !isOnline);
}

/**
 * Simulates fetching a small initial chunk of a video and stores it in IndexedDB.
 * @param {object} video - The video object to pre-load.
 * @returns {Promise<string|null>} A Promise that resolves with the Blob URL or null if failed.
 */
async function preloadInitialSegment(video) {
    // Check IndexedDB first
    const cachedData = await getSegmentFromIndexedDB(video.id);
    if (cachedData) {
        console.log(`Video ${video.id} initial segment found in IndexedDB.`);
        return URL.createObjectURL(new Blob([cachedData], { type: 'video/mp4' }));
    }

    if (!isOnline) {
        console.log(`Cannot pre-load ${video.id}: Offline.`);
        return null;
    }

    console.log(`Pre-loading initial segment for video: ${video.id}`);
    try {
        const response = await fetch(video.src, {
            headers: {
                'Range': 'bytes=0-102400' // Fetch first 100KB as a "segment"
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer(); // Convert Blob to ArrayBuffer for IndexedDB
        await storeSegmentInIndexedDB(video.id, arrayBuffer); // Store in IndexedDB

        const blobUrl = URL.createObjectURL(blob);
        console.log(`Pre-loaded ${video.id} initial segment into cache.`);
        updateCachedVideosList(); // Update the UI list
        return blobUrl;
    } catch (error) {
        console.error(`Error pre-loading initial segment for ${video.id}:`, error);
        return null;
    }
}

/**
 * Fetches the full video.
 * @param {object} video - The video object to fetch.
 * @returns {Promise<string|null>} A Promise that resolves with the Blob URL or null if failed.
 */
async function fetchFullVideo(video) {
    if (!isOnline) {
        console.log(`Cannot fetch full video ${video.id}: Offline.`);
        return null;
    }

    console.log(`Fetching full video: ${video.id}`);
    try {
        const response = await fetch(video.src);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    } catch (error) {
        console.error(`Error fetching full video ${video.id}:`, error);
        return null;
    }
}

/**
 * Loads and plays the current video.
 * Handles cached segments and full streaming based on network status.
 */
async function loadVideoPlayer() {
    const video = MOCK_VIDEOS[currentVideoIndex];
    if (!video) {
        videoTitleElem.textContent = 'No Video';
        videoElement.src = '';
        videoElement.classList.add('hidden');
        noVideoSourceElem.classList.remove('hidden');
        videoMessageElem.textContent = 'No videos to display.';
        return;
    }

    videoTitleElem.textContent = video.title;
    videoMessageElem.textContent = '';
    videoLoadingOverlay.classList.remove('hidden');
    noVideoSourceElem.classList.add('hidden');
    videoElement.classList.remove('hidden');
    videoElement.pause(); // Pause current video before changing source

    // Try to play from IndexedDB cache first
    const cachedData = await getSegmentFromIndexedDB(video.id);
    if (cachedData) {
        const cachedUrl = URL.createObjectURL(new Blob([cachedData], { type: 'video/mp4' }));
        console.log(`Playing initial segment of ${video.id} from IndexedDB cache.`);
        videoElement.src = cachedUrl;
        videoElement.load();
        videoElement.play();
        videoMessageElem.textContent = 'Playing from cache (initial segment)...';

        // If online, immediately try to fetch the rest of the video
        if (isOnline) {
            try {
                const fullVideoUrl = await fetchFullVideo(video);
                if (fullVideoUrl) {
                    // Revoke the temporary Blob URL for the initial segment to free memory
                    URL.revokeObjectURL(cachedUrl);
                    // Replace the source with the full video once loaded
                    videoElement.src = fullVideoUrl;
                    videoElement.load(); // Reload the video element to pick up new source
                    videoElement.play(); // Continue playing
                    videoMessageElem.textContent = 'Streaming full video...';
                    // Optionally, delete the initial segment from IndexedDB if the full video is now streaming
                    // await deleteSegmentFromIndexedDB(video.id);
                    // updateCachedVideosList();
                }
            } catch (error) {
                console.error("Failed to load full video after cached segment:", error);
                videoMessageElem.textContent = 'Error streaming full video, playing cached segment only.';
            }
        } else {
            videoMessageElem.textContent = 'Offline: Playing initial segment from cache only.';
        }
    } else if (isOnline) {
        // If not in cache but online, fetch the full video directly
        console.log(`Fetching full video ${video.id} (not in cache).`);
        videoMessageElem.textContent = 'Fetching full video...';
        try {
            const fullVideoUrl = await fetchFullVideo(video);
            if (fullVideoUrl) {
                videoElement.src = fullVideoUrl;
                videoElement.load();
                videoElement.play();
                videoMessageElem.textContent = 'Streaming full video...';
            } else {
                videoMessageElem.textContent = 'Failed to load video. Check network.';
                handlePlaybackError(video.id, 'Failed to load full video.');
            }
        } catch (error) {
            videoMessageElem.textContent = 'Failed to load video. Check network.';
            handlePlaybackError(video.id, 'Failed to load full video.');
        }
    } else {
        // Not in cache and offline
        videoMessageElem.textContent = 'Offline and video not cached. Cannot play.';
        handlePlaybackError(video.id, 'Video not available offline.');
        videoElement.src = ''; // Clear source if cannot play
    }
    videoLoadingOverlay.classList.add('hidden');
}

/**
 * Handles video ending - moves to the next video.
 */
function handleVideoEnd() {
    console.log(`Video ${MOCK_VIDEOS[currentVideoIndex].id} ended.`);
    goToNextVideo();
}

/**
 * Handles video playback errors.
 * @param {string} videoId - The ID of the video that had an error.
 * @param {string} errorMsg - The error message.
 */
function handlePlaybackError(videoId, errorMsg) {
    console.warn(`Playback error for ${videoId}: ${errorMsg}. Attempting to skip.`);
    // For now, just skip to the next video
    goToNextVideo();
}

/**
 * Navigates to the next video in the list.
 */
function goToNextVideo() {
    currentVideoIndex = (currentVideoIndex + 1) % MOCK_VIDEOS.length;
    loadVideoPlayer();
}

/**
 * Navigates to the previous video in the list.
 */
function goToPreviousVideo() {
    currentVideoIndex = (currentVideoIndex - 1 + MOCK_VIDEOS.length) % MOCK_VIDEOS.length;
    loadVideoPlayer();
}

/**
 * Updates the list of cached videos displayed in the UI by reading from IndexedDB.
 */
async function updateCachedVideosList() {
    cachedVideosListElem.innerHTML = ''; // Clear existing list
    const cachedIds = await getAllCachedVideoIds();

    if (cachedIds.length === 0) {
        cachedVideosListElem.innerHTML = '<p class="text-gray-400 text-center text-sm">No initial segments cached yet.</p>';
    } else {
        cachedIds.forEach(videoId => {
            const video = MOCK_VIDEOS.find(v => v.id === videoId);
            const div = document.createElement('div');
            div.className = 'bg-gray-700 p-3 rounded-lg flex items-center justify-between shadow-md';
            div.innerHTML = `
                <span class="text-gray-200 text-sm">
                    ${video ? video.title : `Video ${videoId}`}
                </span>
                <span class="text-green-400 text-xs font-semibold">CACHED</span>
            `;
            cachedVideosListElem.appendChild(div);
        });
    }
}

/**
 * Clears all cached video segments from IndexedDB.
 */
async function clearCache() {
    // Revoke any currently active Blob URLs from the cache to free memory
    // (This part is tricky if videos are currently playing, but for a full clear, it's generally safe)
    // For a more robust solution, track active Blob URLs and revoke them when no longer needed.
    await clearAllSegmentsFromIndexedDB();
    networkMessageElem.textContent = 'Cache cleared!';
    console.log('Video cache cleared.');
    updateCachedVideosList(); // Update the UI list
}

/**
 * Simulates initial pre-loading of the first 2-5 videos' initial segments.
 * This function is now defined globally.
 */
async function initialPreload() {
    networkMessageElem.textContent = 'Pre-loading initial video segments...';
    const videosToPreload = MOCK_VIDEOS.slice(0, Math.min(MOCK_VIDEOS.length, 5)); // Pre-load first 5 videos
    for (const video of videosToPreload) {
        await preloadInitialSegment(video);
    }
    networkMessageElem.textContent = '';
    loadVideoPlayer(); // Load the first video after pre-loading
}


// --- Event Listeners and Initial Setup ---
document.addEventListener('DOMContentLoaded', async () => {
    // Open IndexedDB first
    try {
        // Wait for the database to be fully open and any upgrade transaction to complete.
        await openDatabase();
        updateNetworkStatusDisplay();

        // Now that `db` is guaranteed to be ready and object stores are committed,
        // we can safely proceed with IndexedDB operations.
        if (isOnline) {
            await initialPreload(); // This will also call loadVideoPlayer internally
        } else {
            networkMessageElem.textContent = 'Currently offline. Attempting to play from cache.';
            await loadVideoPlayer(); // Load the first video, relying on cache if offline
        }
        // Update the UI list after initial operations are done and object store is guaranteed to be ready
        await updateCachedVideosList();

        // Add event listeners for network status changes
        window.addEventListener('online', async () => { // Make async to await initialPreload
            isOnline = true;
            updateNetworkStatusDisplay();
            networkMessageElem.textContent = 'You are online! Re-pre-loading...';
            await initialPreload(); // Re-run initial preload logic
            await updateCachedVideosList(); // Update list after re-preloading
        });

        window.addEventListener('offline', () => {
            isOnline = false;
            updateNetworkStatusDisplay();
            networkMessageElem.textContent = 'You are offline!';
        });

        // Add event listeners for video player
        videoElement.addEventListener('ended', handleVideoEnd);
        videoElement.addEventListener('error', (e) => handlePlaybackError(MOCK_VIDEOS[currentVideoIndex].id, e.target.error ? e.target.error.message : 'Unknown error'));

        // Add event listeners for navigation buttons
        prevButton.addEventListener('click', goToPreviousVideo);
        nextButton.addEventListener('click', goToNextVideo);
        clearCacheButton.addEventListener('click', clearCache);

    } catch (error) {
        console.error("Failed to initialize application:", error);
        networkMessageElem.textContent = `Application error: ${error}. Check console.`;
    }
});
