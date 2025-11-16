#!/usr/bin/env node
/**
 * HLS Generator Server
 * Dynamically generates HLS playlists from text input using pre-processed clips
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');

// Configuration
const CONFIG = {
  port: process.env.PORT || 3001,
  manifestPath: process.env.MANIFEST_PATH || './clips-manifest.json',
  clipsDir: process.env.CLIPS_DIR || './test_hls',
  r2BaseUrl: process.env.R2_BASE_URL || null, // e.g., 'https://pub-XXXX.r2.dev'
  sessionTTL: 3600000, // 1 hour in milliseconds
  maxPhraseLength: 10,
  cleanupInterval: 300000 // 5 minutes
};

// In-memory session storage (use Redis for production)
const sessions = new Map();

class HLSBuilder {
  constructor(manifestPath) {
    console.log(`Loading manifest from ${manifestPath}...`);

    try {
      const manifestData = fs.readFileSync(manifestPath, 'utf8');
      this.manifest = JSON.parse(manifestData);

      // Extract data from manifest
      this.phraseMap = this.manifest.phraseMap || {};
      this.phraseClips = this.manifest.phraseClips || {};
      this.staticClips = this.manifest.staticClips || {};
      this.baseUrl = this.manifest.baseUrl || '/hls_clips/';

      // Load fixed text and tokens from manifest
      this.fixedText = this.manifest.fixedText;
      this.fixedTokens = this.manifest.fixedTokens;

      console.log(`Manifest loaded successfully:`);
      console.log(`  - ${Object.keys(this.phraseMap).length} phrases`);
      console.log(`  - ${Object.keys(this.phraseClips).length} phrases with clips`);
      console.log(`  - ${Object.keys(this.staticClips.words || {}).length} word clips`);
      console.log(`  - ${Object.keys(this.staticClips.punctuation || {}).length} punctuation clips`);

      if (this.fixedTokens) {
        console.log(`  - Fixed text: ${this.fixedTokens.length} tokens`);
      } else {
        console.warn(`  ⚠ No fixed text in manifest - will require text input`);
      }

    } catch (error) {
      console.error(`Failed to load manifest: ${error.message}`);
      throw error;
    }
  }

  /**
   * Normalize and tokenize text (ported from Python)
   * Uses consistent Unicode normalization across Python and JavaScript.
   */
  normalizeAndTokenize(text) {
    // Strip BOM and zero-width characters
    text = text.replace(/\ufeff/g, '')
               .replace(/\u200b/g, '')
               .replace(/\u200c/g, '')
               .replace(/\u200d/g, '');

    // Normalize curly quotes and apostrophes to straight ASCII equivalents
    const quoteMap = {
      '\u2018': "'", // ' LEFT SINGLE QUOTATION MARK
      '\u2019': "'", // ' RIGHT SINGLE QUOTATION MARK
      '\u201a': "'", // ‚ SINGLE LOW-9 QUOTATION MARK
      '\u201b': "'", // ‛ SINGLE HIGH-REVERSED-9 QUOTATION MARK
      '\u201c': '"', // " LEFT DOUBLE QUOTATION MARK
      '\u201d': '"', // " RIGHT DOUBLE QUOTATION MARK
      '\u201e': '"', // „ DOUBLE LOW-9 QUOTATION MARK
      '\u201f': '"', // ‟ DOUBLE HIGH-REVERSED-9 QUOTATION MARK
      '\u2032': "'", // ′ PRIME
      '\u2033': '"', // ″ DOUBLE PRIME
      '\u0060': "'", // ` GRAVE ACCENT
      '\u00b4': "'", // ´ ACUTE ACCENT
      '\u2013': '-', // – EN DASH
      '\u2014': '-', // — EM DASH
    };

    for (const [oldChar, newChar] of Object.entries(quoteMap)) {
      text = text.replaceAll(oldChar, newChar);
    }

    // Remove diacritics
    text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Convert to lowercase
    text = text.toLowerCase();

    // Tokenize: words (including apostrophes and hyphens) OR punctuation
    const tokens = text.match(/[\w'-]+|[^\w\s'-]/g) || [];

    return tokens;
  }

  /**
   * Greedy phrase matching (ported from Python)
   */
  greedyMatchPhrases(tokens) {
    const matches = [];
    let i = 0;

    while (i < tokens.length) {
      // Skip punctuation tokens
      if (/^[^\w\s]+$/.test(tokens[i])) {
        i++;
        continue;
      }

      let bestMatch = null;
      let bestLength = 0;

      // Try longest phrases first
      const maxLen = Math.min(CONFIG.maxPhraseLength, tokens.length - i);

      for (let length = maxLen; length > 0; length--) {
        // Collect consecutive word tokens (stop at punctuation)
        const phraseTokens = [];
        let j = i;

        while (j < tokens.length && phraseTokens.length < length) {
          if (/^[^\w\s]+$/.test(tokens[j])) {
            // Hit punctuation, stop here
            break;
          }
          phraseTokens.push(tokens[j]);
          j++;
        }

        if (phraseTokens.length !== length) {
          continue;
        }

        // Build candidate phrase
        const candidate = phraseTokens.join(' ');

        // Check if this phrase exists in the phrase map AND has available clips
        if (this.phraseMap[candidate] && this.phraseClips[candidate] && this.phraseClips[candidate].length > 0) {
          bestMatch = candidate;
          bestLength = length;
          break;
        }
      }

      if (bestMatch) {
        matches.push({
          phrase: bestMatch,
          start: i,
          end: i + bestLength
        });
        i += bestLength;
      } else {
        i++;
      }
    }

    return matches;
  }

  /**
   * Estimate word duration (ported from Python)
   */
  estimateWordDuration(word) {
    // Punctuation gets short duration
    if (/^[^\w\s]+$/.test(word)) {
      return ['.', '!', '?'].includes(word) ? 0.15 : 0.10;
    }

    // Regular words: estimate by character count
    const cleanWord = word.replace(/[^\w]/g, '');
    const estimated = cleanWord.length * 0.08;
    return Math.max(0.3, estimated);
  }

  /**
   * Select clip for phrase with session-based randomization
   */
  selectClip(availableClips, usedClips, seedStr) {
    if (!availableClips || availableClips.length === 0) {
      return null;
    }

    // Prefer unused clips
    const unused = availableClips.filter(clip => !usedClips.has(clip.filename));
    const pool = unused.length > 0 ? unused : availableClips;

    // Seeded random selection
    const hash = crypto.createHash('md5').update(seedStr).digest('hex');
    const index = parseInt(hash.substr(0, 8), 16) % pool.length;

    const selected = pool[index];
    usedClips.add(selected.filename);

    return selected;
  }

  /**
   * Slugify a token for filename/key lookup
   * Must match Python's slugification in prepare_hls_clips.py
   */
  slugify(text) {
    return text.replace(/[^a-z0-9]/g, '_');
  }

  /**
   * Get static clip for unmatched word
   */
  getStaticClip(token) {
    // Check if it's punctuation
    if (/^[^\w\s]+$/.test(token)) {
      // Map common punctuation variants
      let punct = token;
      if (token === '"' || token === '"' || token === '"') punct = '"';
      if (token === "'" || token === "'" || token === "'") punct = "'";
      if (token === '—' || token === '–') punct = '-';

      return this.staticClips.punctuation?.[punct] ||
             this.staticClips.punctuation?.['.'] || // Default to period
             null;
    }

    // Slugify the token to match manifest keys (which are slugified filenames)
    const slugifiedToken = this.slugify(token);
    const wordClip = this.staticClips.words?.[slugifiedToken];

    if (wordClip) {
      return wordClip;
    }

    // No fallback - all needed clips should be pre-generated
    console.warn(`No static clip found for token: "${token}" (slugified: "${slugifiedToken}")`);
    return null;
  }

  /**
   * Generate script from text and matches
   */
  generateScript(tokens, matches, sessionId) {
    const script = [];
    const usedClips = new Set();
    const seed = sessionId;

    // Track which tokens are covered by matches
    const covered = new Set();
    matches.forEach(match => {
      for (let i = match.start; i < match.end; i++) {
        covered.add(i);
      }
    });

    // Process all tokens in order
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      // Check if this position starts a match
      const match = matches.find(m => m.start === i);

      if (match) {
        // Select clip for matched phrase
        const availableClips = this.phraseClips[match.phrase] || [];
        const clip = this.selectClip(availableClips, usedClips, seed + match.phrase);

        if (clip) {
          script.push({
            text: tokens.slice(match.start, match.end).join(' '),
            filename: clip.filename,
            duration: clip.duration,
            type: 'phrase'
          });
        }

        i = match.end - 1; // Skip to end of match

      } else if (!covered.has(i)) {
        // Unmatched token - use static fallback
        const staticClip = this.getStaticClip(token);

        if (staticClip) {
          script.push({
            text: token,
            filename: staticClip.filename,
            duration: staticClip.duration,
            type: 'static'
          });
        }
      }
    }

    return script;
  }

  /**
   * Build M3U8 playlist from script
   */
  buildM3U8(script, sessionId) {
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:10',
      '#EXT-X-PLAYLIST-TYPE:VOD'
    ];

    // Add session comment for debugging
    lines.push(`# Session: ${sessionId}`);
    lines.push(`# Generated: ${new Date().toISOString()}`);
    lines.push(`# Clips: ${script.length + 1}`); // +1 for opener

    let totalDuration = 0;

    // Add opener clip first
    const openerDuration = 8.08;
    lines.push('#EXT-X-DISCONTINUITY');
    lines.push(`#EXTINF:${openerDuration.toFixed(3)},`);
    const openerPath = CONFIG.r2BaseUrl
      ? `${CONFIG.r2BaseUrl}/hls_clips/static/opener.ts`
      : '/hls_clips/static/opener.ts';
    lines.push(openerPath);
    totalDuration += openerDuration;

    for (const item of script) {
      // Add discontinuity tag before each segment
      // Required because clips come from different sources with different timestamps
      lines.push('#EXT-X-DISCONTINUITY');
      lines.push(`#EXTINF:${item.duration.toFixed(3)},`);

      // Determine URL based on clip type
      // If R2_BASE_URL is set, use absolute URLs, otherwise use relative paths
      let clipPath;
      if (CONFIG.r2BaseUrl) {
        // Use R2 absolute URLs
        if (item.type === 'phrase') {
          clipPath = `${CONFIG.r2BaseUrl}/hls_clips/trimmed/${item.filename}`;
        } else {
          clipPath = `${CONFIG.r2BaseUrl}/hls_clips/static/${item.filename}`;
        }
      } else {
        // Use relative URLs for local serving
        if (item.type === 'phrase') {
          clipPath = `/hls_clips/trimmed/${item.filename}`;
        } else {
          clipPath = `/hls_clips/static/${item.filename}`;
        }
      }

      lines.push(clipPath);
      totalDuration += item.duration;
    }

    lines.push('#EXT-X-ENDLIST');
    lines.push(`# Total duration: ${totalDuration.toFixed(1)}s`);

    return lines.join('\n');
  }

  /**
   * Generate playlist using fixed text with session-based randomization
   */
  generatePlaylist(sessionId) {
    // Use pre-loaded fixed tokens from manifest
    const tokens = this.fixedTokens;

    if (!tokens) {
      throw new Error('No fixed text available in manifest');
    }

    console.log(`[${sessionId}] Using fixed text: ${tokens.length} tokens`);

    // 2. Match phrases
    const matches = this.greedyMatchPhrases(tokens);
    console.log(`[${sessionId}] Matched: ${matches.length} phrases`);

    // 3. Generate script with session-based randomization
    const script = this.generateScript(tokens, matches, sessionId);
    console.log(`[${sessionId}] Script: ${script.length} clips`);

    // 4. Build M3U8 playlist
    const playlist = this.buildM3U8(script, sessionId);

    return { playlist, script, tokens, matches };
  }
}

