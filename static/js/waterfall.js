/**
 * SWASTIK / SPECTRA-X: 2D Spectrum Waterfall (Time-Frequency Heatmap)
 * Renders continuous scrolling RF activity across synthetic bands B1-B8.
 * Features dynamic receiver scan highlights, predicted activity markers,
 * and exploration regions.
 */
class SpectrumWaterfallCanvas {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    
    this.bands = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"];
    this.bandLabels = [
      "B1 (VLF/LF)", "B2 (HF)", "B3 (VHF/UHF)", "B4 (S/C)",
      "B5 (X)", "B6 (Ku)", "B7 (K)", "B8 (Ka)"
    ];
    
    this.activeScanBand = "B3";
    this.predictedBand = "B7";
    this.explorationBand = "B8";
    
    // Internal rolling buffer of history lines: each row has 8 float values [0.0 - 1.0]
    this.historyRows = 140;
    this.buffer = [];
    for (let r = 0; r < this.historyRows; r++) {
      this.buffer.push(new Array(8).fill(0.05));
    }
    
    this._initCanvas();
    window.addEventListener('resize', () => this._initCanvas());
    this._startRenderLoop();
  }

  _initCanvas() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = 420 * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = 420;
  }

  pushBandActivity(bandScores, activeScanBand, predictedBand, explorationBand) {
    if (activeScanBand) this.activeScanBand = activeScanBand;
    if (predictedBand) this.predictedBand = predictedBand;
    if (explorationBand) this.explorationBand = explorationBand;

    const newRow = this.bands.map(b => {
      let score = (bandScores && bandScores[b]) || 0.05;
      // Add slight synthetic fluctuation for realistic RF waterfall texture
      return Math.max(0.02, Math.min(1.0, score + (Math.random() - 0.5) * 0.08));
    });

    this.buffer.unshift(newRow);
    if (this.buffer.length > this.historyRows) {
      this.buffer.pop();
    }
  }

  _getColorForIntensity(val) {
    // Thermal / Tactical Waterfall Colormap: Deep blue -> Cyan -> Emerald -> Amber -> Red
    if (val < 0.15) return 'rgb(5, 12, 28)';
    if (val < 0.35) return `rgb(0, ${Math.floor(val * 450)}, ${Math.floor(val * 600 + 50)})`;
    if (val < 0.6) return `rgb(0, ${Math.floor(val * 380 + 20)}, ${Math.floor((1 - val) * 200)})`;
    if (val < 0.82) return `rgb(${Math.floor(val * 300)}, ${Math.floor(200 - val * 60)}, 0)`;
    return `rgb(255, ${Math.floor((1 - val) * 250)}, ${Math.floor((1 - val) * 100)})`;
  }

  _startRenderLoop() {
    const render = () => {
      this._draw();
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  _draw() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);

    const headerHeight = 35;
    const timeAxisWidth = 50;
    const plotWidth = w - timeAxisWidth;
    const plotHeight = h - headerHeight;
    const colWidth = plotWidth / 8;
    const rowHeight = plotHeight / this.historyRows;

    // 1. Draw Waterfall Heatmap Rows
    for (let r = 0; r < this.buffer.length; r++) {
      const y = headerHeight + r * rowHeight;
      const row = this.buffer[r];
      for (let c = 0; c < 8; c++) {
        const x = timeAxisWidth + c * colWidth;
        ctx.fillStyle = this._getColorForIntensity(row[c]);
        ctx.fillRect(x, y, colWidth, Math.ceil(rowHeight) + 1);
      }
    }

    // 2. Draw Column Grid Lines & Band Labels
    ctx.strokeStyle = 'rgba(30, 58, 95, 0.6)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= 8; c++) {
      const x = timeAxisWidth + c * colWidth;
      ctx.beginPath();
      ctx.moveTo(x, headerHeight);
      ctx.lineTo(x, h);
      ctx.stroke();

      if (c < 8) {
        // Band Header Bar
        const isCurrentScan = (this.bands[c] === this.activeScanBand);
        ctx.fillStyle = isCurrentScan ? 'rgba(0, 240, 255, 0.25)' : 'rgba(10, 17, 32, 0.9)';
        ctx.fillRect(x + 1, 4, colWidth - 2, headerHeight - 6);

        ctx.fillStyle = isCurrentScan ? '#00f0ff' : '#94a3b8';
        ctx.font = isCurrentScan ? 'bold 11px monospace' : '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(this.bandLabels[c], x + colWidth / 2, 22);

        if (isCurrentScan) {
          ctx.strokeStyle = '#00f0ff';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x + 1, 4, colWidth - 2, headerHeight - 6);
        }
      }
    }

    // 3. Highlight Currently Scanned Band with Glowing Receiver Window
    const activeIdx = this.bands.indexOf(this.activeScanBand);
    if (activeIdx !== -1) {
      const ax = timeAxisWidth + activeIdx * colWidth;
      
      // Animated pulsing glow bracket
      const alpha = 0.5 + Math.sin(Date.now() / 200) * 0.3;
      ctx.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(ax + 2, headerHeight + 2, colWidth - 4, plotHeight - 4);

      // Top label badge: "ACTIVE RECEIVER WINDOW"
      ctx.fillStyle = '#00f0ff';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`RECEIVER [${this.activeScanBand}]`, ax + colWidth / 2, headerHeight + 16);
    }

    // 4. Highlight Predicted Band (Amber Dashed Marker)
    const predIdx = this.bands.indexOf(this.predictedBand);
    if (predIdx !== -1 && predIdx !== activeIdx) {
      const px = timeAxisWidth + predIdx * colWidth;
      ctx.strokeStyle = 'rgba(255, 170, 0, 0.7)';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 4, headerHeight + 20, colWidth - 8, 40);
      ctx.setLineDash([]);
      
      ctx.fillStyle = '#ffaa00';
      ctx.font = '8px monospace';
      ctx.fillText("PREDICTED TARGET", px + colWidth / 2, headerHeight + 35);
    }

    // 5. Highlight Exploration Band (Purple Marker)
    const expIdx = this.bands.indexOf(this.explorationBand);
    if (expIdx !== -1 && expIdx !== activeIdx) {
      const ex = timeAxisWidth + expIdx * colWidth;
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.6)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ex + 4, headerHeight + 70, colWidth - 8, 35);
      ctx.setLineDash([]);
      
      ctx.fillStyle = '#c084fc';
      ctx.font = '8px monospace';
      ctx.fillText("EXPLORATION", ex + colWidth / 2, headerHeight + 85);
    }

    // 6. Time Axis Labels (Y-axis)
    ctx.fillStyle = '#64748b';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText("NOW", timeAxisWidth - 6, headerHeight + 12);
    ctx.fillText("-15s", timeAxisWidth - 6, headerHeight + plotHeight * 0.25);
    ctx.fillText("-30s", timeAxisWidth - 6, headerHeight + plotHeight * 0.50);
    ctx.fillText("-60s", timeAxisWidth - 6, headerHeight + plotHeight * 0.75);
    ctx.fillText("-120s", timeAxisWidth - 6, headerHeight + plotHeight - 4);
  }
}

window.SpectrumWaterfallCanvas = SpectrumWaterfallCanvas;
