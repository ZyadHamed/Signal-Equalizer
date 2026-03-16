import os
os.environ["FOR_DISABLE_CONSOLE_CTRL_HANDLER"] = "1"
from pathlib import Path
import json

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os
from pydantic import BaseModel
from typing import List
import soundfile as sf
import io


from ECGService import mat_to_json
from FrequencyTransformService import apply_frequency_gains, compute_spectrogram, EQResult, apply_mask_eq
from AIService import SeperateAudio, SeperateInstruments
from AI_ECG_Service import decompose_ecg, load_model, LABEL_NAMES
from WaveletService import apply_wavelet_gains

from fastapi.middleware.gzip import GZipMiddleware
class GainBand(BaseModel):
    lowerLimit: float
    upperLimit: float
    gain: float

class SignalEqualizationRequest(BaseModel):
    signal: List[float]
    sampling_rate: float
    gain_bands: List[GainBand]

class SpectrogramRequest(BaseModel):
    signal: List[float]
    sampling_rate: float
    window_size: int
    overlap: int

class WaveletBand(BaseModel):
    level: int
    gain: float
    coeff_start: int | None = None
    coeff_end:   int | None = None

class WaveletEqualizationRequest(BaseModel):
    signal:  list[float]
    wavelet: str   = 'db4'
    level:   int   = 5
    gain_bands: list[WaveletBand]

class EQResponse(BaseModel):
    sample_rate: int
    num_samples: int
    equalized_signal: list[float]


app = FastAPI()
origins = ["*"]
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ECG_MODEL_PATH = os.path.join(BASE_DIR, "ECG-Arrhythmia", "mit-database", "cnn_model.h5")
ecg_model = load_model(ECG_MODEL_PATH)

app.mount("/segmentedFiles", StaticFiles(directory="segmentedFiles"), name="segmentedFiles")
ALLOWED_Dataset_Extensions_For_Audio = {'.mp3', '.wav'}
ALLOWED_Dataset_Extensions_For_ECG_Conversion = {'.mat', '.hea'}


@app.post("/convertecgtojson")
async def ConvertECGToJSON(file: UploadFile):
    try:
        contents = await file.read()
        file_extension = os.path.splitext(file.filename)[-1]
        if file_extension not in ALLOWED_Dataset_Extensions_For_ECG_Conversion:
            return JSONResponse(
            content = {
                "message:": f"Invalid file type. Allowed dataset formats: {', '.join(ALLOWED_Dataset_Extensions_For_ECG_Conversion)}"
                },
            status_code=400
            )
        

        with open("uploadedFiles/ECGFiles/" + file.filename, "wb") as binary_file:
            binary_file.write(contents)
        
        responseDTO = mat_to_json("uploadedFiles/ECGFiles/" + file.filename)
        return responseDTO

    except Exception:
        return JSONResponse(
            content = {
                "message:": Exception
                },
            status_code=500
            )
    
  
@app.post("/applyfrequencygains")
async def ApplyFrequencyGain(request: SignalEqualizationRequest):
    try:
        # Convert Pydantic objects back to standard dictionaries for the function
        gain_bands_dict = [band.model_dump() for band in request.gain_bands]
        
        # Apply the frequency gains
        mag, phase, mod_sig = apply_frequency_gains(
            signal=request.signal,
            sampling_rate=request.sampling_rate,
            gain_bands=gain_bands_dict
        )
        
        # Convert NumPy arrays back to Python lists for JSON serialization
        return {
            "modified_fft_magnitude": mag.tolist(),
            "modified_fft_phase": phase.tolist(),
            "modified_signal": mod_sig.tolist()
        }
        
    except Exception as e:
        # Catch any unexpected errors (like bad data causing math issues)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/computespectrogram")
async def ComputeSpectrogram(request: SpectrogramRequest):
        frequencies, times, spectrogram_array = compute_spectrogram(
            data = request.signal,
            sampling_rate = request.sampling_rate,
            window_size = request.window_size,
            overlap = request.overlap
        )
        
        # Convert NumPy arrays back to Python lists for JSON serialization
        return {
            "frequencies": frequencies.tolist(),
            "times": times.tolist(),
            "spectrogram_array": spectrogram_array.tolist()
        }


@app.post("/applywaveletgains")
async def ApplyWaveletGain(request: WaveletEqualizationRequest):
    try:
        gain_bands_dict = [
            {
                "level":       f"detail_{b.level}" if b.level > 0 else "approximation",
                "gain":        b.gain,
                "coeff_start": b.coeff_start,
                "coeff_end":   b.coeff_end,
            }
            for b in request.gain_bands
        ]

        coeffs_dict, modified_signal = apply_wavelet_gains(
            signal     = request.signal,
            gain_bands = gain_bands_dict,
            wavelet    = request.wavelet,
            level      = request.level,
        )

        return {
            "modified_signal": modified_signal.tolist(),
            "coefficients":    {k: v.tolist() for k, v in coeffs_dict.items()},
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))





