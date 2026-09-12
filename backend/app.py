"""
SWASTIK: SPECTRA-X FastAPI Application Server
Provides REST APIs, WebSocket live telemetry broadcast, simulation loop,
and serves the tactical military command HUD frontend.
"""
import asyncio
import time
import os
import math
import numpy as np
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, List, Any, Optional

from backend.config import CONFIG, SYNTHETIC_BANDS
from backend.models import (
    ObjectModel, BandActivityModel, ScanDecisionModel,
    AlertModel, SignalQualityModel, DopplerProfileModel
)
from backend.database import DB
from backend.simulator import SIMULATION
from backend.scheduler import SCHEDULER
from backend.dsp import DSP_ENGINE
from backend.doppler import DOPPLER_ENGINE
from backend.vision import CAMERA_RADAR
from backend.analytics import ANALYTICS
from backend.websocket_manager import WS_MANAGER

# Background simulation runner
sim_task: Optional[asyncio.Task] = None

async def simulation_loop():
    """Continuous simulation clock updating at ~12 Hz."""
    dt = 1.0 / CONFIG.simulation_tick_rate_hz
    while True:
        try:
            t0 = time.time()
            # 1. Update simulation kinematics
            SIMULATION.tick(dt)
            
            # 2. Extract targets
            target_models = [t.to_model() for t in SIMULATION.targets.values()]
            
            # 3. If Camera Radar has active targets, add all to target models
            if CAMERA_RADAR.is_active:
                from backend.simulator import calculate_compass_direction
                for cam_t in list(CAMERA_RADAR.targets.values()):
                    dist_km = round(math.sqrt(cam_t.radar_x**2 + cam_t.radar_y**2), 2)
                    cardinal, bearing_deg = calculate_compass_direction(cam_t.radar_x, cam_t.radar_y)
                    cam_model = ObjectModel(
                        object_id=cam_t.target_id,
                        classification=cam_t.category,
                        x=cam_t.radar_x,
                        y=cam_t.radar_y,
                        prev_x=cam_t.radar_x,
                        prev_y=cam_t.radar_y,
                        distance=dist_km,
                        distance_travelled=0.1,
                        direction=cardinal,
                        heading_deg=bearing_deg,
                        velocity_kmh=24.0,
                        radial_velocity_ms=6.5,
                        current_band=cam_t.associated_band,
                        confidence=cam_t.confidence,
                        status=cam_t.status,
                        risk_level="HIGH" if dist_km < CONFIG.alert_boundary_km else "MEDIUM",
                        history=[],
                        emitter_profile={
                            "band_id": cam_t.associated_band,
                            "center_freq_ghz": cam_t.synthetic_frequency_ghz,
                            "signal_strength_dbm": -52.0,
                            "doppler_shift_khz": 2.4,
                            "radial_velocity_ms": 6.5,
                            "activity_level_pct": int(cam_t.activity_level_pct)
                        }
                    )
                    target_models.append(cam_model)

            # 4. Generate DSP signal quality metrics for currently scanned band
            curr_band = SCHEDULER.current_scanned_band
            clean, raw, snr_before = DSP_ENGINE.generate_synthetic_rf_signal(
                center_freq_hz=35.0,
                signal_amplitude=1.0,
                noise_level=0.5 if not CONFIG.noise_reduction_enabled else 0.4
            )
            dsp_out = DSP_ENGINE.apply_dsp_pipeline(
                raw_signal=raw,
                clean_ground_truth=clean,
                filter_type="adaptive",
                enabled=CONFIG.noise_reduction_enabled
            )

            # 5. Build live telemetry broadcast payload
            last_decision = SCHEDULER.last_decision_model
            if not last_decision:
                last_decision = SCHEDULER.evaluate_and_schedule_next_band(target_models)

            packet = {
                "system_status": "ONLINE" if SIMULATION.is_running else "PAUSED",
                "simulation_mode": True,
                "ai_confidence": round(0.92 + (time.time() % 4) * 0.01, 2),
                "processing_latency_ms": round(22.0 + (time.time() % 3) * 1.5, 1),
                "timestamp": round(time.time(), 2),
                "current_scan_band": SCHEDULER.current_scanned_band,
                "next_scan_band": SCHEDULER.next_scanned_band,
                "exploit_balance_pct": round(CONFIG.exploitation_ratio * 100, 1),
                "explore_balance_pct": round((1.0 - CONFIG.exploitation_ratio) * 100, 1),
                "demo_step": SIMULATION.demo_step,
                "demo_description": SIMULATION.demo_descriptions.get(SIMULATION.demo_step, ""),
                "active_objects": [t.model_dump() for t in target_models],
                "bands": [b.model_dump() for b in SCHEDULER.get_bands_summary()],
                "current_decision": last_decision.model_dump(),
                "signal_quality": {
                    "snr_before_db": round(snr_before, 2),
                    "snr_after_db": dsp_out["snr_after_db"],
                    "noise_level_db": round(-snr_before, 1),
                    "signal_quality_pct": dsp_out["signal_quality_pct"],
                    "filter_status": dsp_out["filter_status"],
                    "noise_reduction_enabled": CONFIG.noise_reduction_enabled,
                    "raw_signal": np.round(raw, 3).tolist()[:128],
                    "filtered_signal": dsp_out["filtered_signal"][:128],
                    "fft_freqs": dsp_out["fft_freqs"],
                    "fft_amplitudes": dsp_out["fft_amplitudes"]
                },
                "active_alerts": [a.model_dump() for a in SIMULATION.alerts[:6]],
                "camera_status": CAMERA_RADAR.get_status(),
                "recent_events": SIMULATION.event_log[-8:]
            }

            # Broadcast via WebSocket
            await WS_MANAGER.broadcast_json(packet)
            
            elapsed = time.time() - t0
            sleep_time = max(0.01, dt - elapsed)
            await asyncio.sleep(sleep_time)
        except Exception as e:
            await asyncio.sleep(0.1)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global sim_task
    import math, numpy as np  # Ensure imported in scope
    sim_task = asyncio.create_task(simulation_loop())
    yield
    if sim_task:
        sim_task.cancel()

