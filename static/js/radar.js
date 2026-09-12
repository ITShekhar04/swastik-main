/**
 * SWASTIK / SPECTRA-X: 2D Synthetic Tactical Radar HUD
 * High-performance Canvas renderer featuring concentric distance rings,
 * 360-deg sweep phosphor animation, target reticles, history trails,
 * velocity vectors, and interactive hover tooltips.
 */
class TacticalRadarHUD {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    
    this.sweepAngle = 0; // radians
    this.sweepSpeed = 0.025; // radians per frame (~4s revolution)
    this.maxRangeKm = 20.0;
    this.ringsKm = [1.0, 2.0, 5.0, 10.0, 20.0];
    this.alertBoundaryKm = 5.0;
    
    this.targets = [];
    this.selectedTargetId = null;
    this.hoveredTarget = null;
    
    this._initCanvas();
    this._bindEvents();
    this._startRenderLoop();
  }

  _initCanvas() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height || rect.width);
    const dpr = window.devicePixelRatio || 1;
    
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.ctx.scale(dpr, dpr);
    this.displaySize = size;
  }

  _bindEvents() {
    window.addEventListener('resize', () => this._initCanvas());
    
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      
      const center = this.displaySize / 2;
      const scale = (this.displaySize / 2 * 0.88) / this.maxRangeKm;
      
      this.hoveredTarget = null;
      for (const t of this.targets) {
        // radar x -> +East (right), y -> +North (up)
        const px = center + t.x * scale;
        const py = center - t.y * scale;
        const dist = Math.hypot(mx - px, my - py);
        if (dist < 18) {
          this.hoveredTarget = t;
          break;
        }
      }
    });

    this.canvas.addEventListener('click', () => {
      if (this.hoveredTarget) {
        this.selectedTargetId = this.hoveredTarget.object_id;
        if (window.tacticalAudio) window.tacticalAudio.playChirp();
        if (window.onTargetSelected) window.onTargetSelected(this.hoveredTarget);
      }
    });
  }

  updateTargets(targets) {
    this.targets = targets || [];
  }

  _startRenderLoop() {
    const render = () => {
      this._draw();
      this.sweepAngle = (this.sweepAngle + this.sweepSpeed) % (Math.PI * 2);
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  _draw() {
    const ctx = this.ctx;
    const size = this.displaySize;
    if (!size) return;
    const center = size / 2;
    const radius = center * 0.88;
    const kmToPx = radius / this.maxRangeKm;

    ctx.clearRect(0, 0, size, size);

    // 1. Radar background
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#050c18';
    ctx.fill();
    ctx.clip();

    // 2. Concentric Range Rings
    this.ringsKm.forEach((rKm) => {
      const rPx = rKm * kmToPx;
      ctx.beginPath();
      ctx.arc(center, center, rPx, 0, Math.PI * 2);
      
      if (rKm === this.alertBoundaryKm) {
        // Alert boundary ring
        ctx.strokeStyle = 'rgba(255, 42, 75, 0.45)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
      } else {
        ctx.strokeStyle = 'rgba(30, 58, 95, 0.45)';
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
      }
      ctx.stroke();

      // Range labels (along North axis)
      ctx.fillStyle = rKm === this.alertBoundaryKm ? '#ff2a4b' : 'rgba(0, 240, 255, 0.6)';
      ctx.font = '9px monospace';
      ctx.fillText(`${rKm} km`, center + 4, center - rPx + 11);
    });

    // 3. Cardinal crosshairs & Angle Radials
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = 'rgba(30, 58, 95, 0.4)';
    ctx.lineWidth = 1;

    for (let deg = 0; deg < 360; deg += 45) {
      const rad = (deg - 90) * (Math.PI / 180);
      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.lineTo(center + Math.cos(rad) * radius, center + Math.sin(rad) * radius);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Cardinal Labels (N, NE, E, SE, S, SW, W, NW)
    const cardinals = [
      { text: "N 000°", deg: 0 },
      { text: "E 090°", deg: 90 },
      { text: "S 180°", deg: 180 },
      { text: "W 270°", deg: 270 }
    ];
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    cardinals.forEach(c => {
      const rad = (c.deg - 90) * (Math.PI / 180);
      const lx = center + Math.cos(rad) * (radius - 14);
      const ly = center + Math.sin(rad) * (radius - 14) + 4;
      ctx.fillText(c.text, lx, ly);
    });

    // 4. Rotating Sweep Beam with Phosphor Gradient Fade
    const sweepGrad = ctx.createRadialGradient(center, center, 0, center, center, radius);
    sweepGrad.addColorStop(0, 'rgba(0, 240, 255, 0.35)');
    sweepGrad.addColorStop(1, 'rgba(0, 240, 255, 0.0)');

    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.arc(center, center, radius, this.sweepAngle - 0.4, this.sweepAngle, false);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 240, 255, 0.08)';
    ctx.fill();

    // Leading Sweep Line
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.lineTo(center + Math.cos(this.sweepAngle) * radius, center + Math.sin(this.sweepAngle) * radius);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 5. Center Radar Transmitter Reticle (0, 0)
    ctx.beginPath();
    ctx.arc(center, center, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#00ff88';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.5)';
    ctx.stroke();

    // 6. Draw Targets (simulation + live camera targets)
    const renderTargets = [...this.targets];
    if (window.cameraActiveTargets && window.cameraActiveTargets.length > 0) {
      const existingIds = new Set(renderTargets.map(t => t.object_id));
      for (const camT of window.cameraActiveTargets) {
        if (!existingIds.has(camT.object_id)) {
          renderTargets.push(camT);
        }
      }
    }

    for (const t of renderTargets) {
      const tx = center + t.x * kmToPx;
      const ty = center - t.y * kmToPx;

      // Draw historical trajectory breadcrumbs
      if (t.history && t.history.length > 1) {
        ctx.beginPath();
        for (let i = 0; i < t.history.length; i++) {
          const hx = center + t.history[i].x * kmToPx;
          const hy = center - t.history[i].y * kmToPx;
          if (i === 0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
        }
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.22)';
        ctx.setLineDash([2, 2]);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Velocity vector line
      if (t.velocity_kmh > 10) {
        const headingRad = ((t.heading_deg || 0) - 90) * (Math.PI / 180);
        const vLen = Math.min(30, (t.velocity_kmh / 30.0) * kmToPx * 0.8);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + Math.cos(headingRad) * vLen, ty + Math.sin(headingRad) * vLen);
        ctx.strokeStyle = 'rgba(0, 255, 136, 0.7)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Choose Color & Reticle
      let targetColor = t.customColor;
      if (!targetColor) {
        if (t.classification === 'Drone') targetColor = '#00ff88';
        else if (t.classification === 'Missile') targetColor = '#ff2a4b';
        else if (t.classification === 'Bird') targetColor = '#c084fc';
        else if (t.risk_level === 'HIGH' || t.distance < this.alertBoundaryKm) targetColor = '#ff2a4b';
        else targetColor = '#00f0ff';
      }

      // Check if sweep line is crossing target -> trigger audio blip
      const targetAngle = Math.atan2(ty - center, tx - center);
      const normTargetAngle = (targetAngle + Math.PI * 2) % (Math.PI * 2);
      const angleDiff = Math.abs(normTargetAngle - this.sweepAngle);
      if (angleDiff < 0.03 && window.tacticalAudio) {
        window.tacticalAudio.playRadarBlip();
      }

      // Draw Reticle Blip
      ctx.beginPath();
      ctx.arc(tx, ty, 5, 0, Math.PI * 2);
      ctx.fillStyle = targetColor;
      ctx.fill();

      // Outer pulsing ring for selected or alert targets
      const pulseSize = 9 + Math.sin(Date.now() / 150) * 2;
      ctx.beginPath();
      ctx.arc(tx, ty, pulseSize, 0, Math.PI * 2);
      ctx.strokeStyle = targetColor;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Target Tactical Data Tag
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${t.object_id} [${t.current_band}]`, tx + 9, ty - 6);

      ctx.fillStyle = targetColor;
      ctx.font = '9px monospace';
      ctx.fillText(`${t.distance.toFixed(1)}km | ${t.direction}`, tx + 9, ty + 6);
      ctx.fillText(`${t.classification}`, tx + 9, ty + 16);
    }

    ctx.restore(); // Restore clip region

    // Perimeter boundary border
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

window.TacticalRadarHUD = TacticalRadarHUD;
