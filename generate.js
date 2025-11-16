/**
 * Dynamic Video Generator Frontend
 * Handles text input, loading animation, and HLS playback
 */

// Configuration
const API_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : '';  // Same origin in production

const LOADING_STAGES = [
  { text: 'Analyzing text...', detail: 'Processing your input', progress: 20 },
  { text: 'Matching phrases...', detail: 'Finding available clips', progress: 40 },
  { text: 'Selecting clips...', detail: 'Randomizing selection', progress: 60 },
  { text: 'Assembling timeline...', detail: 'Creating unique sequence', progress: 80 },
  { text: 'Finalizing...', detail: 'Preparing playback', progress: 95 },
  { text: 'Ready!', detail: 'Loading player', progress: 100 }
];

const MIN_LOADING_TIME = 3000; // Minimum 3 seconds
const MAX_LOADING_TIME = 5000; // Maximum 5 seconds

// State
let currentSession = null;
let hls = null;
let loadingInterval = null;

// Elements
const elements = {
  // Containers
  inputContainer: document.getElementById('input-container'),
  loadingContainer: document.getElementById('loading-container'),
  playerContainer: document.getElementById('player-container'),
  errorContainer: document.getElementById('error-container'),

  // Input
  generateBtn: document.getElementById('generate-btn'),

  // Loading
  loadingStatus: document.getElementById('loading-status'),
  loadingDetail: document.getElementById('loading-detail'),
  progressFill: document.getElementById('progress-fill'),
  spinner: document.querySelector('.spinner'),

  // Player
  video: document.getElementById('video'),
  sessionId: document.getElementById('session-id'),
  videoStats: document.getElementById('video-stats'),
  generateAnother: document.getElementById('generate-another'),

  // Error
  errorMessage: document.getElementById('error-message'),
  tryAgain: document.getElementById('try-again')
};

/**
 * Show a specific container and hide others
 */
function showContainer(container) {
  const containers = ['inputContainer', 'loadingContainer', 'playerContainer', 'errorContainer'];

  containers.forEach(name => {
    if (elements[name]) {
      if (elements[name] === container) {
        elements[name].classList.add('active');
      } else {
        elements[name].classList.remove('active');
      }
    }
  });
}

/**
 * Animate loading sequence
 */
async function animateLoading() {
  const startTime = Date.now();
  const duration = MIN_LOADING_TIME + Math.random() * (MAX_LOADING_TIME - MIN_LOADING_TIME);

  return new Promise((resolve) => {
    let stageIndex = 0;

    loadingInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min((elapsed / duration) * 100, 100);

      // Find appropriate stage
      while (stageIndex < LOADING_STAGES.length - 1 &&
             progress >= LOADING_STAGES[stageIndex + 1].progress) {
        stageIndex++;
      }

      const stage = LOADING_STAGES[stageIndex];

      // Update UI
      elements.loadingStatus.textContent = stage.text;
      elements.loadingDetail.textContent = stage.detail;
      elements.progressFill.style.width = `${progress}%`;

      // Add pulse effect at certain points
      if (progress > 30 && progress < 35) {
        elements.spinner.classList.add('pulse');
      } else if (progress > 60 && progress < 65) {
        elements.spinner.classList.add('pulse');
      } else {
        elements.spinner.classList.remove('pulse');
      }

      // Complete
      if (progress >= 100) {
        clearInterval(loadingInterval);
        loadingInterval = null;
        resolve();
      }
    }, 100);
  });
}

/**
 * Generate video (uses fixed text from server)
 */