app = FastAPI(
    title="SWASTIK",
    description="AI Adaptive Smart Scan & Spectrum Intelligence Simulation Platform",
    version="2.4.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_cache_control_header(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.endswith((".js", ".css", ".html")) or path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# ----------------- REST API Endpoints -----------------

@app.get("/api/system/status")
def get_system_status():
    return {
        "app_name": CONFIG.app_name,
        "app_subtitle": CONFIG.app_subtitle,
        "version": CONFIG.system_version,
        "status": "ONLINE",
        "simulation_mode": True,
        "is_running": SIMULATION.is_running,
        "is_paused": SIMULATION.is_paused,
        "scenario": SIMULATION.scenario_name,
        "demo_step": SIMULATION.demo_step
    }

@app.get("/api/objects")
def get_active_objects():
    return [t.to_model().model_dump() for t in SIMULATION.targets.values()]

@app.get("/api/objects/{object_id}")
def get_object_details(object_id: str):
    if object_id in SIMULATION.targets:
        return SIMULATION.targets[object_id].to_model().model_dump()
    raise HTTPException(status_code=404, detail=f"Target {object_id} not found")

@app.get("/api/objects/{object_id}/history")
def get_object_history(object_id: str):
    if object_id in SIMULATION.targets:
        return SIMULATION.targets[object_id].history
    return DB.get_object_history(object_id)

@app.get("/api/bands")
def get_bands():
    return SCHEDULER.get_bands_summary()

@app.get("/api/scan/current")
def get_current_scan():
    target_models = [t.to_model() for t in SIMULATION.targets.values()]
    decision = SCHEDULER.evaluate_and_schedule_next_band(target_models)
    return decision.model_dump()

@app.get("/api/scan/history")
def get_scan_history():
    return DB.get_recent_decisions(limit=25)

@app.get("/api/prediction")
def get_predictions():
    target_models = [t.to_model() for t in SIMULATION.targets.values()]
    probs = SCHEDULER.predict_band_probabilities(target_models)
    return {
        "probabilities": probs,
        "recommended_next_scan": max(probs.keys(), key=lambda k: probs[k]),
        "confidence": 0.94
    }

@app.get("/api/analytics")
def get_analytics():
    return ANALYTICS.get_benchmarks()

@app.get("/api/alerts")
def get_alerts():
    return [a.model_dump() for a in SIMULATION.alerts]

@app.post("/api/alerts/{alert_id}/ack")
def acknowledge_alert(alert_id: str):
    for a in SIMULATION.alerts:
        if a.alert_id == alert_id:
            a.acknowledged = True
            return {"status": "ACKNOWLEDGED", "alert_id": alert_id}
    return {"status": "NOT_FOUND"}

@app.get("/api/doppler/{object_id}")
def get_doppler_analysis(object_id: str):
    if object_id not in SIMULATION.targets:
        # Generic profile
        res = DOPPLER_ENGINE.generate_micro_doppler_waveform("Aircraft", 18.0)
        return res
    target = SIMULATION.targets[object_id].to_model()
    center_f = SYNTHETIC_BANDS[target.current_band].center_freq_ghz
    res = DOPPLER_ENGINE.generate_micro_doppler_waveform(
        classification=target.classification,
        doppler_shift_khz=target.emitter_profile.get("doppler_shift_khz", 18.0)
    )
    res["object_id"] = object_id
    res["distance_km"] = target.distance
    res["radial_velocity_ms"] = target.radial_velocity_ms
    res["signal_strength_dbm"] = target.emitter_profile.get("signal_strength_dbm", -65.0)
    return res

@app.get("/api/doppler/archetypes/all")
def get_all_doppler_archetypes():
    results = {}
    for cls_name in ["Aircraft", "Drone", "Missile", "Bird", "Radar", "Communication"]:
        profile = DOPPLER_ENGINE.signatures[cls_name]
        data = DOPPLER_ENGINE.generate_micro_doppler_waveform(cls_name, profile["doppler_shift_khz"])
        data["typical_speed_ms"] = profile["typical_speed_ms"]
        data["typical_band"] = profile["typical_band"]
        data["color"] = profile["color"]
        results[cls_name] = data
    return results

# Simulation Controls
@app.post("/api/simulation/start")
def start_simulation():
    SIMULATION.is_running = True
    SIMULATION.is_paused = False
    SIMULATION.log_event("SYSTEM", "Simulation started.")
    return {"status": "RUNNING"}

@app.post("/api/simulation/pause")
def pause_simulation():
    SIMULATION.is_paused = True
    SIMULATION.log_event("SYSTEM", "Simulation paused.")
    return {"status": "PAUSED"}

@app.post("/api/simulation/reset")
def reset_simulation():
    SIMULATION.reset_simulation()
    return {"status": "RESET"}

@app.post("/api/simulation/demo-step")
def step_demo():
    SIMULATION.step_smart_scan_demo()
    return {
        "step": SIMULATION.demo_step,
        "description": SIMULATION.demo_descriptions.get(SIMULATION.demo_step, "")
    }

@app.post("/api/simulation/scenario/{name}")
def change_scenario(name: str):
    SIMULATION.set_scenario(name)
    return {"status": "OK", "scenario": name}

class AddTargetRequest(BaseModel):
    object_id: str
    classification: str
    x: float
    y: float
    vx: float = 0.0
    vy: float = 0.0
    current_band: str = "B3"
    confidence: float = 0.94

@app.post("/api/simulation/add-object")
def add_object(req: AddTargetRequest):
    SIMULATION.add_target(
        object_id=req.object_id,
        classification=req.classification,
        x=req.x,
        y=req.y,
        vx=req.vx,
        vy=req.vy,
        current_band=req.current_band,
        confidence=req.confidence
    )
    return {"status": "ADDED", "object_id": req.object_id}

@app.delete("/api/simulation/remove-object/{object_id}")
def remove_object(object_id: str):
    SIMULATION.remove_target(object_id)
    return {"status": "REMOVED", "object_id": object_id}

# DSP Controls
@app.post("/api/signal-quality/toggle")
def toggle_dsp():
    CONFIG.noise_reduction_enabled = not CONFIG.noise_reduction_enabled
    SIMULATION.log_event(
        "DSP",
        f"Adaptive Noise Reduction toggled: {'ENABLED' if CONFIG.noise_reduction_enabled else 'DISABLED'}"
    )
    return {"noise_reduction_enabled": CONFIG.noise_reduction_enabled}

# Live Camera Radar Module
@app.get("/api/camera/status")
def get_camera_status():
    return CAMERA_RADAR.get_status()

@app.post("/api/camera/activate")
def activate_camera():
    CAMERA_RADAR.activate_camera()
    SIMULATION.log_event("CAMERA", "Live Camera-to-Synthetic Radar mode activated.")
    return {"status": "ACTIVE"}

@app.post("/api/camera/deactivate")
def deactivate_camera():
    CAMERA_RADAR.deactivate_camera()
    SIMULATION.log_event("CAMERA", "Live Camera-to-Synthetic Radar mode deactivated.")
    return {"status": "INACTIVE"}

class CameraDetectionRequest(BaseModel):
    target_id: Optional[str] = None
    box_x: float
    box_y: float
    box_w: float
    box_h: float
    confidence: float = 0.94
    category: str = "Unknown Visual Object"

class CameraBatchDetectionRequest(BaseModel):
    detections: List[CameraDetectionRequest]

@app.post("/api/camera/detections-batch")
def record_camera_detections_batch(req: CameraBatchDetectionRequest):
    dets = [d.model_dump() for d in req.detections]
    targets = CAMERA_RADAR.update_batch_detections(dets)
    return {"status": "TRACKING", "active_count": len(targets), "targets": targets}

@app.post("/api/camera/detection")
def record_camera_detection(req: CameraDetectionRequest):
    target = CAMERA_RADAR.update_visual_detection(
        box_x=req.box_x,
        box_y=req.box_y,
        box_w=req.box_w,
        box_h=req.box_h,
        confidence=req.confidence,
        category=req.category
    )
    return {"status": "TRACKING", "target": target}

@app.post("/api/camera/target-lost")
def record_camera_target_lost(target_id: str = "T-001"):
    CAMERA_RADAR.handle_target_lost(target_id)
    return {"status": "TARGET_LOST", "target_id": target_id}

# Settings
@app.get("/api/settings")
def get_settings():
    return CONFIG.model_dump()

class UpdateSettingsRequest(BaseModel):
    weight_prediction: Optional[float] = None
    weight_recent_activity: Optional[float] = None
    weight_movement_trend: Optional[float] = None
    weight_historical: Optional[float] = None
    weight_uncertainty: Optional[float] = None
    weight_staleness: Optional[float] = None
    weight_cost: Optional[float] = None
    exploitation_ratio: Optional[float] = None
    alert_boundary_km: Optional[float] = None

@app.post("/api/settings")
def update_settings(req: UpdateSettingsRequest):
    for field, val in req.model_dump(exclude_unset=True).items():
        if hasattr(CONFIG, field) and val is not None:
            setattr(CONFIG, field, val)
    SIMULATION.log_event("CONFIG", "System configuration weights updated.")
    return CONFIG.model_dump()

# WebSocket Endpoint
@app.websocket("/ws/live")
async def websocket_live_telemetry(websocket: WebSocket):
    await WS_MANAGER.connect(websocket)
    try:
        while True:
            # Keep socket alive and receive client control messages if any
            msg = await websocket.receive_text()
            # Can parse client actions like ping or instant commands
    except WebSocketDisconnect:
        WS_MANAGER.disconnect(websocket)
    except Exception:
        WS_MANAGER.disconnect(websocket)

# Mount Static Files
static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
if os.path.exists(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
