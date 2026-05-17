import tensorflow as tf

model = tf.keras.models.load_model("ECG-Arrhythmia\mit-database\cnn_model.h5")

converter = tf.lite.TFLiteConverter.from_keras_model(model)

# دي أهم خطوة
converter.optimizations = [tf.lite.Optimize.DEFAULT]

tflite_model = converter.convert()

with open("model_quant.h5", "wb") as f:
    f.write(tflite_model)