/**
 * SWASTIK / SPECTRA-X: Live Camera-to-Synthetic Radar CV Module (Multi-Target Edition)
 * Bridges laptop webcam visual input with synthetic radar target generation.
 * Performs real-time multi-object spatial clustering, tracks multiple simultaneous
 * objects (e.g. hands, items), plots separate points on the radar HUD,
 * and triggers alerts.
 *
 * SAFETY NOTICE: Computer vision simulation demonstration only.
 * Not an RF receiver or real radar sensor.
 */
class LiveCameraRadarController {
  constructor() {
    // Video and overlay canvas elements across tabs
    this.video1 = document.getElementById('webcam-feed');
    this.canvas1 = document.getElementById('webcam-overlay-canvas');
    this.ctx1 = this.canvas1 ? this.canvas1.getContext('2d') : null;

    this.video2 = document.getElementById('webcam-feed-2');
    this.canvas2 = document.getElementById('webcam-overlay-canvas-2');
    this.ctx2 = this.canvas2 ? this.canvas2.getContext('2d') : null;

    this.stream = null;
    this.isActive = false;
    this.isPaused = false;
    this.fullScreenAlertMode = false;

    // Offscreen canvas for fast computer vision processing
    this.procW = 160;
    this.procH = 120;
    this.offCanvas = document.createElement('canvas');
    this.offCanvas.width = this.procW;
    this.offCanvas.height = this.procH;
    this.offCtx = this.offCanvas.getContext('2d', { willReadFrequently: true });

    this.prevFrame = null;
    this.motionThreshold = 24; // Pixel difference threshold
    this.minClusterCells = 4;   // Minimum active cells to form a valid object

    // Multi-target tracking state
    this.activeTracks = [];
    this.nextTargetIndex = 1;
    this.lostTimeoutMs = 2200; // 2.2 seconds before lost
    this.lastAlertTime = 0;
    this.targetHistory = [];

    // Distinct tactical colors and simulated bands for multiple targets
    this.targetPalette = [
      { color: '#00f0ff', band: 'B4', freq: 4.72, category: 'Aircraft-like Object' },
      { color: '#00ff88', band: 'B3', freq: 2.45, category: 'Drone-like Object' },
      { color: '#ffaa00', band: 'B5', freq: 10.15, category: 'High-Speed Object' },
      { color: '#c084fc', band: 'B7', freq: 22.40, category: 'Unclassified Aerial Object' },
      { color: '#38bdf8', band: 'B6', freq: 15.50, category: 'Autonomous Aerial Vehicle' }
    ];

    this._bindControls();
  }

