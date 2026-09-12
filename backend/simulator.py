"""
SWASTIK: Synthetic RF & Kinematic Simulation Engine
Provides:
  - 2D Radar Coordinate Kinematics (Center = 0, 0)
  - Distance d = sqrt(x^2 + y^2), Delta d = sqrt((x2-x1)^2 + (y2-y1)^2)
  - Object Archetypes: Aircraft, Drone, Missile, Unknown, Bird
  - Multi-Band Hopping Dynamics (e.g., B3 -> B7 -> B5 -> B6)
  - Scenario Engine & 8-Step Interactive Smart Scan Demo Walkthrough
  - Safe Perimeter Monitoring Boundary Alerts
"""
import time
import math
import random
from typing import Dict, List, Any, Optional, Tuple
from backend.config import CONFIG, SYNTHETIC_BANDS
from backend.models import ObjectModel, AlertModel
from backend.doppler import DOPPLER_ENGINE
from backend.scheduler import SCHEDULER
from backend.database import DB

def calculate_compass_direction(x: float, y: float) -> Tuple[str, float]:
    """Calculates bearing (0-360 deg) and cardinal direction from radar center (0,0)."""
    # Radar standard: 0 deg = North (+Y), 90 deg = East (+X), 180 deg = South (-Y), 270 deg = West (-X)
    angle_rad = math.atan2(x, y)
    bearing_deg = math.degrees(angle_rad)
    if bearing_deg < 0:
        bearing_deg += 360.0
    
    compass_sectors = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                       "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    idx = int((bearing_deg + 11.25) / 22.5) % 16
    return compass_sectors[idx], round(bearing_deg, 1)