async function generateVideo() {
  // Show loading
  showContainer(elements.loadingContainer);
  elements.progressFill.style.width = '0%';

  // Start loading animation
  const loadingPromise = animateLoading();

  try {
    // Call API (no text needed - server uses fixed text)
    const response = await fetch(`${API_URL}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();

    // Store session
    currentSession = data;

    // Wait for minimum loading time
    await loadingPromise;

    // Small delay before showing player
    await new Promise(resolve => setTimeout(resolve, 300));

    // Load video
    loadVideo(data.playlistUrl, data.sessionId, data.stats);

  } catch (error) {
    console.error('Generation failed:', error);

    // Clear loading
    if (loadingInterval) {
      clearInterval(loadingInterval);
      loadingInterval = null;
    }

    showError(`Failed to generate video: ${error.message}`);
  }
}

/**
 * Load and play HLS video
 */
function loadVideo(playlistUrl, sessionId, stats) {
  // Update session info
  elements.sessionId.textContent = sessionId;

  // Update stats
  if (stats) {
    elements.videoStats.innerHTML = `
      <div class="stat">
        <span class="stat-label">Total Clips:</span>
        <span class="stat-value">${stats.totalClips}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Phrase Clips:</span>
        <span class="stat-value">${stats.phraseClips}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Static Clips:</span>
        <span class="stat-value">${stats.staticClips}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Duration:</span>
        <span class="stat-value">${stats.totalDuration.toFixed(1)}s</span>
      </div>
    `;
  }

  // Destroy previous HLS instance if exists
  if (hls) {
    hls.destroy();
    hls = null;
  }

  // Full URL for playlist
  const fullPlaylistUrl = `${API_URL}${playlistUrl}`;

  // Load video with HLS.js
  if (Hls.isSupported()) {
    hls = new Hls({
      enableWorker: true,
      backBufferLength: 30,        // Reduce back buffer to save memory
      maxBufferLength: 60,          // Increase forward buffer for smoother playback
      maxMaxBufferLength: 120,      // Allow more buffer when bandwidth allows
      maxBufferSize: 60*1000*1000,  // 60MB buffer size
      maxBufferHole: 0.5,           // Allow small gaps in buffer
      lowBufferWatchdogPeriod: 0.5, // Check buffer more frequently
      highBufferWatchdogPeriod: 3,  // Check buffer health
      nudgeOffset: 0.1,             // Small nudge for sync
      nudgeMaxRetry: 10,            // Retry nudging
      maxFragLookUpTolerance: 0.25, // Tolerance for fragment lookup
      enableCEA708Captions: false,  // Disable captions processing
      stretchShortVideoTrack: false,
      progressive: true,             // Enable progressive loading
      lowLatencyMode: false,         // We're not doing live streaming
      testBandwidth: false,          // No bandwidth testing needed for local
      fpsDroppedMonitoringPeriod: 5000,
      fpsDroppedMonitoringThreshold: 0.2,
      appendErrorMaxRetry: 3,
      startFragPrefetch: true,       // Prefetch next fragment
      manifestLoadingTimeOut: 10000,
      manifestLoadingMaxRetry: 4,
      manifestLoadingRetryDelay: 500,
      manifestLoadingMaxRetryTimeout: 64000,
      levelLoadingTimeOut: 10000,
      levelLoadingMaxRetry: 4,
      levelLoadingRetryDelay: 500,
      levelLoadingMaxRetryTimeout: 64000,
      fragLoadingTimeOut: 20000,
      fragLoadingMaxRetry: 6,
      fragLoadingRetryDelay: 500,
      fragLoadingMaxRetryTimeout: 64000,
      startLevel: -1,               // Auto start level
      autoStartLoad: true,          // Start loading immediately
      maxLoadingDelay: 4,           // Max loading delay
      minAutoBitrate: 0,
      emeEnabled: false,
      widevineLicenseUrl: undefined,
      licenseXhrSetup: undefined,
      capLevelOnFPSDrop: false,
      capLevelToPlayerSize: false,
      ignoreDevicePixelRatio: false
    });

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      console.log('HLS manifest loaded');
      // Try to autoplay (may be blocked by browser)
      elements.video.play().catch(e => {
        console.log('Autoplay blocked - user needs to click play');
      });
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.error('Fatal HLS error:', data);
        switch(data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.log('Attempting to recover from network error');
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('Attempting to recover from media error');
            hls.recoverMediaError();
            break;
          default:
            showError('Failed to load video');
            break;
        }
      }
    });

    hls.loadSource(fullPlaylistUrl);
    hls.attachMedia(elements.video);

  } else if (elements.video.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS support (Safari)
    elements.video.src = fullPlaylistUrl;
    elements.video.addEventListener('loadedmetadata', () => {
      elements.video.play().catch(e => {
        console.log('Autoplay blocked');
      });
    });
  } else {
    showError('HLS is not supported in your browser');
    return;
  }

  // Show player
  showContainer(elements.playerContainer);
}

/**
 * Show error message
 */
function showError(message) {
  elements.errorMessage.textContent = message;
  showContainer(elements.errorContainer);
}

/**
 * Reset to input screen
 */
function reset() {
  // Clear state
  currentSession = null;

  // Destroy HLS
  if (hls) {
    hls.destroy();
    hls = null;
  }

  // Reset video
  elements.video.pause();
  elements.video.src = '';

  // Show input
  showContainer(elements.inputContainer);
}

// Event Listeners

// Generate button - just call generateVideo()
elements.generateBtn.addEventListener('click', () => {
  generateVideo();
});

// Generate another button
elements.generateAnother.addEventListener('click', reset);

// Try again button
elements.tryAgain.addEventListener('click', reset);

// Initialize
console.log('Lives of Infamous Men - Video Generator initialized');
console.log('API URL:', API_URL);
console.log('Uses fixed text with session-based randomization');