import numpy as np
import wfdb
import matplotlib.pyplot as plt
import os
from tensorflow.keras.models import load_model
from scipy.signal import find_peaks
from matplotlib.lines import Line2D

# -----------------------------
# Paths
# -----------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(
    BASE_DIR,
    "ECG-Arrhythmia",
    "mit-database",
    "cnn_model.h5"
)

print(f"Loading model from: {MODEL_PATH}")

# -----------------------------
# Load pretrained CNN model
# -----------------------------
model = load_model(MODEL_PATH)

# Label mapping for arrhythmia types
label_map = {
    0: '/',
    1: 'A',
    2: 'E',
    3: 'L',
    4: 'N',
    5: 'R',
    6: 'V'
}

label_names = {
    '/': "Paced Beat",
    'A': "Atrial Premature Beat",
    'E': "Ventricular Escape Beat",
    'L': "Left Bundle Branch Block Beat",
    'N': "Normal Beat",
    'R': "Right Bundle Branch Block Beat",
    'V': "Premature Ventricular Contraction"
}

# Color map for each beat type
type_colors = {
    'N': 'green',
    'A': 'orange',
    'V': 'red',
    'L': 'blue',
    'R': 'purple',
    'E': 'brown',
    '/': 'gray'
}

# -----------------------------
# Load ECG signal from file
# -----------------------------
def load_ecg(path):
    # channels=[0] to always read only the first channel
    record = wfdb.rdrecord(path, channels=[0])
    signal = record.p_signal[:, 0]
    fs = record.fs
    return signal, fs

# -----------------------------
# Fix record name in .hea file
# -----------------------------
def fix_hea_file(ecg_path):
    hea_file = ecg_path + ".hea"
    record_name = os.path.basename(ecg_path)

    if not os.path.exists(hea_file):
        print(f"ERROR: Header file not found: {hea_file}")
        return False

    with open(hea_file, "r") as f:
        lines = f.readlines()

    old_name = lines[0].strip().split()[0]

    if old_name != record_name:
        print(f"Fixing .hea record name: '{old_name}' -> '{record_name}'")
        fixed_lines = []
        for line in lines:
            fixed_lines.append(line.replace(old_name, record_name))
        with open(hea_file, "w") as f:
            f.writelines(fixed_lines)
        print("Header file fixed successfully.")
    else:
        print("Header file record name is already correct.")

    return True

# -----------------------------
# R Peak Detection
# -----------------------------
def detect_r_peaks(signal, fs):
    # Minimum distance between peaks = 0.6 seconds
    distance = int(0.6 * fs)
    peaks, _ = find_peaks(
        signal,
        distance=distance,
        height=np.mean(signal)
    )
    return peaks

# -----------------------------
# Beat Segmentation
# -----------------------------
def segment_beats(signal, peaks):
    beats = []
    locations = []
    for p in peaks:
        # 180 samples before and after each R peak = 360 total
        if p - 180 >= 0 and p + 180 < len(signal):
            beat = signal[p-180:p+180]
            if len(beat) == 360:
                beats.append(beat)
                locations.append(p)
    return np.array(beats), locations

# -----------------------------
# Beat Classification using CNN
# -----------------------------
def classify_beats(beats):
    if len(beats) == 0:
        print("No beats found to classify.")
        return []
    # Reshape to (num_beats, 360, 1) for CNN input
    beats = beats.reshape(len(beats), 360, 1)
    print(f"Shape of input to model: {beats.shape}")
    predictions = model.predict(beats)
    labels = np.argmax(predictions, axis=1)
    return labels

# -----------------------------
# Main Detection Function
# -----------------------------
def detect_arrhythmia(ecg_path):
    fix_hea_file(ecg_path)
    signal, fs = load_ecg(ecg_path)
    peaks = detect_r_peaks(signal, fs)
    beats, locations = segment_beats(signal, peaks)
    labels = classify_beats(beats)
    results = []
    for i, label in enumerate(labels):
        symbol = label_map.get(label, "Unknown")
        results.append({
            "location": int(locations[i]),
            "type_symbol": symbol,
            "type_name": label_names.get(symbol, "Unknown")
        })
    # Return locations for ground truth matching
    return results, signal, peaks, locations