  _bindControls() {
    // Buttons in Mission Control
    const btnAct1 = document.getElementById('btn-activate-camera');
    const btnStop1 = document.getElementById('btn-stop-camera');
    const btnPause1 = document.getElementById('btn-pause-camera');
    const btnFs1 = document.getElementById('btn-fullscreen-alert');

    // Buttons in dedicated Live Camera Radar tab
    const btnAct2 = document.getElementById('btn-activate-camera-2');
    const btnStop2 = document.getElementById('btn-stop-camera-2');
    const btnPause2 = document.getElementById('btn-pause-camera-2');
    const btnFs2 = document.getElementById('btn-fullscreen-alert-2');

    const btnExitFs = document.getElementById('btn-exit-fullscreen-alert');

    [btnAct1, btnAct2].forEach(btn => {
      if (btn) btn.addEventListener('click', () => this.startCamera());
    });
    [btnStop1, btnStop2].forEach(btn => {
      if (btn) btn.addEventListener('click', () => this.stopCamera());
    });
    [btnPause1, btnPause2].forEach(btn => {
      if (btn) btn.addEventListener('click', () => this.togglePause());
    });
    [btnFs1, btnFs2].forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => {
          this.fullScreenAlertMode = !this.fullScreenAlertMode;
          const txt = this.fullScreenAlertMode ? "EXIT FS ALERT MODE" : "FULL SCREEN ALERT MODE";
          if (btnFs1) btnFs1.textContent = txt;
          if (btnFs2) btnFs2.textContent = txt;
        });
      }
    });

    if (btnExitFs) {
      btnExitFs.addEventListener('click', () => {
        this.fullScreenAlertMode = false;
        const modal = document.getElementById('fullscreen-alert-modal');
        if (modal) modal.classList.remove('active');
        if (btnFs1) btnFs1.textContent = "FULL SCREEN ALERT MODE";
        if (btnFs2) btnFs2.textContent = "FULL SCREEN ALERT MODE";
      });
    }

    // Sensitivity slider
    const sensSlider = document.getElementById('camera-sensitivity-slider');
    if (sensSlider) {
      sensSlider.addEventListener('input', (e) => {
        // Inverted: higher sensitivity = lower threshold
        this.motionThreshold = Math.max(12, 45 - parseInt(e.target.value));
      });
    }
  }

  async startCamera() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Webcam API not supported in this browser environment.");
        return;
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }
      });

      // Attach stream to both video elements
      if (this.video1) {
        this.video1.srcObject = this.stream;
        await this.video1.play().catch(() => {});
      }
      if (this.video2) {
        this.video2.srcObject = this.stream;
        await this.video2.play().catch(() => {});
      }

      this.isActive = true;
      this.isPaused = false;

      // Update UI buttons in both tabs
      this._updateButtonStates(true);

      fetch('/api/camera/activate', { method: 'POST' }).catch(() => {});
      if (window.logEvent) {
        window.logEvent("CAMERA", "Webcam stream opened. Multi-object spatial clustering tracker initialized.");
      }

      this._runDetectionLoop();
    } catch (err) {
      console.error("Camera access error:", err);
      alert("Could not access webcam: " + err.message + "\nPlease grant camera permissions.");
    }
  }

  stopCamera() {
    this.isActive = false;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.video1) this.video1.srcObject = null;
    if (this.video2) this.video2.srcObject = null;

    this._clearCanvases();
    this.activeTracks = [];
    this._updateButtonStates(false);
    this._updateTargetDisplays();

    const banner = document.getElementById('camera-alert-banner');
    if (banner) banner.style.display = 'none';
    const fsModal = document.getElementById('fullscreen-alert-modal');
    if (fsModal) fsModal.classList.remove('active');

    fetch('/api/camera/deactivate', { method: 'POST' }).catch(() => {});
    if (window.logEvent) {
      window.logEvent("CAMERA", "Camera stream disabled.");
    }
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    const txt = this.isPaused ? "RESUME DETECTION" : "PAUSE DETECTION";
    const b1 = document.getElementById('btn-pause-camera');
    const b2 = document.getElementById('btn-pause-camera-2');
    if (b1) b1.textContent = txt;
    if (b2) b2.textContent = txt;
  }

  _updateButtonStates(isRunning) {
    const bAct1 = document.getElementById('btn-activate-camera');
    const bStop1 = document.getElementById('btn-stop-camera');
    const bAct2 = document.getElementById('btn-activate-camera-2');
    const bStop2 = document.getElementById('btn-stop-camera-2');

    if (bAct1) bAct1.style.display = isRunning ? 'none' : 'inline-flex';
    if (bStop1) bStop1.style.display = isRunning ? 'inline-flex' : 'none';
    if (bAct2) bAct2.style.display = isRunning ? 'none' : 'inline-flex';
    if (bStop2) bStop2.style.display = isRunning ? 'inline-flex' : 'none';

    const badges = [document.getElementById('camera-status-badge'), document.getElementById('camera-status-badge-2')];
    badges.forEach(b => {
      if (b) {
        b.textContent = isRunning ? "● CAMERA ONLINE" : "OFFLINE";
        b.className = isRunning ? "status-pill online" : "status-pill";
      }
    });
  }

  _clearCanvases() {
    if (this.ctx1 && this.canvas1) this.ctx1.clearRect(0, 0, this.canvas1.width, this.canvas1.height);
    if (this.ctx2 && this.canvas2) this.ctx2.clearRect(0, 0, this.canvas2.width, this.canvas2.height);
  }

  _runDetectionLoop() {
    if (!this.isActive) return;

    const sourceVideo = (this.video1 && this.video1.readyState === 4) ? this.video1 : 
                        ((this.video2 && this.video2.readyState === 4) ? this.video2 : null);

    if (!this.isPaused && sourceVideo) {
      this._processMultiObjectFrame(sourceVideo);
    }

    requestAnimationFrame(() => this._runDetectionLoop());
  }

  _processMultiObjectFrame(video) {
    const pw = this.procW;
    const ph = this.procH;
    const offCtx = this.offCtx;

    // Draw current video frame to processing canvas
    offCtx.drawImage(video, 0, 0, pw, ph);
    const frameData = offCtx.getImageData(0, 0, pw, ph);
    const data = frameData.data;

    // Grid downsampling: 40 cols x 30 rows (each cell is 4x4 pixels)
    const gridW = 40;
    const gridH = 30;
    const cellW = pw / gridW; // 4
    const cellH = ph / gridH; // 4
    const grid = Array.from({ length: gridH }, () => new Uint8Array(gridW));

    if (this.prevFrame) {
      // Compute pixel differences and accumulate active cells
      for (let gy = 0; gy < gridH; gy++) {
        for (let gx = 0; gx < gridW; gx++) {
          let motionSum = 0;
          const startX = gx * cellW;
          const startY = gy * cellH;

          for (let dy = 0; dy < cellH; dy++) {
            for (let dx = 0; dx < cellW; dx++) {
              const idx = ((startY + dy) * pw + (startX + dx)) * 4;
              const diff = (
                Math.abs(data[idx] - this.prevFrame[idx]) +
                Math.abs(data[idx+1] - this.prevFrame[idx+1]) +
                Math.abs(data[idx+2] - this.prevFrame[idx+2])
              ) / 3;
              if (diff > this.motionThreshold) motionSum++;
            }
          }

          if (motionSum >= 3) {
            grid[gy][gx] = 1;
          }
        }
      }
    }

    // Save previous frame
    this.prevFrame = new Uint8ClampedArray(data);

    // Connected Component Labeling (BFS / 8-connectivity) to find distinct clusters
    const visited = Array.from({ length: gridH }, () => new Uint8Array(gridW));
    const detectedClusters = [];

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        if (grid[gy][gx] === 1 && !visited[gy][gx]) {
          // BFS exploration for this cluster
          let minGx = gx, maxGx = gx, minGy = gy, maxGy = gy;
          let cellCount = 0;
          const queue = [[gx, gy]];
          visited[gy][gx] = 1;

          while (queue.length > 0) {
            const [cx, cy] = queue.shift();
            cellCount++;
            if (cx < minGx) minGx = cx;
            if (cx > maxGx) maxGx = cx;
            if (cy < minGy) minGy = cy;
            if (cy > maxGy) maxGy = cy;

            // 8-way neighbors
            for (let ny = Math.max(0, cy - 1); ny <= Math.min(gridH - 1, cy + 1); ny++) {
              for (let nx = Math.max(0, cx - 1); nx <= Math.min(gridW - 1, cx + 1); nx++) {
                if (grid[ny][nx] === 1 && !visited[ny][nx]) {
                  visited[ny][nx] = 1;
                  queue.push([nx, ny]);
                }
              }
            }
          }

          // Filter out tiny noise (e.g. less than 4 cells)
          if (cellCount >= this.minClusterCells) {
            // Cluster normalized coordinates in [0.0 - 1.0]
            const normX = (minGx * cellW) / pw;
            const normY = (minGy * cellH) / ph;
            const normW = ((maxGx - minGx + 1) * cellW) / pw;
            const normH = ((maxGy - minGy + 1) * cellH) / ph;
            detectedClusters.push({
              normX, normY, normW, normH,
              centerX: normX + normW / 2,
              centerY: normY + normH / 2,
              cellCount
            });
          }
        }
      }
    }

    // Match detected clusters with active tracks (Centroid Tracking)
    const now = Date.now();
    const matchedTrackIndices = new Set();
    const matchedClusterIndices = new Set();

    // 1. Match existing tracks to closest cluster
    for (let tIdx = 0; tIdx < this.activeTracks.length; tIdx++) {
      const track = this.activeTracks[tIdx];
      let bestDist = 0.35; // Maximum distance to associate in normalized space
      let bestClusterIdx = -1;

      for (let cIdx = 0; cIdx < detectedClusters.length; cIdx++) {
        if (matchedClusterIndices.has(cIdx)) continue;
        const c = detectedClusters[cIdx];
        const dist = Math.hypot(track.normCenterX - c.centerX, track.normCenterY - c.centerY);
        if (dist < bestDist) {
          bestDist = dist;
          bestClusterIdx = cIdx;
        }
      }

      if (bestClusterIdx !== -1) {
        // Matched: smooth track position
        const c = detectedClusters[bestClusterIdx];
        matchedClusterIndices.add(bestClusterIdx);
        matchedTrackIndices.add(tIdx);

        track.normX = track.normX * 0.4 + c.normX * 0.6;
        track.normY = track.normY * 0.4 + c.normY * 0.6;
        track.normW = track.normW * 0.4 + c.normW * 0.6;
        track.normH = track.normH * 0.4 + c.normH * 0.6;
        track.normCenterX = track.normX + track.normW / 2;
        track.normCenterY = track.normY + track.normH / 2;
        track.lastSeen = now;
        track.status = "TRACKING";
        this._updateTrackRadarCoordinates(track);
      }
    }

    // 2. Unmatched clusters -> Spawn NEW tracks
    for (let cIdx = 0; cIdx < detectedClusters.length; cIdx++) {
      if (!matchedClusterIndices.has(cIdx)) {
        const c = detectedClusters[cIdx];
        const targetId = `T-${String(this.nextTargetIndex++).padStart(3, '0')}`;
        const palette = this.targetPalette[(this.activeTracks.length) % this.targetPalette.length];

        const newTrack = {
          id: targetId,
          normX: c.normX,
          normY: c.normY,
          normW: c.normW,
          normH: c.normH,
          normCenterX: c.centerX,
          normCenterY: c.centerY,
          firstSeen: now,
          lastSeen: now,
          status: "DETECTED",
          confidence: 0.94,
          category: palette.category,
          color: palette.color,
          associatedBand: palette.band,
          syntheticFreq: palette.freq,
          activityPct: Math.round(75 + Math.random() * 20),
          radarX: 0,
          radarY: 0,
          syntheticRangeM: 42,
          syntheticBearingDeg: 137
        };

        this._updateTrackRadarCoordinates(newTrack);
        this.activeTracks.push(newTrack);

        // Play alert sound for new target
        if (window.tacticalAudio && (now - this.lastAlertTime > 2500)) {
          this.lastAlertTime = now;
          window.tacticalAudio.playAlertKlaxon();
        }

        if (window.logEvent) {
          window.logEvent("CAMERA", `Visual object ${targetId} detected -> Plotted on synthetic radar (${newTrack.associatedBand}).`);
        }
      }
    }

    // 3. Check for lost tracks
    const retainedTracks = [];
    for (const track of this.activeTracks) {
      if (now - track.lastSeen <= this.lostTimeoutMs) {
        retainedTracks.push(track);
      } else {
        // Mark lost
        this._archiveLostTrack(track);
        fetch(`/api/camera/target-lost?target_id=${track.id}`, { method: 'POST' }).catch(() => {});
        if (window.logEvent) {
          window.logEvent("CAMERA", `Target ${track.id} lost. Radar marker cleared.`);
        }
      }
    }
    this.activeTracks = retainedTracks;

    // 4. Draw bounding boxes on all available overlay canvases
    this._drawOverlaysOnCanvas(this.canvas1, this.ctx1, video);
    this._drawOverlaysOnCanvas(this.canvas2, this.ctx2, video);

    // 5. Update UI Target Displays & send batch to backend
    this._updateTargetDisplays();
    this._sendBatchDetectionsToBackend();
  }

  _updateTrackRadarCoordinates(track) {
    // Horizontal position [0.0 left to 1.0 right] maps to wide bearing angles:
    // Left maps to NW (310°), Center maps to N/NE (45°), Right maps to SE (135°)
    const xOff = (track.normCenterX - 0.5) * 2.0; // [-1.0, 1.0]
    let bearing = (45.0 + xOff * 70.0) % 360.0;
    if (bearing < 0) bearing += 360.0;
    track.syntheticBearingDeg = Math.round(bearing);

    // Box size and vertical position maps to distance (lower in frame = closer)
    const boxArea = Math.max(0.01, Math.min(0.5, track.normW * track.normH));
    const distFactor = Math.max(0.1, Math.min(1.0, 1.0 - (track.normCenterY * 0.5 + boxArea * 1.5)));
    const rangeM = Math.round(20.0 + distFactor * 105.0);
    track.syntheticRangeM = rangeM;

    // Display scale in km (e.g. 3.5 km to 12.0 km on 20 km radar display)
    const dispScaleKm = 3.5 + (rangeM / 15.0);
    const rad = (bearing * Math.PI) / 180.0;
    track.radarX = parseFloat((dispScaleKm * Math.sin(rad)).toFixed(2));
    track.radarY = parseFloat((dispScaleKm * Math.cos(rad)).toFixed(2));
  }

  _drawOverlaysOnCanvas(canvas, ctx, video) {
    if (!canvas || !ctx) return;
    const w = canvas.width = video.videoWidth || 640;
    const h = canvas.height = video.videoHeight || 480;

    ctx.clearRect(0, 0, w, h);

    for (const track of this.activeTracks) {
      const bx = track.normX * w;
      const by = track.normY * h;
      const bw = track.normW * w;
      const bh = track.normH * h;
      const col = track.color || '#00f0ff';

      ctx.save();
      // Bounding box dashed border
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);

      // Corner reticle accents
      const cLen = 14;
      ctx.lineWidth = 3;
      // Top-left
      ctx.beginPath(); ctx.moveTo(bx, by + cLen); ctx.lineTo(bx, by); ctx.lineTo(bx + cLen, by); ctx.stroke();
      // Top-right
      ctx.beginPath(); ctx.moveTo(bx + bw - cLen, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + cLen); ctx.stroke();
      // Bottom-left
      ctx.beginPath(); ctx.moveTo(bx, by + bh - cLen); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + cLen, by + bh); ctx.stroke();
      // Bottom-right
      ctx.beginPath(); ctx.moveTo(bx + bw - cLen, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - cLen); ctx.stroke();

      // Center crosshair
      const cx = bx + bw / 2;
      const cy = by + bh / 2;
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy);
      ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Target Header Tag
      ctx.fillStyle = 'rgba(6, 12, 24, 0.88)';
      ctx.fillRect(bx, Math.max(0, by - 26), 180, 24);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, Math.max(0, by - 26), 180, 24);

      ctx.fillStyle = col;
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`${track.id} [${track.associatedBand}] | ${track.syntheticRangeM}m`, bx + 6, Math.max(0, by - 10));

      ctx.restore();
    }
  }

  _archiveLostTrack(track) {
    const timeStr = new Date().toTimeString().split(' ')[0];
    this.targetHistory.unshift({
      target_id: track.id,
      category: track.category,
      first_seen: new Date(track.firstSeen).toTimeString().split(' ')[0],
      last_seen: timeStr,
      status: "LOST",
      confidence: `${Math.round(track.confidence * 100)}%`
    });
    if (this.targetHistory.length > 25) this.targetHistory.pop();
  }

  _updateTargetDisplays() {
    const count = this.activeTracks.length;

    // Update alert banner
    const alertBox = document.getElementById('camera-alert-banner');
    if (alertBox) {
      if (count > 0) {
        alertBox.style.display = 'flex';
        const msg = document.getElementById('camera-alert-message');
        if (msg) {
          msg.textContent = `${count} VISUAL TARGET${count > 1 ? 'S' : ''} TRACKED: [${this.activeTracks.map(t => t.id).join(', ')}] plotted on synthetic radar.`;
        }
      } else {
        alertBox.style.display = 'none';
      }
    }

    // Fullscreen Alert Modal
    const fsModal = document.getElementById('fullscreen-alert-modal');
    if (fsModal) {
      if (this.fullScreenAlertMode && count > 0) {
        fsModal.classList.add('active');
        const fsId = document.getElementById('fs-target-id');
        if (fsId) fsId.textContent = this.activeTracks.map(t => t.id).join(' | ');
      } else {
        fsModal.classList.remove('active');
      }
    }

    // Update Live Multi-Target Cards in UI
    const targetsList = document.getElementById('cam-active-targets-list');
    if (targetsList) {
      if (count === 0) {
        targetsList.innerHTML = '<div style="color: #64748b; font-family: monospace; font-size: 0.78rem; padding: 6px;">NO VISUAL TARGETS DETECTED</div>';
      } else {
        targetsList.innerHTML = '';
        this.activeTracks.forEach(t => {
          const card = document.createElement('div');
          card.style.background = 'rgba(5, 12, 24, 0.75)';
          card.style.border = `1px solid ${t.color}`;
          card.style.borderRadius = '4px';
          card.style.padding = '8px';
          card.style.marginBottom = '6px';
          card.style.fontFamily = 'monospace';
          card.style.fontSize = '0.75rem';

          card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-weight: bold; color: ${t.color};">${t.id} — ${t.category}</span>
              <span style="color: #00ff88; font-weight: bold;">● TRACKING</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; color: #cbd5e1;">
              <div>Range: <strong style="color: #fff;">${t.syntheticRangeM} m</strong></div>
              <div>Bearing: <strong style="color: #fff;">${t.syntheticBearingDeg}°</strong></div>
              <div>Band: <strong style="color: #00f0ff;">${t.associatedBand} (${t.syntheticFreq} GHz)</strong></div>
              <div>Activity: <strong style="color: #00ff88;">${t.activityPct}%</strong></div>
            </div>
          `;
          targetsList.appendChild(card);
        });
      }
    }

    const missionList = document.getElementById('cam-active-targets-list-mission');
    const badgeCount = document.getElementById('cam-target-count-badge');
    if (badgeCount) {
      badgeCount.textContent = `${count} ACTIVE`;
      badgeCount.className = count > 0 ? "data-value highlight-green" : "data-value highlight-red";
    }
    if (missionList && targetsList) {
      missionList.innerHTML = targetsList.innerHTML;
    }

    // Update Target History Table
    const tbody = document.getElementById('cam-target-history-tbody');
    if (tbody) {
      tbody.innerHTML = '';
      // Active tracks first
      this.activeTracks.forEach(t => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        tr.innerHTML = `
          <td style="padding: 6px; font-weight: bold; color: ${t.color};">${t.id}</td>
          <td style="padding: 6px;">${t.category}</td>
          <td style="padding: 6px;">${new Date(t.firstSeen).toTimeString().split(' ')[0]}</td>
          <td style="padding: 6px;">${new Date(t.lastSeen).toTimeString().split(' ')[0]}</td>
          <td style="padding: 6px; color: #00ff88; font-weight: bold;">TRACKING</td>
          <td style="padding: 6px;">${Math.round(t.confidence * 100)}%</td>
        `;
        tbody.appendChild(tr);
      });
      // Archived lost tracks
      this.targetHistory.slice(0, 8).forEach(t => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        tr.innerHTML = `
          <td style="padding: 6px; font-weight: bold; color: #94a3b8;">${t.target_id}</td>
          <td style="padding: 6px; color: #94a3b8;">${t.category}</td>
          <td style="padding: 6px; color: #64748b;">${t.first_seen}</td>
          <td style="padding: 6px; color: #64748b;">${t.last_seen}</td>
          <td style="padding: 6px; color: #ff2a4b; font-weight: bold;">LOST</td>
          <td style="padding: 6px; color: #64748b;">${t.confidence}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    // Direct Instant Radar Plot (Zero Latency)
    // Synchronize active camera targets into global window so Radar HUDs draw them immediately
    window.cameraActiveTargets = this.activeTracks.map(t => ({
      object_id: t.id,
      classification: t.category,
      x: t.radarX,
      y: t.radarY,
      distance: Math.hypot(t.radarX, t.radarY),
      direction: t.syntheticBearingDeg > 180 ? 'W' : 'E',
      heading_deg: t.syntheticBearingDeg,
      velocity_kmh: 24.0,
      current_band: t.associatedBand,
      confidence: t.confidence,
      status: "TRACKING",
      risk_level: "HIGH",
      customColor: t.color
    }));
  }

  _sendBatchDetectionsToBackend() {
    if (this.activeTracks.length === 0) return;

    const payload = {
      detections: this.activeTracks.map(t => ({
        target_id: t.id,
        box_x: t.normX,
        box_y: t.normY,
        box_w: t.normW,
        box_h: t.normH,
        confidence: t.confidence,
        category: t.category
      }))
    };

    fetch('/api/camera/detections-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  }
}

window.LiveCameraRadarController = LiveCameraRadarController;
