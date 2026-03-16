import numpy as np
import os
import scipy.io
import wfdb
from scipy.signal import find_peaks, resample_poly, butter, filtfilt
from tensorflow.keras.models import load_model
from math import gcd


# ── Label maps (same as original) ────────────────────────────────────────────

LABEL_MAP = {0: '/', 1: 'A', 2: 'E', 3: 'L', 4: 'N', 5: 'R', 6: 'V'}

LABEL_NAMES = {
    '/': "Paced Beat",
    'A': "Atrial Premature Beat",
    'E': "Ventricular Escape Beat",
    'L': "Left Bundle Branch Block Beat",
    'N': "Normal Beat",
    'R': "Right Bundle Branch Block Beat",
    'V': "Premature Ventricular Contraction",
}

VALID_SYMBOLS = set(LABEL_MAP.values())


# ── Signal helpers ────────────────────────────────────────────────────────────

def _resample_to_360(signal: np.ndarray, original_fs: int, target_fs: int = 360) -> np.ndarray:
    if original_fs == target_fs:
        return signal
    g = gcd(int(original_fs), target_fs)
    return resample_poly(signal, target_fs // g, int(original_fs) // g)


def _remove_baseline(signal: np.ndarray, fs: int) -> np.ndarray:
    b, a = butter(2, 0.5 / (fs / 2), btype='high')
    return filtfilt(b, a, signal)


def _auto_flip(signal: np.ndarray) -> np.ndarray:
    if np.percentile(-signal, 99) > np.percentile(signal, 99):
        return -signal
    return signal


def _load_wfdb(path: str):
    """Load a MIT-BIH style wfdb record."""
    record = wfdb.rdrecord(path, channels=[0])
    signal = record.p_signal[:, 0]
    fs = record.fs
    signal = _auto_flip(signal)
    if fs != 360:
        signal = _resample_to_360(signal, fs)
        fs = 360
    return signal, fs

def _load_mat(path: str):
    """Load a .mat ECG record."""
    data = scipy.io.loadmat(path)
    signal = data['val'][0].astype(np.float64)

    signal = _remove_baseline(signal, fs=300)
    signal = _auto_flip(signal)
    signal = _resample_to_360(signal, original_fs=300)

    return signal, 360


def _load_signal(ecg_path: str):
    if ecg_path.endswith(".hea"):
        return _load_wfdb(ecg_path.removesuffix(".hea"))  # strip extension
    if os.path.exists(ecg_path):
        return _load_mat(ecg_path)
    return _load_wfdb(ecg_path)

# ── Core pipeline helpers ─────────────────────────────────────────────────────

def _detect_r_peaks(signal: np.ndarray, fs: int) -> np.ndarray:
    peaks, _ = find_peaks(
        signal,
        distance=int(0.6 * fs),
        height=np.mean(signal),
    )
    return peaks


def _segment_and_classify(signal: np.ndarray, peaks: np.ndarray, model) -> list[dict]:
    """
    Segment 360-sample windows around each R-peak and classify them.

    Returns a list of dicts:
        { 'peak': int, 'symbol': str, 'start': int, 'end': int }
    """
    half = 180
    beats, meta = [], []

    for p in peaks:
        start, end = p - half, p + half
        if start >= 0 and end <= len(signal):
            beats.append(signal[start:end])
            meta.append({'peak': int(p), 'start': int(start), 'end': int(end)})

    if not beats:
        return []

    arr = np.array(beats).reshape(len(beats), 360, 1)
    preds = model.predict(arr, verbose=0)
    labels = np.argmax(preds, axis=1)

    for i, m in enumerate(meta):
        m['symbol'] = LABEL_MAP.get(int(labels[i]), 'N')

    return meta


def decompose_ecg(
    model_path: str,
    ecg_path: str,
) -> dict[str, np.ndarray]:
    # ── 1. Load model & signal ────────────────────────────────────────────────
    model = load_model(model_path)
    print(ecg_path)
    signal, fs = _load_signal(ecg_path)

    # ── 2. Detect & classify beats ────────────────────────────────────────────
    peaks = _detect_r_peaks(signal, fs)
    beats_meta = _segment_and_classify(signal, peaks, model)

    # ── 3. Initialise one zero array per possible symbol ──────────────────────
    components = {sym: np.zeros_like(signal) for sym in VALID_SYMBOLS}

    # ── 4. Fill each component with original signal values in its windows ─────
    for beat in beats_meta:
        s, e = beat['start'], beat['end']
        components[beat['symbol']][s:e] = signal[s:e]

    return components, signal, fs