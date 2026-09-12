"""
SWASTIK: Live Camera-to-Synthetic Radar & Computer Vision Module
Provides:
  - Multi-target visual-to-radar mapping (multiple concurrent objects)
  - Target tracking state machine (DETECTED -> TRACKING -> LOST -> ARCHIVED)
  - Synthetic RF emitter generation per target (unique frequency & band assignment)
  - Integration with SWASTIK Smart Scheduler observation layer
  - Safe Simulation Disclaimer Enforcement
"""
import time
import math
import random
from typing import Dict, List, Any, Optional
from backend.config import CONFIG, SYNTHETIC_BANDS
from backend.scheduler import SCHEDULER

# Pre-assigned synthetic emitter profiles for multi-target visual tracking
DEFAULT_EMITTER_PROFILES = [
    {"freq": 4.72, "var": 0.18, "band": "B4", "category": "Aircraft-like Object"},
    {"freq": 2.45, "var": 0.12, "band": "B3", "category": "Drone-like Object"},
    {"freq": 10.15, "var": 0.25, "band": "B5", "category": "High-Speed Airborne Object"},
    {"freq": 22.40, "var": 0.35, "band": "B7", "category": "Unclassified Airborne Target"},
    {"freq": 15.50, "var": 0.20, "band": "B6", "category": "Autonomous Aerial Vehicle"},
]

class VisualTarget:
    def __init__(self, target_id: str, profile_idx: int = 0, category: str = "Unknown Visual Object"):
        self.target_id = target_id
        profile = DEFAULT_EMITTER_PROFILES[profile_idx % len(DEFAULT_EMITTER_PROFILES)]
        self.category = category if category != "Unknown Visual Object" else profile["category"]
        self.status = "DETECTED"  # DETECTED / TRACKING / LOST
        self.first_seen = time.time()
        self.last_seen = time.time()
        self.confidence = 0.94
        
        # Normalized camera coordinates [0.0 - 1.0]
        self.cam_x = 0.5
        self.cam_y = 0.5
        self.cam_w = 0.2
        self.cam_h = 0.2
        
        # Synthetic Radar Coordinates
        self.synthetic_range_m = 42.0
        self.synthetic_range_km = 0.042
        self.synthetic_bearing_deg = 137.0
        self.radar_x = 3.2
        self.radar_y = 4.1
        
        # Synthetic RF Emitter Profile
        self.synthetic_frequency_ghz = profile["freq"]
        self.frequency_variation_ghz = profile["var"]
        self.activity_level_pct = round(random.uniform(75.0, 92.0), 1)
        self.associated_band = profile["band"]
        
        # Fluctuation history (Time vs Synthetic Activity & Frequency)
        self.history_times: List[float] = []
        self.history_freqs: List[float] = []
        self.history_activities: List[float] = []

    def update_detection(
        self,
        cam_x: float,
        cam_y: float,
        cam_w: float,
        cam_h: float,
        confidence: float = 0.94,
        category: Optional[str] = None
    ):
        now = time.time()
        self.last_seen = now
        self.status = "TRACKING"
        self.confidence = confidence
        if category and category != "Unknown Visual Object":
            self.category = category
            
        self.cam_x = cam_x
        self.cam_y = cam_y
        self.cam_w = cam_w
        self.cam_h = cam_h
        
        # Map camera position to synthetic radar coordinates:
        # Camera horizontal position (0.0=left, 1.0=right) maps to bearing angle:
        # Left maps to 300° (NW), Center maps to 000°/045° (N/NE), Right maps to 090°/135° (E/SE)
        x_offset = (cam_x - 0.5) * 2.0  # [-1.0, 1.0]
        
        # Bearing mapping with wide spatial spread across radar
        bearing = (45.0 + x_offset * 75.0) % 360.0
        if bearing < 0: bearing += 360.0
        self.synthetic_bearing_deg = round(bearing, 1)
        
        # Bounding box size or vertical pos maps to synthetic range [25m to 160m]
        box_area = max(0.01, min(0.6, cam_w * cam_h))
        # Also factor in vertical position (lower down in frame = closer)
        dist_factor = (1.0 - (cam_y * 0.5 + box_area * 1.5))
        dist_factor = max(0.1, min(1.0, dist_factor))
        
        synthetic_dist_m = 20.0 + dist_factor * 110.0
        self.synthetic_range_m = round(max(15.0, min(180.0, synthetic_dist_m)), 1)
        self.synthetic_range_km = round(self.synthetic_range_m / 1000.0, 3)
        
        # Calculate radar x,y in km for 20 km radar display
        # Scaled to appear between 2 km and 14 km on radar map
        rad = math.radians(self.synthetic_bearing_deg)
        disp_scale_km = 3.0 + (self.synthetic_range_m / 15.0)
        self.radar_x = round(disp_scale_km * math.sin(rad), 2)
        self.radar_y = round(disp_scale_km * math.cos(rad), 2)
        
        # Fluctuate synthetic RF parameters
        freq_jitter = random.uniform(-self.frequency_variation_ghz, self.frequency_variation_ghz)
        self.current_synthetic_freq = round(self.synthetic_frequency_ghz + freq_jitter, 3)
        
        act_jitter = random.uniform(-3.0, 3.0)
        self.current_activity_pct = round(max(40.0, min(99.0, self.activity_level_pct + act_jitter)), 1)
        
        self.history_times.append(round(now, 2))
        self.history_freqs.append(self.current_synthetic_freq)
        self.history_activities.append(self.current_activity_pct)
        if len(self.history_times) > 40:
            self.history_times.pop(0)
            self.history_freqs.pop(0)
            self.history_activities.pop(0)
            
        # Feed into Smart Scheduler observation layer:
        SCHEDULER.record_band_hit(self.associated_band)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "target_id": self.target_id,
            "category": self.category,
            "status": self.status,
            "confidence": round(self.confidence, 2),
            "first_seen": time.strftime("%H:%M:%S", time.localtime(self.first_seen)),
            "last_seen": time.strftime("%H:%M:%S", time.localtime(self.last_seen)),
            "cam_x": round(self.cam_x, 3),
            "cam_y": round(self.cam_y, 3),
            "cam_w": round(self.cam_w, 3),
            "cam_h": round(self.cam_h, 3),
            "synthetic_range_m": self.synthetic_range_m,
            "synthetic_bearing_deg": self.synthetic_bearing_deg,
            "radar_x": self.radar_x,
            "radar_y": self.radar_y,
            "synthetic_frequency_ghz": getattr(self, "current_synthetic_freq", self.synthetic_frequency_ghz),
            "synthetic_activity_pct": getattr(self, "current_activity_pct", self.activity_level_pct),
            "frequency_variation_ghz": self.frequency_variation_ghz,
            "associated_band": self.associated_band,
            "history_times": self.history_times[-25:],
            "history_freqs": self.history_freqs[-25:],
            "history_activities": self.history_activities[-25:],
            "disclaimer": "SIMULATED RF PARAMETERS — NOT MEASURED BY WEBCAM"
        }

