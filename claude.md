# Lives of Infamous Men - HLS Video Generator

## Project Overview

Dynamic video generator that creates unique HLS video streams by assembling clips based on Foucault's "Lives of Infamous Men" text. Each generation produces a randomized sequence of video clips with burned-in subtitles.

**Live Site**: Deployed on Railway
**Project**: lives-hls-generator
**Environment**: production

## Recent Fixes (Session: 2025-11-16)

### 1. Scrollbar Issue on Landing Page
**Problem**: Hovering over Foucault portrait/title caused scrollbars to appear, shifting viewport

**Root Cause**: The `#landing-clickable:hover` transform (`scale(1.02)`) caused content to overflow viewport

**Fix**: Added `overflow: hidden` to html and body elements
```css
html,
body {
  overflow: hidden;
  width: 100%;
  height: 100%;
}
```
**File**: `generate.css` lines 13-18

### 2. Spectrogram Not Visible When Muted
**Problem**: Spectrum analyzer disappeared when video was muted (unlike reference implementation)

**Root Cause**: Code was checking `if (dataArray.some(val => val > 0))` before drawing, preventing rendering when muted

**Fix**: Removed conditional check to always draw spectrogram bars (they show minimal/zero height when muted)
```javascript
// Always draw bars (even when muted, they'll just be minimal)
const barWidth = (canvas.width / bufferLength) * 2;

for (let i = 0; i < bufferLength; i++) {
  const barHeight = (dataArray[i] / 255) * canvas.height;
  // ... gradient and drawing code
}
```
**File**: `generate.js` lines 536-551

## Previous Major Features (From Earlier Sessions)

### Minimap Implementation
- **Proportional sizing**: 12vw × 88vh (adapts to viewport)
- **Timeline alignment**: 20px top/bottom padding for better visual alignment
- **Interactive seeking**: Click/drag on minimap to seek video
- **Progress indicator**: Glowing purple line tracks current position

**Files**:
- `generate.css` lines 366-427 (minimap styles)
- `generate.js` lines 304-357 (minimap logic)

### Reference UI Integration
Pulled styling from https://thelivesofinfamousmen.isthisa.com/:

1. **Comic Neue Font**: Google Fonts integration for titles and mute indicator
2. **Spectrogram**: Red → Pink → Blue gradient frequency visualization
3. **Mute Indicator**: Animated "● click to unmute" with karaoke-style glow effect
4. **Loading Animation**: Undulating Foucault portrait with 3D perspective transforms

