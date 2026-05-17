import numpy as np
import scipy.io
import os
from math import gcd
from scipy.signal import resample_poly, butter, filtfilt, find_peaks
from tensorflow.keras.models import load_model
import pandas as pd

# ─────────────────────────────────────────────
# Constants (mirror what your endpoint expects)
# ─────────────────────────────────────────────
LABEL_MAP = {
    0: '/',
    1: 'A',
    2: 'E',
    3: 'L',
    4: 'N',
    5: 'R',
    6: 'V'
}

LABEL_NAMES = {
    '/': "Paced Beat",
    'A': "Atrial Premature Beat",
    'E': "Ventricular Escape Beat",
    'L': "Left Bundle Branch Block Beat",
    'N': "Normal Beat",
    'R': "Right Bundle Branch Block Beat",
    'V': "Premature Ventricular Contraction"
}


# ─────────────────────────────────────────────
# Signal preprocessing helpers
# ─────────────────────────────────────────────
def _resample_to_360(signal: np.ndarray, original_fs: int, target_fs: int = 360) -> np.ndarray:
    """Polyphase resample to target_fs."""
    if original_fs == target_fs:
        return signal
    g    = gcd(int(original_fs), target_fs)
    up   = target_fs // g
    down = int(original_fs) // g
    return resample_poly(signal, up, down)


def _remove_baseline(signal: np.ndarray, fs: int) -> np.ndarray:
    """High-pass Butterworth filter to remove baseline wander."""
    nyq  = fs / 2
    b, a = butter(2, 0.5 / nyq, btype='high')
    return filtfilt(b, a, signal)


def _auto_flip(signal: np.ndarray) -> np.ndarray:
    """Flip the signal if the dominant peak is negative."""
    pos_max = np.percentile(signal,  99)
    neg_max = np.percentile(-signal, 99)
    if neg_max > pos_max:
        return -signal
    return signal


# ─────────────────────────────────────────────
# Load & preprocess .mat ECG
# ─────────────────────────────────────────────
def _load_ecg_mat(path: str):
    """
    Load a PhysioNet-style .mat file, apply ADC conversion,
    baseline removal, auto-flip and resample to 360 Hz.

    Returns
    -------
    signal : np.ndarray  (float64, mV)
    fs     : int         (always 360 after resampling)
    """
    data   = scipy.io.loadmat(path + ".mat")
    signal = data['val'][0].astype(np.float64)

    # ── Parse .hea for fs / ADC gain / baseline ──────────────
    hea_file  = path + ".hea"
    fs        = 300
    adc_gain  = 1000.0
    baseline  = 0.0

    if os.path.exists(hea_file):
        with open(hea_file, "r") as f:
            lines = f.readlines()

        # Line 0 → record fs
        first = lines[0].strip().split()
        if len(first) >= 3:
            try:
                fs = int(first[2])
            except ValueError:
                pass

        # Line 1 → gain / baseline
        if len(lines) > 1:
            sig_line = lines[1].strip().split()
            if len(sig_line) >= 3:
                try:
                    adc_gain = float(sig_line[2].split('/')[0])
                except ValueError:
                    pass
            if len(sig_line) >= 5:
                try:
                    baseline = float(sig_line[4])
                except ValueError:
                    pass

    # ── ADC → mV conversion ───────────────────────────────────
    signal = (signal - baseline) / adc_gain

    # ── Preprocessing chain ───────────────────────────────────
    signal = _remove_baseline(signal, fs)
    signal = _auto_flip(signal)

    if fs != 360:
        signal = _resample_to_360(signal, fs, target_fs=360)
        fs = 360

    return signal, fs


# ─────────────────────────────────────────────
# R-peak detection
# ─────────────────────────────────────────────
def _detect_r_peaks(signal: np.ndarray, fs: int) -> np.ndarray:
    """Detect R-peaks with a minimum inter-beat distance of 0.6 s."""
    distance = int(0.6 * fs)
    peaks, _ = find_peaks(
        signal,
        distance=distance,
        height=np.mean(signal)
    )
    return peaks


