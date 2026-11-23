# Shadow ML

The shadow model is diagnostic only. Training and live inference both call the shared `signalToFeatures` implementation in `engine/ml/features.js`; the feature key order and transformations are versioned in the saved model.

Training uses chronological 60/20/20 train/validation/test partitions. Any candidate probability threshold is selected on validation only; the final test partition is report-only. No threshold is tuned on test results.

ML filtering stays disabled until at least 100 closed trades are available (the current tracked sample is small, previously reported as 39). Below that floor, training writes a disabled model and the existing non-ML strategy remains the decision path. Above the floor, filtering still requires explicitly setting `ML_SHADOW_MODE=filter`; default `log` does not block signals.

Run `node engine/ml/train_shadow.js` to refresh the model. It writes to `MAYOR_STATE_DIR/ml/shadow_model.json` (default `data/ml/shadow_model.json`).
