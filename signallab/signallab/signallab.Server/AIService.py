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
import torch.nn as nn
import librosa

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




class GlobalLayerNorm(nn.Module):
    def __init__(self, dim):
        super().__init__()
        self.norm = nn.GroupNorm(1, dim)
    def forward(self, x):
        return self.norm(x)
 
class ConvBlock(nn.Module):
    def __init__(self, in_channels, hidden, kernel_size, dilation):
        super().__init__()
        padding = (kernel_size - 1) * dilation // 2
        self.net = nn.Sequential(
            nn.Conv1d(in_channels, hidden, 1),
            nn.PReLU(),
            GlobalLayerNorm(hidden),
            nn.Conv1d(hidden, hidden, kernel_size,
                      dilation=dilation, padding=padding, groups=hidden),
            nn.PReLU(),
            GlobalLayerNorm(hidden),
            nn.Conv1d(hidden, in_channels, 1)
        )
    def forward(self, x):
        return x + self.net(x)
 
class ConvTasNet(nn.Module):
    """
    Properly-sized Conv-TasNet for 4-source animal separation.
 
    Key parameters vs the original 'TinyConvTasNet':
      N=256  (was 128) — richer encoder representation
      B=128  (was 96)  — wider bottleneck
      H=256  (was 128) — wider depthwise conv
      X=8    (was 5)   — more dilation steps → larger receptive field
      R=4    (was 2)   — more TCN repeats → deeper feature hierarchy
 
    Receptive field ≈ (2^X - 1) * R * kernel_size
    Old:  (2^5 - 1) * 2 * 3  = 186 samples  (~23 ms at 8kHz) ← too short
    New:  (2^8 - 1) * 4 * 3  = 3060 samples (~382 ms at 8kHz) ← much better
    """
    def __init__(self, N=256, L=16, B=128, H=256, X=8, R=4, num_sources=4):
        super().__init__()
        self.num_sources = num_sources
        self.encoder_dim = N
 
        self.encoder    = nn.Conv1d(1, N, L, stride=L//2, padding=0)
        self.layer_norm = GlobalLayerNorm(N)
        self.bottleneck = nn.Conv1d(N, B, 1)
 
        self.tcn = nn.Sequential(*[
            ConvBlock(B, H, kernel_size=3, dilation=2**i)
            for r in range(R) for i in range(X)
        ])
 
        self.mask_net = nn.Sequential(
            nn.Conv1d(B, num_sources * N, 1),
            nn.ReLU()
        )
        self.decoder = nn.ConvTranspose1d(N, 1, L, stride=L//2, padding=0)
 
    def forward(self, x):
        original_length = x.shape[-1]
        enc   = torch.relu(self.encoder(x))
        sep   = self.bottleneck(self.layer_norm(enc))
        sep   = self.tcn(sep)
        masks = self.mask_net(sep)
        masks = masks.view(masks.shape[0], self.num_sources, self.encoder_dim, masks.shape[-1])
        enc   = enc.unsqueeze(1) * masks
 
        outputs = []
        for i in range(self.num_sources):
            out = self.decoder(enc[:, i])
            if out.shape[-1] > original_length:
                out = out[..., :original_length]
            elif out.shape[-1] < original_length:
                out = nn.functional.pad(out, (0, original_length - out.shape[-1]))
            outputs.append(out)
        return torch.stack(outputs, dim=1).squeeze(2)  # [B, num_src, T]
    
import torchaudio.transforms as T

# ── Load once at startup ───────────────────────────────────────────
_device     = 'cuda' if torch.cuda.is_available() else 'cpu'
_checkpoint = torch.load("conv_tasnet_best.pt", map_location=_device)
_cfg        = _checkpoint['config']
_sr         = _checkpoint['sr']

labels = ["Dog", "Cat", "Cow", "Sheep"]

_animal_model = ConvTasNet(**_cfg).to(_device)
_state_dict   = {k.replace('_orig_mod.', ''): v for k, v in _checkpoint['model_state'].items()}
_animal_model.load_state_dict(_state_dict)
_animal_model.eval()

def SeparateAnimals(audio_path: str) -> dict:
    data, sr = sf.read(audio_path, always_2d=True)   # [T, C]
    waveform = torch.from_numpy(data.T).float()       # [C, T]
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True) # [1, T]

    if sr != 8000:
        print(f"Resampling from {sr} Hz → {8000} Hz")
        waveform = T.Resample(sr, 8000)(waveform)

    print(f"Input waveform: shape={waveform.shape}, min={waveform.min():.4f}, "
          f"max={waveform.max():.4f}, mean_abs={waveform.abs().mean():.6f}")

    waveform = waveform.unsqueeze(0).to(_device)       # [1, 1, T]
    with torch.no_grad():
        sources = _animal_model(waveform)

    sources = sources.squeeze(0).cpu().numpy()

    dest_dir = Path('segmentedFiles')
    dest_dir.mkdir(exist_ok=True)

    response = {}
    for source, label in zip(sources, labels):
        source = source / (np.max(np.abs(source)) + 1e-9)
        stem_path = dest_dir / f'{label}.wav'
        sf.write(stem_path, source, _sr)

        with open(stem_path, 'rb') as f:
            wav_bytes = f.read()

        response[label] = {
            'audio_b64':    base64.b64encode(wav_bytes).decode('utf-8'),
            'sample_rate':  _sr,
            'channels':     1,
            'num_samples':  len(source),
            'duration_sec': round(len(source) / _sr, 3),
        }

    return response



