from speechbrain.inference.separation import SepformerSeparation as separator
import torch
import subprocess, tempfile, numpy as np
from scipy.io import wavfile
import soundfile as sf, os
import torchaudio
from audio_separator.separator import Separator
from pathlib import Path
import logging
import base64

TARGET_SR  = 8000
TARGET_RMS = 0.08
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

import subprocess
import numpy as np

def load_as_mono_float(file_path, target_sr):
    # Build the FFmpeg command using the direct file path
    cmd = [
        'ffmpeg', '-y', '-i', file_path,
        '-f', 'f32le', '-acodec', 'pcm_f32le',
        '-ar', str(target_sr), '-ac', '1', 'pipe:1'
    ]
    
    # Run the command and capture the output
    r = subprocess.run(cmd, capture_output=True)
    
    # Optional but highly recommended: Catch FFmpeg errors
    if r.returncode != 0:
        raise RuntimeError(f"FFmpeg failed with error: {r.stderr.decode('utf-8')}")
        
    return np.frombuffer(r.stdout, dtype=np.float32).copy()

def normalize_rms(sig, target=TARGET_RMS):
    rms = np.sqrt(np.mean(sig ** 2))
    return sig if rms < 1e-9 else sig * (target / rms)

def separate_half(model, signal, sr, label):
    path = f"segmentedFiles/temp/sep_{label}.wav"

    # Write using soundfile as float32 — more reliable than scipy wavfile
    sf.write(path, signal.astype(np.float32), sr)

    # Verify input file is valid
    info = sf.info(path)
    print(f"  Input: {info.duration:.2f}s, {info.samplerate}Hz")

    # Load as tensor the way speechbrain expects
    wav, file_sr = torchaudio.load(path)
    print(f"  Tensor shape: {wav.shape}, SR: {file_sr}")

    # Run separation directly on tensor
    with torch.no_grad():
        wav = wav.to(DEVICE)
        est = model.separate_batch(wav)   # [batch, time, n_spk]

    print(f"  Output shape: {est.shape}")
    spk1 = est[0, :, 0].detach().cpu().numpy()
    spk2 = est[0, :, 1].detach().cpu().numpy()
    out_sr = file_sr
    print(f"  Output length: {len(spk1)/out_sr:.2f}s")
    return normalize_rms(spk1), normalize_rms(spk2), out_sr

def SeperateAudio(path: str):
    model = separator.from_hparams(
        source="speechbrain/sepformer-wsj02mix",
        savedir="pretrained_models/sepformer-wsj02mix",
        run_opts={"device": DEVICE},
    )

    full = load_as_mono_float(path, target_sr=TARGET_SR)
    print(f"Loaded: {len(full)/TARGET_SR:.2f}s at {TARGET_SR}Hz")

    mid        = len(full) // 2
    mf_seg     = normalize_rms(full[:mid])
    ow_kid_mix = normalize_rms(full[mid:])
    spk1_out, spk2_out, OUT_SR = separate_half(model, mf_seg, TARGET_SR, "half1")
    spk3_out, spk4_out, _ = separate_half(model, ow_kid_mix, TARGET_SR, "half2")

    for fname, sig in [("segmentedFiles/voice_1.wav", spk1_out),
                   ("segmentedFiles/voice_2.wav", spk2_out),
                   ("segmentedFiles/voice_3.wav", spk3_out),
                   ("segmentedFiles/voice_4.wav", spk4_out)]:
        sf.write(fname, np.clip(sig, -1, 1).astype(np.float32), OUT_SR)
    
    response = {}

    for i in range(1, 5):
        voice_path = f"segmentedFiles/voice_{i}.wav"
        audio, sr = sf.read(voice_path)

        with open(voice_path, "rb") as f:
            wav_bytes = f.read()

        response[f"voice_{i}"] = {
            "audio_b64": base64.b64encode(wav_bytes).decode("utf-8"),
            "sample_rate": sr,
            "channels": 1 if audio.ndim == 1 else audio.shape[1],
            "num_samples": len(audio),
            "duration_sec": round(len(audio) / sr, 3),
        }
    print(response)
    return response

def SeperateInstruments(path: str) -> dict[str, str]:
    STEMS = ['drums', 'bass', 'guitar', 'piano', 'other']

    separator = Separator(output_dir='separated', output_format='WAV', log_level=logging.DEBUG)
    separator.load_model(model_filename='htdemucs_6s.yaml')
    output_files = separator.separate(path)

    sep_dir  = Path('separated')
    dest_dir = Path('segmentedFiles')
    dest_dir.mkdir(exist_ok=True)

    # ── 1. Move all stems first ───────────────────────────────────────────────
    for f in map(Path, output_files):
        f    = sep_dir / f.name
        stem = next((s for s in STEMS if s in f.name.lower()), None)
        if not stem or stem == 'vocals':
            continue
        dest = dest_dir / f'{stem}.wav'
        dest.unlink(missing_ok=True)
        f.rename(dest)

    # ── 2. Build response after all files are in place ────────────────────────
    stems    = ["bass", "drums", "guitar", "piano"]
    response = {}

    for stem in stems:
        stem_path = os.path.join("segmentedFiles", stem + ".wav")
        audio, sr = sf.read(stem_path)

        with open(stem_path, "rb") as f:
            wav_bytes = f.read()

        response[stem] = {
            "audio_b64":   base64.b64encode(wav_bytes).decode("utf-8"),
            "sample_rate": sr,
            "channels":    1 if audio.ndim == 1 else audio.shape[1],
            "num_samples": len(audio),
            "duration_sec": round(len(audio) / sr, 3),
        }

    return response