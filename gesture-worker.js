/* Frame inference runs off the rendering thread. All files and frames stay local. */
let detector;
let stopped = false;
self.onmessage = async (event) => {
  const { type, frame, timestamp, baseUrl } = event.data;
  if (type === 'init') {
    try {
      const { FilesetResolver, HandLandmarker } = await import(new URL('assets/mediapipe/vision_bundle.mjs', baseUrl).href);
      const vision = await FilesetResolver.forVisionTasks(new URL('assets/mediapipe/wasm', baseUrl).href);
      detector = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: new URL('assets/mediapipe/hand_landmarker.task', baseUrl).href, delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.55
      });
      if (stopped) { detector.close(); return; }
      self.postMessage({ type: 'ready' });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
  } else if (type === 'frame') {
    try {
      if (!detector || stopped) return;
      const result = detector.detectForVideo(frame, timestamp);
      self.postMessage({ type: 'result', landmarks: result.landmarks, timestamp });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
    finally { frame?.close(); }
  } else if (type === 'stop') {
    stopped = true;
    detector?.close();
    self.close();
  }
};
