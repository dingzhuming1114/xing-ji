/* Camera frames never enter the DOM visually or leave this device. */
(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const toggle = $('#gesture-toggle');
  const header = $('#gesture-header');
  const status = $('#gesture-status');
  const hud = $('#gesture-hud');
  const hudLabel = $('#gesture-hud-label');
  let active = false, loading = false, generation = 0;
  let worker, video, stream, animationId, frameBusy = false, lastFrame = 0;
  let readyReject, readyTimer, inferenceTimer;
  let lastPinch = null, lastDistance = null, lostAt = 0;
  let candidate = '', candidateFrames = 0, currentPose = '';

  function send(action = {}) { document.dispatchEvent(new CustomEvent('interstellar:gesture', { detail: action })); }
  function message(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
  function updateUI() {
    toggle.setAttribute('aria-checked', String(active));
    toggle.setAttribute('aria-busy', String(loading));
    toggle.setAttribute('aria-label', active ? '关闭手势控制与摄像头' : loading ? '取消启用手势控制' : '启用手势控制');
    header.setAttribute('aria-pressed', String(active));
    header.setAttribute('aria-label', toggle.getAttribute('aria-label'));
    header.classList.toggle('active', active);
    header.classList.toggle('loading', loading);
    document.body.classList.toggle('gesture-active', active);
    hud.hidden = !active;
  }
  function stop(text = '张掌散开 · 握拳聚合 · 捏合旋转', error = false) {
    generation++;
    active = false; loading = false; frameBusy = false;
    cancelAnimationFrame(animationId);
    clearTimeout(readyTimer); clearTimeout(inferenceTimer);
    readyReject?.(new DOMException('Cancelled', 'AbortError')); readyReject = null;
    worker?.terminate(); worker = null;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    if (video) { video.pause(); video.srcObject = null; video.remove(); video = null; }
    lastPinch = null; lastDistance = null; currentPose = ''; candidate = ''; candidateFrames = 0; lostAt = 0;
    send();
    message(text, error); updateUI();
  }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)); }
  function measure(points) {
    const scale = Math.max(0.025, distance(points[0], points[9]));
    const extensions = [8, 12, 16, 20].filter((tip) => distance(points[tip], points[0]) > distance(points[tip - 2], points[0]) * 1.14).length;
    const ratio = distance(points[4], points[8]) / scale;
    const threshold = currentPose === 'pinch' ? 0.43 : 0.3;
    const pinched = ratio < threshold && distance(points[8], points[0]) / scale > 1.05;
    return {
      type: pinched ? 'pinch' : extensions >= 3 ? 'open' : extensions <= 1 ? 'fist' : 'idle',
      x: 1 - (points[4].x + points[8].x) / 2,
      y: (points[4].y + points[8].y) / 2,
      palm: { x: 1 - points[9].x, y: points[9].y }
    };
  }
  function processHands(hands) {
    if (!active) return;
    const now = performance.now();
    if (!hands?.length) {
      lastPinch = null; lastDistance = null;
      if (!lostAt) lostAt = now;
      if (now - lostAt > 300) { send(); hudLabel.textContent = '将手放在摄像头前'; message('等待手势 · 画面始终隐藏'); currentPose = ''; }
      return;
    }
    lostAt = 0;
    const primary = measure(hands[0]);
    const nextPose = hands.length > 1 ? 'twohands' : primary.type;
    if (nextPose === candidate) candidateFrames++;
    else { candidate = nextPose; candidateFrames = 1; }
    if (candidateFrames < 2) return;
    if (currentPose !== nextPose) { lastPinch = null; lastDistance = null; currentPose = nextPose; }
    if (nextPose === 'twohands') {
      const secondary = measure(hands[1]);
      const d = Math.hypot(primary.palm.x - secondary.palm.x, (primary.palm.y - secondary.palm.y) * 0.75);
      send({ zoomRatio: lastDistance && d > 0.04 ? d / lastDistance : 1 });
      lastDistance = d > 0.04 ? d : null;
      hudLabel.textContent = '双手张合 · 缩放宇宙';
    } else if (nextPose === 'pinch') {
      send({ yawDelta: lastPinch ? (primary.x - lastPinch.x) * 4.5 : 0, pitchDelta: lastPinch ? (primary.y - lastPinch.y) * 2.5 : 0 });
      lastPinch = { x: primary.x, y: primary.y };
      hudLabel.textContent = '捏合拖动 · 旋转星河';
    } else if (nextPose === 'open') {
      send({ spread: 0.95 }); hudLabel.textContent = '张开手掌 · 星尘散开';
    } else if (nextPose === 'fist') {
      send({ gather: 0.4 }); hudLabel.textContent = '轻轻握拳 · 星尘聚拢';
    } else {
      send(); hudLabel.textContent = '张掌散开 · 握拳聚合';
    }
    message(hudLabel.textContent + ' · 画面隐藏');
  }
  async function pump(now) {
    if (!active) return;
    animationId = requestAnimationFrame(pump);
    if (frameBusy || now - lastFrame < 65 || !video || video.readyState < 2) return;
    const thisGeneration = generation;
    frameBusy = true; lastFrame = now;
    try {
      const frame = await createImageBitmap(video);
      if (!active || thisGeneration !== generation || !worker) { frame.close(); return; }
      worker.postMessage({ type: 'frame', frame, timestamp: now }, [frame]);
      clearTimeout(inferenceTimer);
      inferenceTimer = setTimeout(() => stop('识别暂时没有响应，请重新启用', true), 10000);
    } catch (error) {
      if (thisGeneration === generation) { frameBusy = false; stop('无法读取相机画面，请重新启用', true); }
    }
  }
  async function start() {
    if (active || loading) { stop(); return; }
    if (location.protocol === 'file:') { message('手势控制请通过 node server.mjs 本地预览打开', true); return; }
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) { message('手势控制需要 HTTPS 或 localhost 环境', true); return; }
    if (!window.Worker || !window.createImageBitmap) { message('当前浏览器暂不支持手势识别，请用新版 Edge 或 Chrome', true); return; }
    const thisGeneration = ++generation;
    loading = true; message('请允许相机访问 · 摄像头画面不会显示'); updateUI();
    try {
      const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } }, audio: false });
      if (thisGeneration !== generation) { camera.getTracks().forEach((track) => track.stop()); return; }
      stream = camera;
      stream.getVideoTracks()[0].addEventListener('ended', () => { if (active || loading) stop('相机连接已断开，请重新启用', true); });
      video = document.createElement('video');
      video.className = 'camera-source'; video.hidden = true;
      video.muted = true; video.playsInline = true; video.autoplay = true;
      video.setAttribute('aria-hidden', 'true'); video.tabIndex = -1;
      document.body.append(video); video.srcObject = camera;
      await video.play();
      if (thisGeneration !== generation) return;
      message('正在加载本地识别引擎…');
      await new Promise((resolve, reject) => {
        readyReject = reject;
        worker = new Worker(new URL('gesture-worker.js', document.baseURI));
        readyTimer = setTimeout(() => reject(new Error('识别引擎加载超时')), 30000);
        worker.onmessage = (event) => {
          if (thisGeneration !== generation) return;
          if (event.data.type === 'ready') { clearTimeout(readyTimer); readyReject = null; resolve(); }
          else if (event.data.type === 'result') { clearTimeout(inferenceTimer); frameBusy = false; processHands(event.data.landmarks); }
          else if (event.data.type === 'error') { if (loading) reject(new Error(event.data.message)); else stop('识别引擎遇到问题，请重新启用', true); }
        };
        worker.onerror = (event) => { event.preventDefault(); if (loading) reject(new Error(event.message)); else stop('识别引擎遇到问题，请重新启用', true); };
        worker.postMessage({ type: 'init', baseUrl: new URL('./', document.baseURI).href });
      });
      if (thisGeneration !== generation) return;
      loading = false; active = true; lastFrame = 0;
      message('等待手势 · 画面始终隐藏'); hudLabel.textContent = '将手放在摄像头前'; updateUI();
      animationId = requestAnimationFrame(pump);
    } catch (error) {
      if (thisGeneration !== generation) return;
      const messages = {
        NotAllowedError: '相机授权未开启，请在浏览器设置中允许后重试',
        NotFoundError: '未检测到摄像头，请连接后重试',
        NotReadableError: '摄像头可能被其他应用占用，请稍后重试',
        OverconstrainedError: '相机不支持当前设置，请尝试其他设备',
        SecurityError: '浏览器限制了相机访问，请用 HTTPS 或 localhost 打开'
      };
      stop(messages[error.name] || '识别引擎加载失败，请刷新页面后重试', true);
      console.warn('手势控制未启用：', error.message);
    }
  }
  toggle.addEventListener('click', start);
  header.addEventListener('click', start);
  $('#gesture-stop').addEventListener('click', () => stop());
  document.addEventListener('visibilitychange', () => { if (document.hidden && (active || loading)) stop('已停止相机 · 点击开关可重新启用'); });
  addEventListener('pagehide', () => stop());
})();