### Spectrogram Visualization
- **FFT Size**: 256 (matches reference)
- **Smoothing**: 0.8 constant
- **Gradient**: Red (#ff0000) → Pink (#ff99cc) → Blue (#0000ff)
- **Canvas**: 1920×200px, positioned absolutely at top
- **Behavior**: Always visible during playback, regardless of mute state

**File**: `generate.js` lines 502-579

### Mute Behavior
- **Initial state**: Video starts muted (browser autoplay policy)
- **Unmute**: Click video or mute indicator, or press M key
- **Indicator**: Shows pulsing "● click to unmute" when muted
- **Animation**: `karaokePulse` - scale and glow effect (2s loop)

**Files**:
- `generate.css` lines 549-605 (mute indicator styles)
- `generate.js` lines 473-500 (mute logic)

### Landing Page
- **Design**: Portrait + Title + Author in Comic Neue font
- **Title**: "The (Infinite) Lives of Infamous Men"
- **Author**: "Michel Foucault"
- **Portrait**: Undulating animation (3D perspective transforms)
- **Hover**: Slight scale (1.02) + grayscale removal
- **Action**: Click anywhere to generate video

**Animation**: `undulate` keyframes with rotateY (±30deg), rotateX (±10deg), scale (1.0-1.12)
**File**: `generate.css` lines 75-130, 202-215

### Loading Screen
- **Animation**: Spinning/undulating Foucault portrait
- **Stages**: 6 loading stages with progress bar
- **Duration**: 3-5 seconds minimum (ensures smooth UX)
- **Messages**:
  - Analyzing text...
  - Matching phrases...
  - Selecting clips...
  - Assembling timeline...
  - Finalizing...
  - Ready!

**File**: `generate.js` lines 11-115

## Video Player Features

### HLS Configuration
Optimized HLS.js settings for smooth playback:
- **Buffer management**: 30s back buffer, 60s forward buffer
- **Max buffer**: 120s when bandwidth allows
- **Progressive loading**: Enabled
- **Fragment prefetch**: Enabled
- **Auto start**: Level -1 (automatic quality selection)

**File**: `generate.js` lines 209-253

### Custom Controls
- **Play/Pause**: Button + Spacebar
- **Fullscreen**: Button (maintains minimap + controls in fullscreen)
- **Mute Toggle**: Click video, click indicator, or M key
- **Seeking**: Click/drag minimap

**File**: `generate.js` lines 405-471

### Video Stats Display
Shows generation metadata:
- Total clips
- Phrase clips (matched from text)
- Static clips (fallback clips)
- Total duration

**File**: `generate.js` lines 178-197

## File Structure

```
/builder/player/
├── generate.html          # Main HTML structure
├── generate.css           # All styling (minimap, spectrogram, mute indicator)
├── generate.js            # Frontend logic (HLS, controls, visualizations)
├── hls-generator-server.js # Backend server
├── foucault.png           # Portrait image
├── minimap.png            # Script visualization
├── claude.md              # This file
└── DEPLOYMENT.md          # Deployment instructions
```

## Backend Architecture

### HLS Generation
**Endpoint**: `POST /generate`
**Response**:
```json
{
  "sessionId": "unique-id",
  "playlistUrl": "/sessions/{sessionId}/playlist.m3u8",
  "stats": {
    "totalClips": 100,
    "phraseClips": 75,
    "staticClips": 25,
    "totalDuration": 45.2
  }
}
```

### Clip Sources
1. **Trimmed clips** (`/work/trimmed/*.mkv`): 960×720, SAR=1:1, DAR=4:3
   - Extracted from original video with burned-in subtitles
   - Matched to specific words/phrases from text

2. **Static clips** (`/work/hls_clips/*.ts`): 960×720, SAR=1:1, DAR=4:3
   - Fallback clips from static video source
   - Used for words not found in trimmed clips
   - Generated from 4K webm source, scaled down

### Static Clip Generation Issues (Previously Fixed)

**Historical Problem**: Static clips had wrong subtitle positioning

**Root Cause**: Aspect ratio mismatch
- Static clips were SAR=4:3, DAR=16:9 (non-square pixels)
- Trimmed clips were SAR=1:1, DAR=4:3 (square pixels)

**Solution**: Regenerated static source with `setsar=1:1`
```bash
ffmpeg -i wf2Ojwq4gYU.webm \
  -vf "scale=960:720:flags=lanczos,setsar=1:1" \
  -c:v libx264 -preset medium -crf 18 \
  -c:a aac -b:a 128k /work/static_720p_square.mp4
```

**File**: `/builder/prepare_hls_clips.py`

## Deployment

### Railway Deployment
```bash
./deploy-to-railway.sh
```

**Environment Variables**:
- `R2_BASE_URL`: https://pub-166474990ea24709a41c8e491c22ddfe.r2.dev

**Commands**:
- `railway open` - Open deployed site in browser
- `railway logs` - View deployment logs
- `railway status` - Check deployment status
- `railway variables` - Manage environment variables

### Local Development
```bash
cd /builder/player
node hls-generator-server.js
# Server runs on http://localhost:3001
```

## Key Code Sections

### Spectrogram Setup
**Location**: `generate.js:502-579`
- Creates AudioContext and AnalyserNode
- Connects video element as audio source
- FFT size: 256, smoothing: 0.8
- Draws frequency bars with red→pink→blue gradient
- Always renders when video playing (even when muted)

### Minimap Progress Tracking
**Location**: `generate.js:304-357`
- Updates progress line position based on `video.currentTime / video.duration`
- Accounts for 20px top/bottom padding
- Click/drag seeking with position clamping (0-1)
- Smooth transition with `transition: top 0.05s ease-out`

### Mute Indicator Animation
**Location**: `generate.css:549-605`
- Comic Neue 900 weight font
- Clamp font size: `clamp(22px, 3.8vw, 48px)`
- Pink-to-blue gradient text with glow
- Blue drop shadow for outline effect
- 2s pulse animation (scale 1.0 to 1.03)

### Undulation Animation (Landing/Loading)
**Location**: `generate.css:202-215`
- 3D perspective: 400px
- RotateY: ±30deg, RotateX: ±10deg
- Scale: 1.0 to 1.12
- 1.5s ease-in-out infinite loop
- Creates "wavy" 3D movement effect

## CSS Architecture

### Viewport Management
- `html, body`: `overflow: hidden` to prevent scrollbars
- All containers: Flexbox for centering
- Player container: Fixed positioning, 100vw × 100vh
- Minimap: Absolute positioning within player

### Container System
- `.container`: Hidden by default
- `.container.active`: Visible with fade-in animation
- Four containers: input, loading, player, error
- Only one active at a time

### Responsive Breakpoints
- 1200px: Minimap resizes to 20vw × 75vh
- 768px: Font size reductions, vertical control layout
- 480px: Further font reductions, auto video height

## Known Considerations

### Browser Compatibility
- **HLS.js**: Required for non-Safari browsers
- **AudioContext**: Auto-suspended until user interaction
- **Fullscreen API**: Vendor prefixes handled for all browsers
- **Autoplay**: Video starts muted to comply with browser policies

### Performance
- **Buffer management**: Tuned for smooth playback without excessive memory
- **Spectrogram**: RequestAnimationFrame for 60fps rendering
- **Canvas size**: 1920×200px may need adjustment for mobile

### Video Requirements
- All clips must be same resolution (960×720)
- All clips must have same SAR (1:1) and DAR (4:3)
- HLS segments require consistent GOP size and encoding

## Future Enhancements (Potential)

1. **Mobile optimization**: Responsive minimap sizing, touch controls
2. **Keyboard shortcuts**: Arrow keys for seeking, up/down for volume
3. **Quality selector**: If multiple quality levels added to HLS
4. **Share feature**: Generate shareable links to specific generations
5. **Error recovery**: Better handling of network/playback errors
6. **Loading skeleton**: Show player layout during loading phase

## Reference Implementation

Original UI: https://thelivesofinfamousmen.isthisa.com/

Key differences from reference:
- Reference uses React + Vite build system
- Reference has minified/bundled assets
- Our implementation uses vanilla JS for simpler deployment
- Both use same visual design (Comic Neue, spectrogram, mute indicator)

## Development Notes

### Testing Checklist
- [ ] Landing page hover (no scrollbars)
- [ ] Loading animation smooth
- [ ] Video plays muted initially
- [ ] Mute indicator visible and clickable
- [ ] Spectrogram visible when muted
- [ ] Minimap seeking works
- [ ] Play/pause controls work
- [ ] Fullscreen includes minimap
- [ ] Keyboard shortcuts (Space, M) work
- [ ] Generate another resets properly

### Common Issues

**"Loading Player" Stuck**: Usually HLS manifest loading issue
- Check network tab for 404s on playlist.m3u8
- Verify R2_BASE_URL environment variable
- Check server logs for clip generation errors

**No Audio**: Browser autoplay policy
- Video must start muted
- User must interact to unmute
- AudioContext resumes on play event

**Spectrogram Not Animating**: AudioContext not initialized
- Requires user interaction to create context
- Check console for "Audio context setup failed"
- Verify video element has audio track

**Minimap Not Seeking**: Click event handler issue
- Check video.duration > 0 before seeking
- Verify mousedown/mousemove handlers attached
- Check padding calculation (20px offset)

## Contact & Attribution

**Project**: Lives of Infamous Men HLS Generator
**Based on**: Michel Foucault's "Lives of Infamous Men"
**Original Video**: YouTube video wf2Ojwq4gYU (4K source)
**Deployed by**: Arkadiy Kukarkin (parkan@gmail.com)
**Platform**: Railway
**Storage**: Cloudflare R2

---

*Last Updated*: 2025-11-16
*Session Focus*: Frontend fixes (scrollbar, spectrogram visibility)