class CameraRadarManager:
    def __init__(self):
        self.is_active = False
        self.is_paused = False
        self.targets: Dict[str, VisualTarget] = {}
        self.target_counter = 1
        self.active_alert: Optional[Dict[str, Any]] = None
        self.last_alert_time = 0.0
        self.target_history: List[Dict[str, Any]] = []

    def activate_camera(self):
        self.is_active = True
        self.is_paused = False

    def deactivate_camera(self):
        self.is_active = False
        self.targets.clear()
        self.active_alert = None

    def update_batch_detections(self, detections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Receives multiple simultaneous visual detections from frontend.
        Updates matching targets, creates new ones, and handles lost targets.
        """
        now = time.time()
        seen_ids = set()

        for det in detections:
            tid = det.get("target_id") or f"T-{self.target_counter:03d}"
            seen_ids.add(tid)
            
            if tid not in self.targets:
                self.target_counter += 1
                profile_idx = len(self.targets)
                target = VisualTarget(
                    target_id=tid,
                    profile_idx=profile_idx,
                    category=det.get("category", "Unknown Visual Object")
                )
                self.targets[tid] = target
                
                # Trigger alert for new visual target
                self.active_alert = {
                    "alert_id": f"ALT-CAM-{int(now)}",
                    "target_id": tid,
                    "message": f"Visual object {tid} detected in camera view -> Plotted on synthetic radar.",
                    "synthetic_range": f"{target.synthetic_range_m} m",
                    "bearing": f"{target.synthetic_bearing_deg}°",
                    "activity": "HIGH",
                    "timestamp": now,
                    "time_str": time.strftime("%H:%M:%S")
                }
            else:
                target = self.targets[tid]

            target.update_detection(
                cam_x=det["box_x"],
                cam_y=det["box_y"],
                cam_w=det["box_w"],
                cam_h=det["box_h"],
                confidence=det.get("confidence", 0.94),
                category=det.get("category")
            )

        # Check for expired targets not seen in this batch
        expired = []
        for tid, t in self.targets.items():
            if tid not in seen_ids:
                if now - t.last_seen > 2.2:  # Timeout 2.2s
                    expired.append(tid)

        for tid in expired:
            self.handle_target_lost(tid)

        return [t.to_dict() for t in self.targets.values()]

    def update_visual_detection(
        self,
        box_x: float,
        box_y: float,
        box_w: float,
        box_h: float,
        confidence: float = 0.94,
        category: str = "Unknown Visual Object"
    ) -> Dict[str, Any]:
        """Single detection fallback."""
        res = self.update_batch_detections([{
            "target_id": "T-001",
            "box_x": box_x,
            "box_y": box_y,
            "box_w": box_w,
            "box_h": box_h,
            "confidence": confidence,
            "category": category
        }])
        return res[0] if res else {}

    def handle_target_lost(self, target_id: str):
        """Called when a specific visual object is no longer in camera frame."""
        if target_id in self.targets:
            t = self.targets[target_id]
            t.status = "LOST"
            # Archive to history
            self.target_history.insert(0, {
                "target_id": t.target_id,
                "category": t.category,
                "first_seen": time.strftime("%H:%M:%S", time.localtime(t.first_seen)),
                "last_seen": time.strftime("%H:%M:%S", time.localtime(t.last_seen)),
                "status": "LOST",
                "confidence": f"{int(t.confidence * 100)}%"
            })
            if len(self.target_history) > 25:
                self.target_history.pop()
                
            del self.targets[target_id]

        if not self.targets:
            self.active_alert = None

    def get_status(self) -> Dict[str, Any]:
        return {
            "is_active": self.is_active,
            "is_paused": self.is_paused,
            "active_targets": [t.to_dict() for t in self.targets.values()],
            "active_alert": self.active_alert,
            "target_history": self.target_history[:12],
            "disclaimer": "SIMULATION / COMPUTER VISION INPUT — NOT A REAL RADAR SENSOR"
        }

CAMERA_RADAR = CameraRadarManager()