# -----------------------------
# Load Ground Truth Labels from .atr file
# -----------------------------
def load_ground_truth(ecg_path, locations):

    ann = wfdb.rdann(ecg_path, 'atr')

    unique_symbols = set(ann.symbol)
    print(f"\nAll symbols in annotation file: {unique_symbols}")

    # Map MIT-BIH symbols to our model labels
    # 'R' in MIT-BIH = Right Bundle Branch Block Beat
    # 'j' in MIT-BIH = Nodal (junctional) escape beat -> treat as Normal
    ann_to_label = {
        'N': 'N',
        'L': 'L',
        'R': 'R',
        'A': 'A',
        'V': 'V',
        'E': 'E',
        '/': '/',
        'j': 'N',   # Junctional escape -> closest to Normal
        'J': 'N',   # Junctional premature -> closest to Normal
        'S': 'A',   # Supraventricular -> closest to Atrial
        'e': 'N',   # Atrial escape -> Normal
        'f': 'V',   # Fusion of ventricular -> PVC
    }

    # Build dict of valid beat annotations only
    valid_beat_symbols = set(ann_to_label.keys())
    ann_dict = {}
    for i in range(len(ann.sample)):
        sym = ann.symbol[i]
        if sym in valid_beat_symbols:
            ann_dict[ann.sample[i]] = ann_to_label[sym]

    print(f"Valid beat annotations found: {len(ann_dict)}")

    # Show distribution of true labels
    from collections import Counter
    label_counts = Counter(ann_dict.values())
    print(f"True label distribution: {dict(label_counts)}")

    # Match each detected location to nearest annotation
    tolerance = 50
    true_labels = []

    for loc in locations:
        best_match = None
        best_dist = tolerance + 1

        for ann_loc, sym in ann_dict.items():
            dist = abs(loc - ann_loc)
            if dist < best_dist:
                best_dist = dist
                best_match = sym

        true_labels.append(best_match)

    matched = sum(1 for t in true_labels if t is not None)
    print(f"Matched beats: {matched}/{len(locations)}")

    return true_labels
# -----------------------------
# Calculate Accuracy
# -----------------------------
def calculate_accuracy(results, true_labels):

    correct = 0
    total = 0
    per_class_correct = {}
    per_class_total = {}

    for i, r in enumerate(results):

        true = true_labels[i]

        if true is None:
            continue

        pred = r["type_symbol"]
        total += 1

        # Count per class
        if true not in per_class_total:
            per_class_total[true] = 0
            per_class_correct[true] = 0

        per_class_total[true] += 1

        if pred == true:
            correct += 1
            per_class_correct[true] += 1

    overall_accuracy = (correct / total * 100) if total > 0 else 0

    print("\nAccuracy Report:\n")
    print(f"Overall Accuracy: {overall_accuracy:.2f}%  ({correct}/{total} beats correct)")
    print()
    print(f"{'Beat Type':<35} {'Correct':>8} {'Total':>8} {'Accuracy':>10}")
    print("-" * 65)

    for t in sorted(per_class_total.keys()):
        c = per_class_correct.get(t, 0)
        tot = per_class_total[t]
        acc = (c / tot * 100) if tot > 0 else 0
        name = label_names.get(t, t)
        print(f"{name:<35} {c:>8} {tot:>8} {acc:>9.2f}%")

    return overall_accuracy

# -----------------------------
# Build Intervals
# -----------------------------
def build_intervals(results):
    if len(results) == 0:
        return []

    intervals = []
    start = 0
    current_type = results[0]["type_symbol"]
    beat_count = 1

    for i in range(1, len(results)):
        loc = results[i]["location"]
        t = results[i]["type_symbol"]

        # Only create new interval when type changes
        if t != current_type:
            intervals.append({
                "start": start,
                "end": results[i-1]["location"],
                "type_symbol": current_type,
                "type_name": label_names[current_type],
                "beat_count": beat_count
            })
            start = results[i-1]["location"]
            current_type = t
            beat_count = 1
        else:
            beat_count += 1

    # Last interval
    intervals.append({
        "start": start,
        "end": results[-1]["location"],
        "type_symbol": current_type,
        "type_name": label_names[current_type],
        "beat_count": beat_count
    })

    return intervals