class SimulatedTarget:
    def __init__(
        self,
        object_id: str,
        classification: str,
        x: float,
        y: float,
        vx: float,
        vy: float,
        current_band: str = "B3",
        confidence: float = 0.94,
        hopping_sequence: Optional[List[str]] = None
    ):
        self.object_id = object_id
        self.classification = classification
        self.x = x
        self.y = y
        self.prev_x = x
        self.prev_y = y
        self.vx = vx  # km/h
        self.vy = vy  # km/h
        self.current_band = current_band
        self.confidence = confidence
        self.status = "TRACKED"
        self.created_at = time.time()
        self.last_updated = time.time()
        self.distance_travelled = 0.0
        
        # Band hopping sequence
        self.hopping_sequence = hopping_sequence or ["B3", "B7", "B5", "B6"]
        self.hop_index = 0
        self.time_in_current_band = 0.0
        self.hop_interval_sec = random.uniform(6.0, 10.0)
        
        # History log
        self.history: List[Dict[str, Any]] = []
        self._record_history_point("Detected in initial band")

    def _record_history_point(self, event_note: str = ""):
        dist = math.sqrt(self.x ** 2 + self.y ** 2)
        direction_str, bearing_deg = calculate_compass_direction(self.x, self.y)
        pt = {
            "timestamp": round(time.time(), 2),
            "time_str": time.strftime("%H:%M:%S"),
            "x": round(self.x, 2),
            "y": round(self.y, 2),
            "distance_km": round(dist, 2),
            "direction": direction_str,
            "bearing_deg": bearing_deg,
            "band": self.current_band,
            "confidence": round(self.confidence, 2),
            "note": event_note
        }
        self.history.append(pt)
        if len(self.history) > 30:
            self.history.pop(0)

    def update_position(self, dt_sec: float):
        self.prev_x = self.x
        self.prev_y = self.y
        prev_dist = math.sqrt(self.prev_x ** 2 + self.prev_y ** 2)

        # Convert vx, vy from km/h to km/s
        dx = (self.vx / 3600.0) * dt_sec
        dy = (self.vy / 3600.0) * dt_sec
        self.x += dx
        self.y += dy

        step_dist = math.sqrt(dx ** 2 + dy ** 2)
        self.distance_travelled += step_dist

        curr_dist = math.sqrt(self.x ** 2 + self.y ** 2)

        # Handle radar bounds: bounce back gently if near boundary (22 km)
        if curr_dist > 22.0:
            self.vx *= -0.9
            self.vy *= -0.9

        # Handle Band Hopping
        self.time_in_current_band += dt_sec
        if self.time_in_current_band >= self.hop_interval_sec:
            self.time_in_current_band = 0.0
            old_band = self.current_band
            self.hop_index = (self.hop_index + 1) % len(self.hopping_sequence)
            self.current_band = self.hopping_sequence[self.hop_index]
            SCHEDULER.record_band_transition(old_band, self.current_band)
            self._record_history_point(f"Hopped from {old_band} to {self.current_band}")

        self.last_updated = time.time()

    def to_model(self) -> ObjectModel:
        dist = math.sqrt(self.x ** 2 + self.y ** 2)
        direction_str, bearing_deg = calculate_compass_direction(self.x, self.y)
        
        # Velocity calculations
        speed_kmh = math.sqrt(self.vx ** 2 + self.vy ** 2)
        speed_ms = (speed_kmh * 1000.0) / 3600.0
        
        # Radial velocity along line of sight
        if dist > 0.001:
            # v_radial = (x*vx + y*vy) / dist in m/s
            v_radial_ms = ((self.x * (self.vx * 1000.0 / 3600.0)) + (self.y * (self.vy * 1000.0 / 3600.0))) / dist
        else:
            v_radial_ms = 0.0

        # Determine risk priority level (abstract simulation priority)
        if dist < CONFIG.alert_boundary_km:
            risk = "HIGH"
        elif dist < 10.0:
            risk = "MEDIUM"
        else:
            risk = "LOW"

        # Synthetic emitter profile
        band_def = SYNTHETIC_BANDS.get(self.current_band, SYNTHETIC_BANDS["B3"])
        carrier_freq = band_def.center_freq_ghz
        sig_strength = DOPPLER_ENGINE.compute_signal_strength(dist)
        doppler_shift = DOPPLER_ENGINE.compute_doppler_shift(carrier_freq, v_radial_ms)

        emitter_profile = {
            "band_id": self.current_band,
            "center_freq_ghz": carrier_freq,
            "signal_strength_dbm": sig_strength,
            "doppler_shift_khz": round(doppler_shift, 2),
            "radial_velocity_ms": round(v_radial_ms, 1),
            "activity_level_pct": int(max(40, min(98, 90.0 - dist * 2.5)))
        }

        return ObjectModel(
            object_id=self.object_id,
            classification=self.classification,
            x=round(self.x, 2),
            y=round(self.y, 2),
            prev_x=round(self.prev_x, 2),
            prev_y=round(self.prev_y, 2),
            distance=round(dist, 2),
            prev_distance=round(math.sqrt(self.prev_x ** 2 + self.prev_y ** 2), 2),
            distance_travelled=round(self.distance_travelled, 2),
            direction=direction_str,
            heading_deg=bearing_deg,
            velocity_kmh=round(speed_kmh, 1),
            radial_velocity_ms=round(v_radial_ms, 1),
            current_band=self.current_band,
            confidence=round(self.confidence, 2),
            status=self.status,
            risk_level=risk,
            history=list(self.history),
            emitter_profile=emitter_profile,
            created_at=self.created_at
        )