# ─────────────────────────────────────────────
# Beat segmentation
# ─────────────────────────────────────────────
def _segment_beats(signal: np.ndarray, peaks: np.ndarray):
    """
    Extract 360-sample windows (±180 samples around each R-peak).

    Returns
    -------
    beats     : np.ndarray  shape (N, 360)
    locations : list[int]
    """
    beats, locations = [], []
    for p in peaks:
        if p - 180 >= 0 and p + 180 < len(signal):
            beat = signal[p - 180 : p + 180]
            if len(beat) == 360:
                beats.append(beat)
                locations.append(int(p))
    return np.array(beats), locations


# ─────────────────────────────────────────────
# CNN classification
# ─────────────────────────────────────────────
def _classify_beats(model, beats: np.ndarray) -> list[str]:
    """
    Run the pretrained CNN and return a list of beat-type symbols.

    Parameters
    ----------
    model : keras Model  (loaded externally and passed in)
    beats : np.ndarray   shape (N, 360)
    """
    if len(beats) == 0:
        return []

    x           = beats.reshape(len(beats), 360, 1)
    predictions = model.predict(x, verbose=0)
    label_idxs  = np.argmax(predictions, axis=1)
    return [LABEL_MAP.get(int(idx), 'N') for idx in label_idxs]


# ─────────────────────────────────────────────
# Core decomposition function
# ─────────────────────────────────────────────
def decompose_ecg(model_path: str, ecg_path: str):
    # ── Normalise to bare base path ──────────────────────────────────────────
    base = ecg_path
    for ext in (".mat", ".hea", ".dat", ".csv"):
        if ecg_path.endswith(ext):
            base = ecg_path[: -len(ext)]
            break

    mat_path = base + ".mat"
    hea_path = base + ".hea"
    dat_path = base + ".dat"
    csv_path = base + ".csv"

    # ── Load model ───────────────────────────────────────────────────────────
    model = load_model(model_path)

    # ── Load & preprocess ECG ────────────────────────────────────────────────
    if os.path.exists(csv_path):
        df = pd.read_csv(csv_path)
        df.columns = df.columns.str.strip().str.lower()

        if "time" not in df.columns or "amplitude" not in df.columns:
            raise ValueError(
                "CSV file must contain 'time' and 'amplitude' columns. "
                f"Found columns: {list(df.columns)}"
            )

        time_col = df["time"].to_numpy(dtype=np.float64)
        signal   = df["amplitude"].to_numpy(dtype=np.float64)

        if len(time_col) > 1:
            dt = np.median(np.diff(time_col))
            fs = round(1.0 / dt) if dt > 0 else 500
        else:
            fs = 500

        signal = _remove_baseline(signal, fs)
        signal = _auto_flip(signal)
        if fs != 360:
            signal = _resample_to_360(signal, fs, target_fs=360)
            fs = 360

    elif os.path.exists(mat_path):
        signal, fs = _load_ecg_mat(base)

    elif os.path.exists(hea_path) and os.path.exists(dat_path):
        import wfdb
        record = wfdb.rdrecord(base, channels=[0])
        signal = record.p_signal[:, 0].astype(np.float64)
        fs     = record.fs
        signal = _remove_baseline(signal, fs)
        signal = _auto_flip(signal)
        if fs != 360:
            signal = _resample_to_360(signal, fs, target_fs=360)
            fs = 360

    elif os.path.exists(hea_path) and not os.path.exists(dat_path):
        raise ValueError(
            f"A .hea file was found but the companion .dat file is missing. "
            f"Please upload both '{os.path.basename(base)}.hea' "
            f"and '{os.path.basename(base)}.dat' together."
        )

    else:
        raise FileNotFoundError(
            f"No ECG file found at '{base}'. "
            f"Expected a .mat file, a .csv file, or both .hea and .dat files."
        )

    # ── Detect R-peaks ───────────────────────────────────────────────────────
    peaks = _detect_r_peaks(signal, fs)

    # ── Segment beats ────────────────────────────────────────────────────────
    beats, locations = _segment_beats(signal, peaks)

    # ── Classify beats ───────────────────────────────────────────────────────
    symbols = _classify_beats(model, beats)

    # ── Build component signals ──────────────────────────────────────────────
    n_samples  = len(signal)
    half_win   = 180
    components: dict[str, np.ndarray] = {}

    for sym, loc in zip(symbols, locations):
        if sym not in components:
            components[sym] = np.zeros(n_samples, dtype=np.float64)
        start = max(0,         loc - half_win)
        end   = min(n_samples, loc + half_win)
        components[sym][start:end] = signal[start:end]

    return components, signal, fs