@app.post("/segmenthumanvoice")
async def SegmentHumanVoice(file: UploadFile):
    try:
        contents = await file.read()
        file_extension = os.path.splitext(file.filename)[-1]
        if file_extension not in ALLOWED_Dataset_Extensions_For_Audio:
            return JSONResponse(
            content = {
                "message:": f"Invalid file type. Allowed audio formats: {', '.join(ALLOWED_Dataset_Extensions_For_Audio)}"
                },
            status_code=400
            )
        

        with open("uploadedFiles/HumanVoices/" + file.filename, "wb") as binary_file:
            binary_file.write(contents)
        
        response = SeperateAudio("uploadedFiles/HumanVoices/" + file.filename)
        return JSONResponse(content=response)

    except Exception:
        return JSONResponse(
            content = {
                "message:": Exception
                },
            status_code=500
            )
    

@app.post("/segmentmusic")
async def SegmentMusic(file: UploadFile):
    try:
        contents = await file.read()
        file_extension = os.path.splitext(file.filename)[-1]
        if file_extension not in ALLOWED_Dataset_Extensions_For_Audio:
            return JSONResponse(
            content = {
                "message:": f"Invalid file type. Allowed audio formats: {', '.join(ALLOWED_Dataset_Extensions_For_Audio)}"
                },
            status_code=400
            )
        

        with open("uploadedFiles/Music/" + file.filename, "wb") as binary_file:
            binary_file.write(contents)
        
        response = SeperateInstruments("uploadedFiles/Music/" + file.filename)
        return JSONResponse(content=response)

    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

        return {"Success": "Files created successfully"}

    except Exception:
        return JSONResponse(
            content = {
                "message:": Exception
                },
            status_code=500
            )
    

@app.post("/decomposeecg")
async def decompose_ecg_endpoint(file: UploadFile = File(...)):
    """
    Accept a .mat ECG file and return per-beat-type signal components.

    Returns
    -------
    JSON with keys:
        - components : dict[symbol -> list[float]]  (one array per beat type)
        - original   : list[float]                  (the preprocessed signal)
        - fs         : int                           (sampling frequency, always 360)
        - symbols    : dict[symbol -> full name]     (label reference)
    """
    if not file.filename.endswith(".mat"):
        raise HTTPException(status_code=400, detail="Only .mat files are accepted.")

    contents = await file.read()
    file_extension = os.path.splitext(file.filename)[-1]
    if file_extension not in ALLOWED_Dataset_Extensions_For_ECG_Conversion:
        return JSONResponse(
        content = {
            "message:": f"Invalid file type. Allowed file formats: {', '.join(ALLOWED_Dataset_Extensions_For_ECG_Conversion)}"
            },
        status_code=400
        )
    

    with open("uploadedFiles/ECGFiles/" + file.filename, "wb") as binary_file:
        binary_file.write(contents)
    contents = await file.read()

    try:
        components, original_signal, fs = decompose_ecg(
            model_path=ECG_MODEL_PATH,
            ecg_path="uploadedFiles/ECGFiles/" + file.filename,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Decomposition failed: {str(e)}")

    return JSONResponse(content={
        "components": {sym: arr.tolist() for sym, arr in components.items()},
        "original":   original_signal.tolist(),
        "fs":         fs,
        "symbols":    LABEL_NAMES,
    })



@app.post(
    "/equalize",
    response_model=EQResponse,
    summary="Apply sparse-mask EQ to a WAV file",
    description=(
        "Upload a mono WAV file and a sparse-mask JSON. "
        "Supply one gain (float) per instrument found in the JSON. "
        "Gains are passed as a JSON string, e.g. "
        '\'{"bass": 1.2, "drums": 0.8, "guitar": 1.0, "vocals": 1.1}\''
    ),
)
async def equalize(
    wav_file: UploadFile = File(..., description="Mono WAV file to equalize"),
    mask_file: UploadFile = File(..., description="Sparse mask JSON config"),
    gains: str = Form(
        ...,
        description=(
            "JSON object mapping each instrument name to a float gain, "
            'e.g. \'{"bass": 1.0, "drums": 1.0}\''
        ),
    ),
) -> EQResponse:
    # ── Parse mask JSON ───────────────────────────────────────────────────────
    raw_mask = await mask_file.read()
    try:
        config = json.loads(raw_mask)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid mask JSON: {exc}") from exc
 
    if "metadata" not in config or "masks" not in config:
        raise HTTPException(
            status_code=422,
            detail="Mask JSON must contain top-level 'metadata' and 'masks' keys.",
        )
 
    # ── Parse gains ───────────────────────────────────────────────────────────
    try:
        gains_dict: dict[str, float] = json.loads(gains)
        gains_dict = {k: float(v) for k, v in gains_dict.items()}
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid gains JSON: {exc}") from exc
 
    # ── Load WAV ──────────────────────────────────────────────────────────────
    wav_bytes = await wav_file.read()
    try:
        audio, sr = sf.read(io.BytesIO(wav_bytes), dtype="float32", always_2d=False)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read WAV file: {exc}") from exc
 
    if audio.ndim > 1:
        raise HTTPException(
            status_code=422,
            detail=f"Expected mono audio, got {audio.shape[1]} channels. Mix down first.",
        )
 
    # ── Run EQ ────────────────────────────────────────────────────────────────
    try:
        result: EQResult = apply_mask_eq(audio, sr, config, gains_dict)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
 
    return EQResponse(
        sample_rate=result.sample_rate,
        num_samples=result.num_samples,
        equalized_signal=result.equalized_signal,
    )