# -----------------------------
# Summary Statistics
# -----------------------------
def print_summary(results):
    total_beats = len(results)
    normal_beats = sum(1 for r in results if r["type_symbol"] == 'N')
    arrhythmia_beats = total_beats - normal_beats
    normal_rate = (normal_beats / total_beats * 100) if total_beats > 0 else 0
    arrhythmia_rate = 100 - normal_rate

    print("\nSummary:\n")
    print(f"Total Beats:      {total_beats}")
    print(f"Normal Beats:     {normal_beats}")
    print(f"Arrhythmia Beats: {arrhythmia_beats}")
    print(f"Normal Rate:      {normal_rate:.2f}%")
    print(f"Arrhythmia Rate:  {arrhythmia_rate:.2f}%")

# -----------------------------
# Plot: Full signal with colored beats
# -----------------------------
def plot_results(signal, results):

    fig, ax = plt.subplots(figsize=(18, 4))
    ax.plot(signal, color='steelblue', linewidth=0.6, label="ECG Signal")

    # Plot each beat with its corresponding color
    for r in results:
        loc = r["location"]
        color = type_colors.get(r["type_symbol"], "black")
        ax.scatter(loc, signal[loc], color=color, s=40, zorder=5)

    # Build legend from types found only
    legend_elements = [
        Line2D([0], [0], marker='o', color='w',
               markerfacecolor=type_colors[t],
               markersize=8, label=label_names[t])
        for t in type_colors
        if any(r["type_symbol"] == t for r in results)
    ]

    ax.set_title("ECG Signal with Classified Beats")
    ax.set_xlabel("Samples")
    ax.set_ylabel("Amplitude")
    ax.legend(handles=legend_elements, loc='upper right', fontsize=8)
    plt.tight_layout()
    plt.show(block=True)
    plt.close('all')

# -----------------------------
# Plot: Zoom on arrhythmia beats only
# -----------------------------
def plot_arrhythmia_zoom(signal, results, window=1000):

    arrhythmia_results = [r for r in results if r["type_symbol"] != 'N']

    if len(arrhythmia_results) == 0:
        print("No arrhythmia beats found to zoom on.")
        return

    num = len(arrhythmia_results)
    cols = 3
    rows = int(np.ceil(num / cols))

    fig, axes = plt.subplots(rows, cols, figsize=(18, rows * 3))
    axes = axes.flatten()

    for idx, r in enumerate(arrhythmia_results):

        loc = r["location"]
        start = max(0, loc - window)
        end = min(len(signal), loc + window)

        seg = signal[start:end]
        x = np.arange(start, end)

        color = type_colors.get(r["type_symbol"], "black")

        axes[idx].plot(x, seg, color='steelblue', linewidth=0.8)
        axes[idx].scatter(loc, signal[loc], color=color, s=60, zorder=5)
        axes[idx].set_title(
            f"{r['type_name']} ({r['type_symbol']}) @ {loc}", fontsize=8
        )
        axes[idx].set_xlabel("Samples", fontsize=7)
        axes[idx].set_ylabel("Amplitude", fontsize=7)
        axes[idx].tick_params(labelsize=6)

    # Hide unused subplots
    for j in range(idx + 1, len(axes)):
        axes[j].set_visible(False)

    plt.suptitle("Zoom on Arrhythmia Beats", fontsize=12, fontweight='bold')
    plt.tight_layout()
    plt.show(block=True)
    plt.close('all')

# -----------------------------
# Entry Point
# -----------------------------
if __name__ == "__main__":
    ecg_file = os.path.join(BASE_DIR, "ECG-Arrhythmia", "mit-database", "231")

    print("Loading ECG:", ecg_file)

    results, signal, peaks, locations = detect_arrhythmia(ecg_file)

    intervals = build_intervals(results)

    print("\nDetected Intervals:\n")
    for i in intervals:
        print(f"{i['start']} -> {i['end']} : {i['type_name']} ({i['type_symbol']}) | Beats: {i['beat_count']}")

    print_summary(results)

    # Load ground truth labels and calculate model accuracy
    true_labels = load_ground_truth(ecg_file, locations)
    calculate_accuracy(results, true_labels)

    # Plot 1: Full signal with colored beats
    plot_results(signal, results)

    # Plot 2: Zoom on arrhythmia beats only
    plot_arrhythmia_zoom(signal, results, window=1000)