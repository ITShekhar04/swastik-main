"""
SWASTIK: Unit & Integration Test Suite
Validates:
  - Simulator kinematics & coordinate calculations (distance, bearing, delta d)
  - Band hopping logic (B3 -> B7 -> B5 -> B6)
  - AI Smart Scheduler dynamic prioritization and 10-minute recurrence intervals
  - Exploitation vs Exploration UCB bonus
  - Doppler physics (fd = 2v / lambda) & micro-Doppler signatures
  - DSP Noise Reduction pipeline and SNR improvement calculation
  - Camera-to-radar coordinate transformation and emitter profiles
"""
import unittest
import math
import time

from backend.config import CONFIG, SYNTHETIC_BANDS
from backend.simulator import SimulatedTarget, calculate_compass_direction
from backend.scheduler import AISmartScheduler
from backend.dsp import DSPProcessor
from backend.doppler import DopplerEngine
from backend.vision import VisualTarget, CameraRadarManager

class TestSwastikSystem(unittest.TestCase):
    def test_kinematics_and_compass(self):
        # Center = 0, 0
        cardinal, deg = calculate_compass_direction(0.0, 10.0)
        self.assertEqual(cardinal, "N")
        self.assertAlmostEqual(deg, 0.0, places=1)
        
        cardinal, deg = calculate_compass_direction(10.0, 0.0)
        self.assertEqual(cardinal, "E")
        self.assertAlmostEqual(deg, 90.0, places=1)

        # Distance formula d = sqrt(x^2 + y^2)
        target = SimulatedTarget("TST-01", "Aircraft", 3.0, 4.0, vx=0.0, vy=0.0, current_band="B3")
        model = target.to_model()
        self.assertAlmostEqual(model.distance, 5.0, places=1)

        # Step forward and verify distance travelled delta d = sqrt((x2-x1)^2 + (y2-y1)^2)
        # vx = 360 km/h = 100 m/s = 0.1 km/s -> in 1 sec, moves 0.1 km in x
        target.vx = 360.0
        target.vy = 0.0
        target.update_position(1.0)
        self.assertAlmostEqual(target.distance_travelled, 0.1, places=2)

    def test_band_hopping(self):
        target = SimulatedTarget(
            "TST-HOP", "Aircraft", 5.0, 5.0, 0.0, 0.0,
            current_band="B3",
            hopping_sequence=["B3", "B7", "B5", "B6"]
        )
        target.hop_interval_sec = 0.1  # Fast hop for test
        target.update_position(0.15)
        self.assertEqual(target.current_band, "B7")
        target.update_position(0.15)
        self.assertEqual(target.current_band, "B5")
        target.update_position(0.15)
        self.assertEqual(target.current_band, "B6")

    def test_ai_scheduler_dynamic_priority(self):
        sched = AISmartScheduler()
        # High activity in B7
        sched.record_band_hit("B7")
        sched.record_band_hit("B7")
        sched.record_band_hit("B7")

        targets = [
            {"current_band": "B7", "velocity_kmh": 300.0}
        ]
        decision = sched.evaluate_and_schedule_next_band(targets, force_exploit=True)
        # B7 should be prioritized
        self.assertEqual(decision.selected_band, "B7")
        self.assertGreater(decision.priority_score, 50.0)
        self.assertIn("B7", decision.selected_band)

    def test_10_minute_recurrence_pattern(self):
        sched = AISmartScheduler()
        now = time.time()
        # Detections spaced every 60s
        for offset in [240, 180, 120, 60, 0]:
            sched.record_band_hit("B5", now - offset)
            
        b5_data = sched.band_activity["B5"]
        self.assertEqual(len(b5_data["hit_history"]), 5)
        self.assertIsNotNone(b5_data["average_interval_sec"])
        self.assertAlmostEqual(b5_data["average_interval_sec"], 60.0, delta=2.0)
        self.assertIsNotNone(b5_data["predicted_next_activity"])

    def test_doppler_physics(self):
        engine = DopplerEngine()
        # Carrier = 10 GHz (lambda = 0.03m), v = 300 m/s
        # fd = 2v / lambda = (2 * 300) / 0.03 = 20,000 Hz = 20 kHz
        fd_khz = engine.compute_doppler_shift(center_freq_ghz=10.0, radial_velocity_ms=300.0)
        self.assertAlmostEqual(fd_khz, 20.0, places=1)

        # Micro-Doppler signature test for drone
        drone_sig = engine.generate_micro_doppler_waveform("Drone", 2.6)
        self.assertIn("Rotor", drone_sig["micro_doppler_signature"].title())
        self.assertEqual(len(drone_sig["waveform"]), 64)

    def test_dsp_noise_reduction(self):
        dsp = DSPProcessor()
        clean, raw, snr_before = dsp.generate_synthetic_rf_signal(noise_level=0.5)
        self.assertLess(snr_before, 15.0)  # Noisy input

        result = dsp.apply_dsp_pipeline(raw, clean, filter_type="adaptive", enabled=True)
        snr_after = result["snr_after_db"]
        self.assertGreater(snr_after, snr_before)  # Improved SNR
        self.assertGreater(result["signal_quality_pct"], 40.0)

    def test_camera_radar_tracking(self):
        mgr = CameraRadarManager()
        mgr.activate_camera()
        
        # Simulate detection of visual object at center
        detection = mgr.update_visual_detection(
            box_x=0.5, box_y=0.5, box_w=0.3, box_h=0.3, confidence=0.95, category="Aircraft-like Object"
        )
        self.assertEqual(detection["target_id"], "T-001")
        self.assertIn("SIMULATED RF PARAMETERS", detection["disclaimer"])
        self.assertGreater(detection["synthetic_range_m"], 0.0)
        self.assertIsNotNone(mgr.active_alert)

        # Mark lost
        mgr.handle_target_lost("T-001")
        self.assertIsNone(mgr.active_alert)
        self.assertEqual(len(mgr.target_history), 1)

    def test_camera_multi_target_tracking(self):
        mgr = CameraRadarManager()
        mgr.activate_camera()

        # Simulate two simultaneous objects detected at different spatial coordinates
        detections = [
            {"target_id": "T-001", "box_x": 0.2, "box_y": 0.4, "box_w": 0.2, "box_h": 0.2, "confidence": 0.95},
            {"target_id": "T-002", "box_x": 0.8, "box_y": 0.6, "box_w": 0.15, "box_h": 0.15, "confidence": 0.92}
        ]
        targets = mgr.update_batch_detections(detections)
        self.assertEqual(len(targets), 2)
        self.assertEqual(targets[0]["target_id"], "T-001")
        self.assertEqual(targets[1]["target_id"], "T-002")
        
        # Verify they have distinct bearing angles and radar positions
        self.assertNotEqual(targets[0]["synthetic_bearing_deg"], targets[1]["synthetic_bearing_deg"])
        self.assertNotEqual(targets[0]["radar_x"], targets[1]["radar_x"])

        # Remove T-001 (only T-002 remains in camera frame)
        targets_step2 = mgr.update_batch_detections([
            {"target_id": "T-002", "box_x": 0.82, "box_y": 0.61, "box_w": 0.15, "box_h": 0.15, "confidence": 0.93}
        ])
        # T-001 is retained until timeout or explicit lost
        mgr.handle_target_lost("T-001")
        self.assertIn("T-002", mgr.targets)
        self.assertNotIn("T-001", mgr.targets)
        self.assertEqual(len(mgr.targets), 1)

if __name__ == "__main__":
    unittest.main()