class SimulationEngine:
    def __init__(self):
        self.is_running = True
        self.is_paused = False
        self.scenario_name = "smart_scan_demo"
        self.targets: Dict[str, SimulatedTarget] = {}
        self.alerts: List[AlertModel] = []
        self.alert_counter = 1
        self.last_tick_time = time.time()
        self.event_log: List[Dict[str, Any]] = []
        
        # Smart Scan Demo step tracker
        self.demo_step = 1
        self.demo_step_timer = time.time()
        self.demo_descriptions = {
            1: "Step 1: Aircraft AIR-01 detected in Band 3 -> AI scans B3.",
            2: "Step 2: AIR-01 hops to Band 7 -> AI detects trend and switches scan to B7.",
            3: "Step 3: AIR-01 hops to Band 5 -> AI follows dynamically to B5.",
            4: "Step 4: Drone DRN-02 bursts high activity in Band 4 -> AI prioritizes B4.",
            5: "Step 5: Band 8 has not been scanned for long -> AI triggers exploration scan to B8.",
            6: "Step 6: Rolling 10-minute recurrence pattern detected on B5 -> AI computes average interval.",
            7: "Step 7: New unusual high-speed pattern appears -> AI uncertainty rises and scans to investigate.",
            8: "Step 8: Model parameters update with latest observations -> AI Learning Cycle Complete!"
        }
        
        self._init_default_scenario()

    def _init_default_scenario(self):
        self.targets.clear()
        # Primary target demonstrating B3 -> B7 -> B5 -> B6 hopping
        self.add_target(
            object_id="AIR-01",
            classification="Aircraft",
            x=6.2,
            y=5.8,
            vx=-180.0,
            vy=-140.0,
            current_band="B3",
            confidence=0.95,
            hopping_sequence=["B3", "B7", "B5", "B6"]
        )
        # Secondary target: Drone
        self.add_target(
            object_id="DRN-04",
            classification="Drone",
            x=-3.8,
            y=4.2,
            vx=45.0,
            vy=-30.0,
            current_band="B4",
            confidence=0.91,
            hopping_sequence=["B4", "B3", "B4", "B8"]
        )
        self.log_event("SYSTEM", "SWASTIK RF Simulation Engine initialized. Synthetic scenario loaded.")

    def add_target(
        self,
        object_id: str,
        classification: str,
        x: float,
        y: float,
        vx: float,
        vy: float,
        current_band: str = "B3",
        confidence: float = 0.94,
        hopping_sequence: Optional[List[str]] = None
    ):
        target = SimulatedTarget(
            object_id=object_id,
            classification=classification,
            x=x,
            y=y,
            vx=vx,
            vy=vy,
            current_band=current_band,
            confidence=confidence,
            hopping_sequence=hopping_sequence
        )
        self.targets[object_id] = target
        SCHEDULER.record_band_hit(current_band)
        self.log_event("TRACK", f"Synthetic target [{object_id}] ({classification}) created in {current_band}")

    def remove_target(self, object_id: str):
        if object_id in self.targets:
            del self.targets[object_id]
            self.log_event("TRACK", f"Synthetic target [{object_id}] removed from simulation.")

    def reset_simulation(self):
        self.targets.clear()
        self.alerts.clear()
        self.demo_step = 1
        self.demo_step_timer = time.time()
        self._init_default_scenario()
        self.log_event("SYSTEM", "Simulation reset to initial state.")

    def set_scenario(self, scenario_name: str):
        self.scenario_name = scenario_name
        self.targets.clear()
        if scenario_name == "fast_movement":
            self.add_target("MSL-01", "Missile", 14.0, 12.0, -550.0, -480.0, "B6", 0.96, ["B6", "B7"])
            self.add_target("AIR-02", "Aircraft", -12.0, -8.0, 320.0, 240.0, "B5", 0.93, ["B5", "B6"])
        elif scenario_name == "multiple_objects":
            self.add_target("AIR-01", "Aircraft", 8.0, 9.0, -150.0, -100.0, "B3", 0.94)
            self.add_target("DRN-01", "Drone", -4.0, 5.0, 50.0, -20.0, "B4", 0.91)
            self.add_target("DRN-02", "Drone", 5.0, -6.0, -40.0, 40.0, "B3", 0.89)
            self.add_target("UNK-09", "Unknown Airborne Object", -9.0, -7.0, 110.0, 130.0, "B7", 0.78)
            self.add_target("BRD-01", "Bird", 2.0, 1.5, 12.0, -8.0, "B3", 0.85)
        elif scenario_name == "high_activity_band":
            # Test 10-minute recurrence pattern in B5
            self.add_target("RAD-01", "Radar", 7.5, -4.2, 0.0, 0.0, "B5", 0.98)
            self.add_target("AIR-05", "Aircraft", -6.0, 8.0, 180.0, -140.0, "B5", 0.95, ["B5", "B5", "B6", "B5"])
        else:
            self._init_default_scenario()
            
        self.log_event("SCENARIO", f"Switched to scenario: {scenario_name.upper()}")

    def log_event(self, category: str, message: str):
        evt = {
            "timestamp": time.time(),
            "time_str": time.strftime("%H:%M:%S"),
            "category": category,
            "message": message
        }
        self.event_log.append(evt)
        if len(self.event_log) > 50:
            self.event_log.pop(0)

    def step_smart_scan_demo(self):
        """Advances the 8-step Smart Scan Demo sequencer."""
        self.demo_step = (self.demo_step % 8) + 1
        self.demo_step_timer = time.time()
        
        if self.demo_step == 1:
            if "AIR-01" in self.targets:
                self.targets["AIR-01"].current_band = "B3"
                SCHEDULER.record_band_hit("B3")
        elif self.demo_step == 2:
            if "AIR-01" in self.targets:
                old = self.targets["AIR-01"].current_band
                self.targets["AIR-01"].current_band = "B7"
                SCHEDULER.record_band_transition(old, "B7")
                SCHEDULER.record_band_hit("B7")
        elif self.demo_step == 3:
            if "AIR-01" in self.targets:
                old = self.targets["AIR-01"].current_band
                self.targets["AIR-01"].current_band = "B5"
                SCHEDULER.record_band_transition(old, "B5")
                SCHEDULER.record_band_hit("B5")
        elif self.demo_step == 4:
            # High activity in B4
            SCHEDULER.record_band_hit("B4")
            SCHEDULER.record_band_hit("B4")
        elif self.demo_step == 5:
            # Stale B8 triggers exploration
            SCHEDULER.band_activity["B8"]["uncertainty"] = 0.92
            SCHEDULER.band_activity["B8"]["last_scanned_time"] = time.time() - 120.0
        elif self.demo_step == 6:
            # Multi-hit recurrence pattern simulation on B5
            now = time.time()
            SCHEDULER.record_band_hit("B5", now - 240.0)
            SCHEDULER.record_band_hit("B5", now - 180.0)
            SCHEDULER.record_band_hit("B5", now - 120.0)
            SCHEDULER.record_band_hit("B5", now - 60.0)
            SCHEDULER.record_band_hit("B5", now)
        elif self.demo_step == 7:
            # Unusual pattern
            SCHEDULER.band_activity["B6"]["uncertainty"] = 0.88
        elif self.demo_step == 8:
            # Model learning update complete
            pass

        self.log_event("DEMO", self.demo_descriptions[self.demo_step])

    def tick(self, dt_sec: float):
        """Simulation clock update tick."""
        if self.is_paused or not self.is_running:
            return

        # Auto advance demo scenario steps every 7 seconds if in demo mode
        if self.scenario_name == "smart_scan_demo":
            if time.time() - self.demo_step_timer >= 7.0:
                self.step_smart_scan_demo()

        # Update all target kinematics
        target_models = []
        for target in list(self.targets.values()):
            target.update_position(dt_sec)
            t_model = target.to_model()
            target_models.append(t_model)
            
            # Record observation in scheduler
            SCHEDULER.record_band_hit(target.current_band)

            # Check boundary crossing alert (< 5 km)
            if t_model.distance <= CONFIG.alert_boundary_km and t_model.prev_distance > CONFIG.alert_boundary_km:
                self._trigger_perimeter_alert(t_model)

            # Periodically record into DB
            DB.upsert_object(t_model.model_dump())

        # Run scheduler decision cycle
        SCHEDULER.evaluate_and_schedule_next_band(target_models)

    def _trigger_perimeter_alert(self, target: ObjectModel):
        alert_id = f"ALT-{self.alert_counter:04d}"
        self.alert_counter += 1
        now = time.time()
        alert = AlertModel(
            alert_id=alert_id,
            timestamp=now,
            time_str=time.strftime("%H:%M:%S"),
            object_id=target.object_id,
            alert_type="BOUNDARY_CROSSING",
            distance=target.distance,
            band=target.current_band,
            classification=target.classification,
            confidence=target.confidence,
            severity="CRITICAL",
            message=f"Target {target.object_id} ({target.classification}) crossed monitoring perimeter ({target.distance:.1f} km) in {target.current_band}."
        )
        self.alerts.insert(0, alert)
        if len(self.alerts) > 20:
            self.alerts.pop()
        self.log_event("ALERT", alert.message)
        DB.record_alert(alert.model_dump())

SIMULATION = SimulationEngine()