// Initialize Express app
const app = express();

// Configure CORS to allow specific domain
const corsOptions = {
  origin: ['https://thelivesofinfamousmen.isthisa.com', 'http://localhost:3001'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));

// Serve HLS clips with CORS headers from /work/hls_clips
app.use('/hls_clips', express.static('/work/hls_clips', {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
  }
}));

// Initialize HLS builder
let builder;
try {
  builder = new HLSBuilder(CONFIG.manifestPath);
} catch (error) {
  console.error('Failed to initialize HLS builder:', error);
  process.exit(1);
}

// Session cleanup
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.created > CONFIG.sessionTTL) {
      sessions.delete(sessionId);
      console.log(`Cleaned up expired session: ${sessionId}`);
    }
  }
}, CONFIG.cleanupInterval);

// Routes

// Root route - serve generate.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'generate.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    sessions: sessions.size,
    uptime: process.uptime()
  });
});

// Generate playlist (uses fixed text from manifest, randomizes per session)
app.post('/generate', (req, res) => {
  // Generate session ID for randomization
  const sessionId = crypto.randomBytes(16).toString('hex');

  console.log(`\n=== New Generation Request ===`);
  console.log(`Session: ${sessionId}`);

  try {
    // Generate playlist using fixed text with session-based randomization
    const result = builder.generatePlaylist(sessionId);

    // Store session
    sessions.set(sessionId, {
      created: Date.now(),
      playlist: result.playlist,
      script: result.script,
      tokens: result.tokens,
      matches: result.matches
    });

    // Calculate statistics
    const stats = {
      totalTokens: result.tokens.length,
      matchedPhrases: result.matches.length,
      totalClips: result.script.length,
      phraseClips: result.script.filter(c => c.type === 'phrase').length,
      staticClips: result.script.filter(c => c.type === 'static').length,
      totalDuration: result.script.reduce((sum, c) => sum + c.duration, 0)
    };

    console.log(`Generated playlist with ${stats.totalClips} clips (${stats.totalDuration.toFixed(1)}s)`);

    res.json({
      sessionId,
      playlistUrl: `/${sessionId}.m3u8`,
      stats
    });

  } catch (error) {
    console.error(`Failed to generate playlist: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate playlist' });
  }
});

// Serve playlist
app.get('/:sessionId.m3u8', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).send('Session not found');
  }

  // Update last accessed time
  session.lastAccessed = Date.now();

  res.type('application/vnd.apple.mpegurl');
  res.send(session.playlist);
});

// Get session info (for debugging)
app.get('/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({
    sessionId: sessionId,
    created: new Date(session.created).toISOString(),
    totalTokens: session.tokens.length,
    matchedPhrases: session.matches.length,
    clips: session.script.length,
    duration: session.script.reduce((sum, c) => sum + c.duration, 0),
    script: session.script  // Full script for debugging
  });
});

// Serve static frontend files (CSS, JS, etc.) - must come after route handlers
app.use(express.static(__dirname));

// Serve clip files
app.use('/test_hls', express.static(CONFIG.clipsDir));
app.use('/hls_clips', express.static(CONFIG.clipsDir));

// Start server
app.listen(CONFIG.port, () => {
  console.log(`\n=== HLS Generator Server ===`);
  console.log(`Port: ${CONFIG.port}`);
  console.log(`Manifest: ${CONFIG.manifestPath}`);
  console.log(`Clips: ${CONFIG.clipsDir}`);
  console.log(`\nServer running at http://localhost:${CONFIG.port}`);
  console.log(`\nAPI Endpoints:`);
  console.log(`  POST /generate - Generate playlist from text`);
  console.log(`  GET /{sessionId}.m3u8 - Get playlist`);
  console.log(`  GET /session/{sessionId} - Get session info`);
});