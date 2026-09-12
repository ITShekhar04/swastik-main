"""
SWASTIK: AI Adaptive Band Scheduler Engine
Implements the core innovation:
  - Transparent Dynamic Priority Scoring
  - Contextual Bandit / Upper Confidence Bound (UCB) Exploration vs Exploitation
  - Markov & Kinematic Transition Activity Predictor
  - Rolling 10-Minute Recurrence Interval Pattern Engine
  - Explainable AI Decision Breakdown
"""
import time
import math
import random
from typing import Dict, List, Any, Tuple, Optional
from backend.config import CONFIG, SYNTHETIC_BANDS, BandDefinition
from backend.models import BandActivityModel, ScanDecisionModel, ReasonBreakdown

class AISmartScheduler:
    def __init__(self):
        self.bands = list(SYNTHETIC_BANDS.keys())
        
        # State tracking per band
        self.band_activity: Dict[str, Dict[str, Any]] = {
            b: {
                "activity_score": 10.0,
                "observation_count": 1,
                "scan_count": 1,
                "last_active_time": None,
                "last_scanned_time": time.time() - random.uniform(5.0, 30.0),
                "hit_history": [],  # Timestamps of detections in rolling 10-min window
                "recurrence_intervals": [],
                "average_interval_sec": None,
                "predicted_next_activity": None,
                "uncertainty": 0.35,
                "staleness_sec": 0.0,
                "current_priority": 20.0,
                "prediction_prob": 0.125
            }
            for b in self.bands
        }
        
        # Markov empirical transition matrix between bands (8x8)
        self.transition_counts: Dict[str, Dict[str, int]] = {
            src: {dst: 1 for dst in self.bands} for src in self.bands
        }
        
        self.total_scans = 8
        self.current_scanned_band = "B3"
        self.next_scanned_band = "B3"
        self.last_decision_timestamp = time.time()
        self.last_decision_model: Optional[ScanDecisionModel] = None

    def record_band_hit(self, band: str, timestamp: Optional[float] = None):
        """Records a synthetic activity detection in the specified band."""
        if band not in self.band_activity:
            return
        now = timestamp or time.time()
        b_data = self.band_activity[band]
        b_data["observation_count"] += 1
        b_data["last_active_time"] = now
        
        # Update rolling 10-minute activity window (600s)
        window = CONFIG.recurrence_window_seconds
        b_data["hit_history"].append(now)
        b_data["hit_history"] = [t for t in b_data["hit_history"] if now - t <= window]
        
        # Update recurrence intervals
        hits = b_data["hit_history"]
        if len(hits) >= 2:
            intervals = [hits[i] - hits[i - 1] for i in range(1, len(hits))]
            b_data["recurrence_intervals"] = intervals
            avg_interval = sum(intervals) / len(intervals)
            b_data["average_interval_sec"] = round(avg_interval, 1)
            # Soft prediction for next activity
            b_data["predicted_next_activity"] = round(now + avg_interval, 1)
        
        # Lower uncertainty upon fresh observation
        b_data["uncertainty"] = max(0.08, b_data["uncertainty"] * 0.75)
        # Boost activity score
        b_data["activity_score"] = min(100.0, b_data["activity_score"] + 25.0)

    def record_band_transition(self, from_band: str, to_band: str):
        """Learns transition probability pattern: e.g. B3 -> B7 -> B5 -> B6"""
        if from_band in self.transition_counts and to_band in self.transition_counts[from_band]:
            self.transition_counts[from_band][to_band] += 5

    def predict_band_probabilities(self, active_targets: List[Any]) -> Dict[str, float]:
        """
        AI Prediction Engine:
        Predicts the probability P(activity at band b | current targets & history)
        """
        probs = {b: 0.05 for b in self.bands}
        
        # 1. Target presence and movement trend
        for target in active_targets:
            c_band = getattr(target, "current_band", None) or target.get("current_band")
            if c_band in self.bands:
                # Strong probability on current band
                probs[c_band] += 0.45
                
                # Use learned transition probabilities
                transitions = self.transition_counts.get(c_band, {})
                total_t = sum(transitions.values()) or 1
                for dest_band, count in transitions.items():
                    probs[dest_band] += 0.40 * (count / total_t)

        # 2. Add recurrence schedule influence (soft prediction hint)
        now = time.time()
        for b, data in self.band_activity.items():
            pred_time = data.get("predicted_next_activity")
            if pred_time and abs(now - pred_time) <= 15.0:
                # Due for recurrence
                probs[b] += 0.30

        # Normalize probabilities so sum is 1.0
        total_p = sum(probs.values()) or 1.0
        return {b: round(p / total_p, 3) for b, p in probs.items()}

    def evaluate_and_schedule_next_band(
        self,
        active_targets: List[Any],
        force_exploit: Optional[bool] = None
    ) -> ScanDecisionModel:
        """
        Core SWASTIK Decision Logic:
        Calculates priority for all bands B1 to B8 and picks the optimal next scan.
        """
        now = time.time()
        self.total_scans += 1
        predicted_probs = self.predict_band_probabilities(active_targets)
        
        # Decide whether this cycle is EXPLOITATION or EXPLORATION based on ratio
        exploit_ratio = CONFIG.exploitation_ratio
        if force_exploit is not None:
            is_exploit_cycle = force_exploit
        else:
            is_exploit_cycle = (random.random() < exploit_ratio)

        priority_results = {}
        breakdowns = {}

        for b in self.bands:
            b_data = self.band_activity[b]
            
            # 1. Time since last scan (staleness)
            staleness = max(0.1, now - b_data["last_scanned_time"])
            b_data["staleness_sec"] = round(staleness, 1)
            
            # Uncertainty naturally creeps up over time if not scanned
            b_data["uncertainty"] = min(0.95, b_data["uncertainty"] + 0.008 * staleness)
            
            # Natural decay of activity score over time
            decay = math.exp(-0.02 * staleness)
            recent_activity = b_data["activity_score"] * decay
            
            # Prediction score
            pred_score = predicted_probs.get(b, 0.1) * 100.0
            
            # Movement trend score
            trend_score = 0.0
            for target in active_targets:
                tb = getattr(target, "current_band", None) or target.get("current_band")
                if tb == b:
                    vel = getattr(target, "velocity_kmh", None) or target.get("velocity_kmh", 0)
                    trend_score += min(100.0, 30.0 + vel * 0.1)
                    
            # Historical activity ratio
            hist_score = min(100.0, b_data["observation_count"] * 12.0)
            
            # Staleness score (normalized 0-100)
            staleness_score = min(100.0, staleness * 4.0)
            
            # Uncertainty score (0-100)
            uncert_score = b_data["uncertainty"] * 100.0
            
            # Band scanning cost
            cost = SYNTHETIC_BANDS[b].nominal_cost * 10.0
            
            # Contextual Exploration bonus (Upper Confidence Bound)
            # UCB = uncertainty + c * sqrt(ln(N_total) / N_band)
            ucb_bonus = (b_data["uncertainty"] * 60.0) + (15.0 * math.sqrt(math.log(self.total_scans + 1) / (b_data["scan_count"] + 1)))
            
            # Formula: Priority = w_pred*P + w_recent*A + w_trend*T + w_hist*H + w_uncert*U + w_stale*S - w_cost*C
            w = CONFIG
            raw_priority = (
                w.weight_prediction * pred_score +
                w.weight_recent_activity * recent_activity +
                w.weight_movement_trend * trend_score +
                w.weight_historical * hist_score +
                w.weight_uncertainty * uncert_score +
                w.weight_staleness * staleness_score -
                w.weight_cost * cost
            )
            
            # If in explicit exploration mode, heavily favor the UCB bonus & staleness
            exploration_score = round(min(100.0, ucb_bonus + staleness_score * 0.6), 1)
            exploitation_score = round(min(100.0, max(5.0, raw_priority)), 1)
            
            total_priority = exploitation_score if is_exploit_cycle else exploration_score
            
            # Store in band activity
            b_data["current_priority"] = round(total_priority, 1)
            b_data["prediction_prob"] = round(predicted_probs[b], 3)
            
            priority_results[b] = {
                "priority": total_priority,
                "exploitation": exploitation_score,
                "exploration": exploration_score,
                "prediction": pred_score,
                "recent": recent_activity,
                "trend": trend_score,
                "hist": hist_score,
                "uncertainty": uncert_score,
                "staleness": staleness_score
            }
            
            # Calculate explainability percentages
            denom = (pred_score + recent_activity + trend_score + hist_score + uncert_score + staleness_score) or 1.0
            breakdowns[b] = ReasonBreakdown(
                prediction_pct=round((pred_score / denom) * 100, 1),
                recent_activity_pct=round((recent_activity / denom) * 100, 1),
                movement_trend_pct=round((trend_score / denom) * 100, 1),
                historical_activity_pct=round((hist_score / denom) * 100, 1),
                uncertainty_pct=round((uncert_score / denom) * 100, 1),
                time_since_scan_pct=round((staleness_score / denom) * 100, 1)
            )

        # Select next band with highest priority
        selected_band = max(priority_results.keys(), key=lambda b: priority_results[b]["priority"])
        
        # Update scan statistics for selected band
        self.band_activity[selected_band]["scan_count"] += 1
        self.band_activity[selected_band]["last_scanned_time"] = now
        
        # Build explanation string
        chosen_data = priority_results[selected_band]
        decision_type = "EXPLOIT" if is_exploit_cycle else "EXPLORE"
        if decision_type == "EXPLORE":
            reason_str = f"Exploration scan: high staleness ({chosen_data['staleness']:.0f}s unobserved) and elevated uncertainty ({chosen_data['uncertainty']:.1f}%)."
        else:
            reason_str = f"High predicted activity ({chosen_data['prediction']:.0f}%) driven by target kinematic trend and recent detections."

        decision = ScanDecisionModel(
            selected_band=selected_band,
            previous_band=self.current_scanned_band,
            priority_score=round(chosen_data["priority"], 1),
            prediction_score=round(chosen_data["prediction"], 1),
            exploration_score=round(chosen_data["exploration"], 1),
            exploitation_score=round(chosen_data["exploitation"], 1),
            uncertainty_score=round(chosen_data["uncertainty"], 1),
            reason=reason_str,
            reason_breakdown=breakdowns[selected_band],
            decision_type=decision_type,
            timestamp=now
        )
        
        self.previous_scanned_band = self.current_scanned_band
        self.current_scanned_band = self.next_scanned_band
        self.next_scanned_band = selected_band
        self.last_decision_model = decision
        return decision

    def get_bands_summary(self) -> List[BandActivityModel]:
        """Returns structured status for all bands B1-B8."""
        summary = []
        for b_id, b_def in SYNTHETIC_BANDS.items():
            data = self.band_activity[b_id]
            p = data["current_priority"]
            if p >= 70:
                p_level = "HIGH"
            elif p >= 35:
                p_level = "MEDIUM"
            else:
                p_level = "LOW"
                
            summary.append(BandActivityModel(
                band_id=b_id,
                name=b_def.name,
                freq_range=b_def.freq_range,
                activity_score=round(data["activity_score"], 1),
                observation_count=data["observation_count"],
                last_active_time=data["last_active_time"],
                seconds_since_last_scan=round(time.time() - data["last_scanned_time"], 1),
                average_recurrence_interval_sec=data["average_interval_sec"],
                predicted_next_activity_time=data["predicted_next_activity"],
                uncertainty=round(data["uncertainty"], 2),
                current_priority=p,
                priority_level=p_level
            ))
        return summary

SCHEDULER = AISmartScheduler()
