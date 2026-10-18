/* 星际 · 原生 WebGL 粒子引擎。无框架、无 CDN，file:// 下也能运行。 */
(() => {
  'use strict';

  let canvas = document.querySelector('#universe');
  const $ = (selector) => document.querySelector(selector);
  const MAX_PARTICLES = 80000;
  const STAR_COUNT = 1400;
  const TAU = Math.PI * 2;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const defaults = { count: 40000, speed: 0.35, glow: 1.15, scene: 'ring', palette: 'ice' };
  const state = { ...defaults, paused: reducedMotion, yaw: -0.25, pitch: 0.44, zoom: 1, targetZoom: 1, time: 0, burst: 0, handSpread: 0, targetHandSpread: 0, handGather: 1, targetHandGather: 1 };
  const scenes = {
    ring: { index: '01', title: '星际之环', subtitle: '让每一颗星，找到自己的轨道。', pitch: 0.44 },
    galaxy: { index: '02', title: '旋涡星河', subtitle: '绕过亿万光年，依然向你靠近。', pitch: 0.66 },
    sphere: { index: '03', title: '引力星团', subtitle: '散落的微光，也能聚成一个宇宙。', pitch: 0.16 }
  };
  const palettes = {
    ice: { name: '冰川蓝', inner: [0.65, 0.86, 1.0], outer: [0.34, 0.32, 0.88], accent: '#a6c4ff' },
    violet: { name: '星云紫', inner: [0.96, 0.69, 1.0], outer: [0.37, 0.27, 0.95], accent: '#d4b1ff' },
    gold: { name: '落日金', inner: [1.0, 0.89, 0.61], outer: [0.91, 0.29, 0.21], accent: '#ffd29b' }
  };
  let width = innerWidth;
  let height = innerHeight;
  let dpr = Math.min(devicePixelRatio || 1, 2);
  let renderScale = 1;
  let panelClosed = width <= 760;
  let morphStart = -3000;
  let burstStart = -5000;
  let targetPitch = state.pitch;
  let toastTimer;
  let previousTime = performance.now();
  let lastFpsTime = previousTime;
  let frameCount = 0;
  let frameId;
  let renderer;
  let destroyed = false;

  // A deterministic random source keeps transitions stable at every particle count.
  let randomSeed = 927413;
  function random() {
    randomSeed ^= randomSeed << 13;
    randomSeed ^= randomSeed >>> 17;
    randomSeed ^= randomSeed << 5;
    return (randomSeed >>> 0) / 4294967296;
  }
  function gaussian() {
    return Math.sqrt(-2 * Math.log(Math.max(random(), 0.00001))) * Math.cos(TAU * random());
  }

  const shapes = { ring: new Float32Array(MAX_PARTICLES * 3), galaxy: new Float32Array(MAX_PARTICLES * 3), sphere: new Float32Array(MAX_PARTICLES * 3) };
  const particleData = new Float32Array(MAX_PARTICLES * 4);
  const starPositions = new Float32Array(STAR_COUNT * 3);
  const starData = new Float32Array(STAR_COUNT * 4);

  function generateShapes() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const k = i * 3;
      const category = random();
      const angle = random() * TAU;
      let r, y;

      if (category < 0.12) {
        r = Math.min(1.3, Math.abs(gaussian()) * 0.42);
        y = gaussian() * 0.21;
      } else if (category < 0.91) {
        const band = random();
        if (band < 0.16) r = 2.9 + random() * 0.52;
        else if (band < 0.23) r = 3.56 + random() * 0.3;
        else if (band < 0.7) r = 4.0 + Math.pow(random(), 0.85) * 1.65;
        else if (band < 0.94) r = 5.84 + random() * 1.24;
        else r = 7.3 + random() * 0.45;
        y = gaussian() * (0.032 + r * 0.004);
        y += Math.sin(angle * 3 + r) * 0.025;
      } else {
        r = 2 + random() * 7.3;
        y = gaussian() * (0.28 + r * 0.036);
      }
      shapes.ring[k] = Math.cos(angle) * r;
      shapes.ring[k + 1] = y;
      shapes.ring[k + 2] = Math.sin(angle) * r;

      const galaxyCore = random() < 0.18;
      const galaxyRadius = galaxyCore ? Math.abs(gaussian()) * 0.65 : 0.8 + Math.pow(random(), 0.65) * 7.1;
      const arm = Math.floor(random() * 5) / 5 * TAU;
      const armAngle = galaxyCore ? random() * TAU : arm + galaxyRadius * 0.56 + gaussian() * (0.12 + 0.22 / galaxyRadius);
      shapes.galaxy[k] = Math.cos(armAngle) * galaxyRadius + gaussian() * 0.11;
      shapes.galaxy[k + 1] = gaussian() * (galaxyCore ? 0.35 : 0.08 + (8 - galaxyRadius) * 0.017);
      shapes.galaxy[k + 2] = Math.sin(armAngle) * galaxyRadius + gaussian() * 0.11;

      const phi = random() * TAU;
      const cosTheta = random() * 2 - 1;
      const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
      const sphereType = random();
      const sphereRadius = sphereType < 0.6 ? 3.3 + gaussian() * 0.12 : Math.cbrt(random()) * 3.3;
      if (sphereType > 0.91) {
        const orbitRadius = 4.6 + random() * 1.5;
        shapes.sphere[k] = Math.cos(phi) * orbitRadius;
        shapes.sphere[k + 1] = Math.sin(phi) * orbitRadius * 0.23 + gaussian() * 0.045;
        shapes.sphere[k + 2] = Math.sin(phi) * orbitRadius;
      } else {
        shapes.sphere[k] = sphereRadius * sinTheta * Math.cos(phi);
        shapes.sphere[k + 1] = sphereRadius * cosTheta;
        shapes.sphere[k + 2] = sphereRadius * sinTheta * Math.sin(phi);
      }

      particleData[i * 4] = 0.7 + Math.pow(random(), 4) * 2.6;
      particleData[i * 4 + 1] = 0.3 + random() * 0.7;
      particleData[i * 4 + 2] = random();
      particleData[i * 4 + 3] = 0.8 + random() * 0.4;
    }
    for (let i = 0; i < STAR_COUNT; i++) {
      starPositions[i * 3] = random() * 2 - 1;
      starPositions[i * 3 + 1] = random() * 2 - 1;
      starPositions[i * 3 + 2] = random();
      starData[i * 4] = 0.45 + Math.pow(random(), 9) * 2.9;
      starData[i * 4 + 1] = 0.14 + random() * 0.5;
      starData[i * 4 + 2] = random();
      starData[i * 4 + 3] = 1;
    }
  }
  generateShapes();
  let fromPositions = new Float32Array(shapes.ring);
  let toPositions = shapes.ring;

  const vertexShader = `
    precision highp float;
    attribute vec3 aFrom;
    attribute vec3 aTo;
    attribute vec4 aData;
    uniform float uMorph, uTime, uYaw, uPitch, uZoom, uDpr, uScale, uBurst, uPointScale, uGather;
    uniform mediump float uBackground;
    uniform vec2 uProjection, uCenter;
    varying float vColor, vAlpha;
    void main() {
      vec3 p = mix(aFrom, aTo, uMorph);
      if (uBackground > 0.5) {
        gl_Position = vec4(p.xy + vec2(sin(uYaw) * .009, sin(uPitch) * .009) * p.z, .9, 1.);
        gl_PointSize = max(.6, aData.x * uDpr);
        vColor = aData.z;
        vAlpha = aData.y * (.7 + .3 * sin(uTime * .4 + aData.z * 90.));
        return;
      }
      float radius = length(p.xz);
      float orbit = uTime * (.05 + .15 / (1. + radius * .3)) * aData.w + uYaw;
      float c = cos(orbit), s = sin(orbit);
      p.xz = mat2(c, s, -s, c) * p.xz;
      p.y += sin(uTime * .3 + aData.z * 50.) * .018 * min(radius, 4.);
      p *= uGather * (1. + uBurst * (.3 + aData.z * .7));
      p.y += uBurst * sin(aData.z * 100.) * 1.7;
      float cp = cos(uPitch), sp = sin(uPitch);
      p.yz = mat2(cp, sp, -sp, cp) * p.yz;
      float depth = max(2., 22. / uZoom - p.z);
      gl_Position = vec4(p.xy * uProjection * uScale / depth + uCenter, 0., 1.);
      gl_PointSize = clamp(aData.x * uDpr * uScale * 32. / depth, .8, 13. * uDpr) * uPointScale;
      vColor = clamp(radius / 8. + (aData.z - .5) * .24, 0., 1.);
      vAlpha = aData.y * (.88 + .12 * sin(aData.z * 60. + uTime));
    }`;
  const fragmentShader = `
    precision mediump float;
    uniform vec3 uInner, uOuter;
    uniform float uGlow, uBackground, uHalo;
    varying float vColor, vAlpha;
    void main() {
      vec2 q = gl_PointCoord * 2. - 1.;
      float d = dot(q, q);
      if (d > 1.) discard;
      float light = mix(exp(-d * 8.) + exp(-d * 2.8) * .15, exp(-d * 3.8) * .052, uHalo);
      vec3 color = mix(uInner, uOuter, vColor * .85);
      color = mix(color, vec3(.88, .93, 1.), .22);
      if (uBackground > .5) color = mix(vec3(.4, .5, .75), vec3(.82, .88, 1.), vColor);
      gl_FragColor = vec4(color, light * vAlpha * uGlow);
    }`;
  const atmosphereVertexShader = `
    attribute vec2 aPosition;
    varying vec2 vUv;
    void main() { vUv = aPosition; gl_Position = vec4(aPosition, .99, 1.); }`;
  const atmosphereFragmentShader = `
    precision mediump float;
    varying vec2 vUv;
    uniform vec2 uCenter;
    uniform float uAspect, uTime, uGlow, uScale;
    uniform vec3 uInner, uOuter;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
    }
    void main() {
      vec2 p = (vUv - uCenter) * vec2(uAspect, 1.) / max(.5, uScale);
      vec2 n = p * 3. + vec2(uTime * .004, 0.);
      float cloud = noise(n) * .55 + noise(n * 2.1) * .3 + noise(n * 4.3) * .15;
      float aura = exp(-dot(p * vec2(1.1, 2.3), p * vec2(1.1, 2.3)) * 3.5);
      float outer = exp(-dot((p + vec2(.5, .1)) * vec2(1., 1.8), (p + vec2(.5, .1)) * vec2(1., 1.8)) * 2.);
      vec3 color = vec3(.018, .024, .043) + uInner * aura * (.012 + cloud * .019) * uGlow + uOuter * outer * cloud * .013;
      gl_FragColor = vec4(color, 1.);
    }`;

  function makeWebGLRenderer(gl) {
    function shader(type, source) {
      const result = gl.createShader(type);
      gl.shaderSource(result, source);
      gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(result);
        gl.deleteShader(result);
        throw new Error(error);
      }
      return result;
    }
    function program(vs, fs) {
      const result = gl.createProgram();
      const vertex = shader(gl.VERTEX_SHADER, vs);
      const fragment = shader(gl.FRAGMENT_SHADER, fs);
      gl.attachShader(result, vertex);
      gl.attachShader(result, fragment);
      gl.linkProgram(result);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result));
      return result;
    }
    function buffer(data, usage = gl.STATIC_DRAW) {
      const result = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, result);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      return result;
    }
    const points = program(vertexShader, fragmentShader);
    const atmosphere = program(atmosphereVertexShader, atmosphereFragmentShader);
    const attributes = Object.fromEntries(['aFrom', 'aTo', 'aData'].map((name) => [name, gl.getAttribLocation(points, name)]));
    const names = ['uMorph', 'uTime', 'uYaw', 'uPitch', 'uZoom', 'uDpr', 'uScale', 'uBackground', 'uBurst', 'uProjection', 'uCenter', 'uInner', 'uOuter', 'uGlow', 'uPointScale', 'uHalo', 'uGather'];
    const uniforms = Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(points, name)]));
    const atmosphereUniforms = Object.fromEntries(['uCenter', 'uAspect', 'uTime', 'uGlow', 'uScale', 'uInner', 'uOuter'].map((name) => [name, gl.getUniformLocation(atmosphere, name)]));
    const quadAttribute = gl.getAttribLocation(atmosphere, 'aPosition');
    const quad = buffer(new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]));
    const from = buffer(fromPositions, gl.DYNAMIC_DRAW);
    const to = buffer(toPositions, gl.DYNAMIC_DRAW);
    const data = buffer(particleData);
    const stars = buffer(starPositions);
    const starsData = buffer(starData);
    gl.disable(gl.DEPTH_TEST);

    function attribute(location, source, size) {
      gl.bindBuffer(gl.ARRAY_BUFFER, source);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }
    return {
      type: 'webgl',
      updateShape() {
        gl.bindBuffer(gl.ARRAY_BUFFER, from);
        gl.bufferData(gl.ARRAY_BUFFER, fromPositions, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, to);
        gl.bufferData(gl.ARRAY_BUFFER, toPositions, gl.DYNAMIC_DRAW);
      },
      render(morph) {
        const palette = palettes[state.palette];
        const center = sceneCenter();
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.disable(gl.BLEND);
        gl.useProgram(atmosphere);
        // Attribute locations are shared WebGL state; clear them before the quad.
        for (const location of Object.values(attributes)) gl.disableVertexAttribArray(location);
        attribute(quadAttribute, quad, 2);
        gl.uniform2f(atmosphereUniforms.uCenter, center[0], center[1]);
        gl.uniform1f(atmosphereUniforms.uAspect, width / height);
        gl.uniform1f(atmosphereUniforms.uTime, state.time);
        gl.uniform1f(atmosphereUniforms.uGlow, state.glow);
        gl.uniform1f(atmosphereUniforms.uScale, renderScale);
        gl.uniform3fv(atmosphereUniforms.uInner, palette.inner);
        gl.uniform3fv(atmosphereUniforms.uOuter, palette.outer);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.disableVertexAttribArray(quadAttribute);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.useProgram(points);
        gl.uniform1f(uniforms.uMorph, morph);
        gl.uniform1f(uniforms.uTime, state.time);
        gl.uniform1f(uniforms.uYaw, state.yaw);
        gl.uniform1f(uniforms.uPitch, state.pitch);
        gl.uniform1f(uniforms.uZoom, state.zoom);
        gl.uniform1f(uniforms.uDpr, dpr);
        gl.uniform1f(uniforms.uScale, renderScale);
        gl.uniform1f(uniforms.uBurst, state.burst + state.handSpread);
        gl.uniform1f(uniforms.uGather, state.handGather);
        gl.uniform1f(uniforms.uPointScale, 1);
        gl.uniform1f(uniforms.uHalo, 0);
        gl.uniform2f(uniforms.uProjection, 2.15 / (width / height), 2.15);
        gl.uniform2f(uniforms.uCenter, center[0], center[1]);
        gl.uniform3fv(uniforms.uInner, palette.inner);
        gl.uniform3fv(uniforms.uOuter, palette.outer);

        attribute(attributes.aFrom, stars, 3);
        attribute(attributes.aTo, stars, 3);
        attribute(attributes.aData, starsData, 4);
        gl.uniform1f(uniforms.uBackground, 1);
        gl.uniform1f(uniforms.uGlow, 0.68);
        gl.drawArrays(gl.POINTS, 0, STAR_COUNT);

        attribute(attributes.aFrom, from, 3);
        attribute(attributes.aTo, to, 3);
        attribute(attributes.aData, data, 4);
        gl.uniform1f(uniforms.uBackground, 0);
        gl.uniform1f(uniforms.uGlow, state.glow);
        // A soft second point pass adds light around the actual particle cores.
        gl.uniform1f(uniforms.uPointScale, 4.5);
        gl.uniform1f(uniforms.uHalo, 1);
        gl.drawArrays(gl.POINTS, 0, state.count);
        gl.uniform1f(uniforms.uPointScale, 1);
        gl.uniform1f(uniforms.uHalo, 0);
        gl.drawArrays(gl.POINTS, 0, state.count);
      },
      destroy() {
        for (const b of [quad, from, to, data, stars, starsData]) gl.deleteBuffer(b);
        gl.deleteProgram(points);
        gl.deleteProgram(atmosphere);
      }
    };
  }

  // Canvas fallback keeps the entire UI and interactions usable without a GPU.
  function makeCanvasRenderer() {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('浏览器无法创建绘图画布');
    $('#renderer-label').textContent = 'Canvas 轻量粒子引擎';
    const notice = $('#fallback-notice');
    notice.hidden = false;
    setTimeout(() => { notice.hidden = true; }, 6500);
    const sprites = new Map();
    function sprite(color) {
      if (sprites.has(color)) return sprites.get(color);
      const image = document.createElement('canvas');
      image.width = image.height = 32;
      const c = image.getContext('2d');
      const gradient = c.createRadialGradient(16, 16, 0, 16, 16, 16);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.2, color);
      gradient.addColorStop(1, 'transparent');
      c.fillStyle = gradient;
      c.fillRect(0, 0, 32, 32);
      sprites.set(color, image);
      return image;
    }
    return {
      type: 'canvas',
      updateShape() {},
      render(morph) {
        const palette = palettes[state.palette];
        const center = sceneCenter();
        const cx = (center[0] + 1) / 2 * width;
        const cy = (1 - center[1]) / 2 * height;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#060810';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#9bb3db';
        for (let i = 0; i < STAR_COUNT; i++) {
          ctx.globalAlpha = starData[i * 4 + 1] * 0.65;
          ctx.fillRect((starPositions[i * 3] + 1) / 2 * width, (starPositions[i * 3 + 1] + 1) / 2 * height, starData[i * 4], starData[i * 4]);
        }
        ctx.globalCompositeOperation = 'lighter';
        const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
        // Sample the requested density proportionally on low-power browsers.
        const stride = Math.max(1, Math.ceil(state.count / 16000));
        const colors = Array.from({ length: 12 }, (_, j) => {
          const t = j / 11 * 0.85;
          return `rgb(${palette.inner.map((v, k) => Math.round((v * (1 - t) + palette.outer[k] * t) * 255)).join(',')})`;
        });
        for (let i = 0; i < state.count; i += stride) {
          const k = i * 3, d = i * 4;
          let x = fromPositions[k] * (1 - morph) + toPositions[k] * morph;
          let y = fromPositions[k + 1] * (1 - morph) + toPositions[k + 1] * morph;
          let z = fromPositions[k + 2] * (1 - morph) + toPositions[k + 2] * morph;
          const radius = Math.hypot(x, z);
          const a = state.time * (0.05 + 0.15 / (1 + radius * 0.3)) * particleData[d + 3] + state.yaw;
          const c = Math.cos(a), s = Math.sin(a);
          const rotatedX = c * x - s * z;
          z = s * x + c * z;
          x = rotatedX;
          const combinedSpread = state.burst + state.handSpread;
          const expansion = state.handGather * (1 + combinedSpread * (0.3 + particleData[d + 2] * 0.7));
          x *= expansion; y *= expansion; z *= expansion;
          y += combinedSpread * Math.sin(particleData[d + 2] * 100) * 1.7;
          const rotatedY = cp * y - sp * z;
          z = sp * y + cp * z;
          const depth = Math.max(2, 22 / state.zoom - z);
          const scale = height * 1.075 * renderScale / depth;
          const size = Math.max(1.4, particleData[d] * renderScale * 42 / depth);
          const color = colors[Math.min(11, Math.floor(radius / 8 * 11))];
          ctx.globalAlpha = Math.min(1, particleData[d + 1] * state.glow * 0.7);
          ctx.drawImage(sprite(color), cx + x * scale - size / 2, cy - rotatedY * scale - size / 2, size, size);
        }
        ctx.globalAlpha = 1;
      },
      destroy() { sprites.clear(); }
    };
  }

  function initializeRenderer(forceCanvas = false) {
    if (!forceCanvas) {
      const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
      if (gl) {
        try { return makeWebGLRenderer(gl); }
        catch (error) { console.warn('WebGL 初始化失败，切换轻量模式：', error); }
        // A canvas cannot switch context types; replace it if shader setup fails.
        const replacement = canvas.cloneNode();
        canvas.replaceWith(replacement);
        canvas = replacement;
        return makeCanvasRenderer();
      }
    }
    return makeCanvasRenderer();
  }

  function sceneCenter() {
    return [width <= 760 ? 0 : panelClosed ? 0 : -0.15, width <= 760 ? 0.05 : -0.01];
  }
  function resize() {
    width = innerWidth;
    height = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    renderScale = Math.min(1, width / height * (width <= 760 ? 1.12 : 1.3));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  function smoothstep(t) { return t * t * (3 - 2 * t); }
  function morphAt(now) { return smoothstep(Math.max(0, Math.min(1, (now - morphStart) / (reducedMotion ? 1 : 1800)))); }

  function setScene(name) {
    if (!scenes[name] || name === state.scene) return;
    const now = performance.now();
    const morph = morphAt(now);
    // Freeze the current interpolated geometry, even during a rapid second switch.
    for (let i = 0; i < fromPositions.length; i++) fromPositions[i] += (toPositions[i] - fromPositions[i]) * morph;
    toPositions = shapes[name];
    state.scene = name;
    morphStart = now;
    targetPitch = scenes[name].pitch;
    renderer.updateShape();
    updateSceneUI();
  }
  function updateSceneUI() {
    const info = scenes[state.scene];
    $('#scene-index').textContent = info.index;
    $('#scene-title').replaceChildren(document.createTextNode(info.title));
    const dot = document.createElement('span');
    dot.className = 'title-dot'; dot.textContent = '.';
    $('#scene-title').append(dot);
    $('#scene-subtitle').textContent = info.subtitle;
    document.querySelectorAll('[data-scene]').forEach((button) => {
      const selected = button.dataset.scene === state.scene;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }
  function setPalette(name) {
    if (!palettes[name]) return;
    state.palette = name;
    document.documentElement.style.setProperty('--accent', palettes[name].accent);
    $('#palette-name').textContent = palettes[name].name;
    document.querySelectorAll('[data-palette]').forEach((button) => {
      const selected = button.dataset.palette === name;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }
  function sliderFill(input) {
    input.style.setProperty('--fill', `${(Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`);
  }
  function updateSliders() {
    $('#particle-count').value = state.count;
    $('#speed').value = state.speed;
    $('#glow').value = state.glow;
    $('#count-value').textContent = state.count.toLocaleString('en-US');
    $('#speed-value').textContent = `${state.speed.toFixed(2)} ×`;
    $('#glow-value').textContent = state.glow.toFixed(2);
    $('#particle-stats').textContent = `${state.count.toLocaleString('en-US')} 颗星 · 无限可能`;
    document.querySelectorAll('input[type="range"]').forEach(sliderFill);
  }
  function setPaused(paused) {
    state.paused = paused;
    $('#play-pause').setAttribute('aria-pressed', String(paused));
    $('#play-pause').setAttribute('aria-label', paused ? '继续动画' : '暂停动画');
    $('#play-label').textContent = paused ? '继续流转' : '暂停流转';
    $('#play-icon').innerHTML = paused ? '<path d="m5 3 8 5-8 5z"/>' : '<path d="M4 3h3v10H4zm5 0h3v10H9z"/>';
    $('.live-indicator').lastChild.textContent = paused ? '时光静止' : '实时演算';
  }
  function setPanelClosed(closed) {
    panelClosed = closed;
    document.body.classList.toggle('panel-closed', closed);
    $('#open-panel').setAttribute('aria-expanded', String(!closed));
    $('#controls').inert = closed;
  }
  function toast(message) {
    const el = $('#toast');
    el.textContent = message; el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 2800);
  }
  function reset() {
    setScene('ring');
    Object.assign(state, defaults, { yaw: -0.25, zoom: 1, targetZoom: 1, burst: 0, time: 0, targetHandSpread: 0, targetHandGather: 1 });
    burstStart = -5000;
    targetPitch = scenes.ring.pitch;
    setPalette('ice');
    setPaused(reducedMotion);
    updateSliders();
    updateSceneUI();
    toast('星河已回到最初的模样');
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else toast('当前浏览器暂不支持全屏');
    } catch { toast('当前浏览器暂不支持全屏'); }
  }
  async function capture() {
    try {
      renderer.render(morphAt(performance.now()));
      const image = document.createElement('canvas');
      image.width = canvas.width;
      image.height = canvas.height;
      const ctx = image.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.fillStyle = 'rgba(205, 222, 255, .8)';
      ctx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText('星际 / INTERSTELLAR', 28, height - 29);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(160, 184, 222, .6)';
      ctx.font = '10px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText(`${scenes[state.scene].title} · ${state.count.toLocaleString('en-US')} 颗星`, width - 28, height - 29);
      const blob = await new Promise((resolve) => image.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('图片生成失败');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `星际-${scenes[state.scene].title}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      document.body.append(link);
      link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast('已保存这一刻的星河');
    } catch (error) {
      console.error('保存图片失败：', error);
      toast('图片保存失败，请重试');
    }
  }

  // Initialize before binding canvas events, so a fallback canvas retains them.
  try { renderer = initializeRenderer(); }
  catch (error) {
    destroyed = true;
    console.error(error);
    $('#fallback-notice').hidden = false;
    $('#fallback-notice').textContent = '浏览器暂时无法绘制星河，请尝试用 Edge、Chrome 或 Safari 打开。';
  }

  document.querySelectorAll('[data-scene]').forEach((button) => button.addEventListener('click', () => setScene(button.dataset.scene)));
  document.querySelectorAll('[data-palette]').forEach((button) => button.addEventListener('click', () => setPalette(button.dataset.palette)));
  $('#particle-count').addEventListener('input', (event) => { state.count = Number(event.target.value); updateSliders(); });
  $('#speed').addEventListener('input', (event) => { state.speed = Number(event.target.value); updateSliders(); });
  $('#glow').addEventListener('input', (event) => { state.glow = Number(event.target.value); updateSliders(); });
  $('#play-pause').addEventListener('click', () => setPaused(!state.paused));
  $('#reset').addEventListener('click', reset);
  $('#capture').addEventListener('click', capture);
  $('#fullscreen').addEventListener('click', toggleFullscreen);
  document.addEventListener('interstellar:gesture', (event) => {
    const action = event.detail || {};
    state.targetHandSpread = Number.isFinite(action.spread) ? Math.max(0, Math.min(1.4, action.spread)) : 0;
    state.targetHandGather = Number.isFinite(action.gather) ? Math.max(0.35, Math.min(1, action.gather)) : 1;
    if (Number.isFinite(action.yawDelta)) state.yaw += Math.max(-0.25, Math.min(0.25, action.yawDelta));
    if (Number.isFinite(action.pitchDelta)) targetPitch = Math.max(-1.4, Math.min(1.4, targetPitch + action.pitchDelta));
    if (Number.isFinite(action.zoomRatio)) state.targetZoom = Math.max(0.55, Math.min(1.85, state.targetZoom * Math.max(0.8, Math.min(1.25, action.zoomRatio))));
  });
  $('#close-panel').addEventListener('click', () => { setPanelClosed(true); $('#open-panel').focus(); });
  $('#open-panel').addEventListener('click', () => { setPanelClosed(false); $('#close-panel').focus(); });
  document.addEventListener('fullscreenchange', () => {
    const active = Boolean(document.fullscreenElement);
    $('#fullscreen').setAttribute('aria-label', active ? '退出全屏' : '进入全屏');
    $('#fullscreen').title = active ? '退出全屏 · F' : '全屏 · F';
  });
  document.addEventListener('keydown', (event) => {
    if (event.target.closest('input, textarea, button, a, [contenteditable="true"]')) return;
    if (event.code === 'Space') { event.preventDefault(); setPaused(!state.paused); }
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); toggleFullscreen(); }
    if (event.key === 'Escape' && width <= 760 && !panelClosed) setPanelClosed(true);
    if (event.target === canvas) {
      const step = 0.08;
      if (event.key === 'ArrowLeft') state.yaw -= step;
      else if (event.key === 'ArrowRight') state.yaw += step;
      else if (event.key === 'ArrowUp') targetPitch = Math.min(1.4, targetPitch + step);
      else if (event.key === 'ArrowDown') targetPitch = Math.max(-1.4, targetPitch - step);
      else if (event.key === '+' || event.key === '=') state.targetZoom = Math.min(1.85, state.targetZoom * 1.1);
      else if (event.key === '-') state.targetZoom = Math.max(0.55, state.targetZoom / 1.1);
      else return;
      event.preventDefault();
    }
  });

  const pointers = new Map();
  let pointerX = 0, pointerY = 0, pinchDistance = 0;
  let lastTap = 0, downX = 0, downY = 0, downAt = 0;
  let wasMultitouch = false;
  const distance = () => {
    const points = [...pointers.values()];
    return points.length >= 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
  };
  canvas.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
    pointerX = event.clientX; pointerY = event.clientY;
    if (pointers.size === 1) {
      downX = pointerX; downY = pointerY; downAt = performance.now(); wasMultitouch = false;
    } else { wasMultitouch = true; lastTap = 0; }
    pinchDistance = distance();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      const nextDistance = distance();
      if (pinchDistance > 0) state.targetZoom = Math.min(1.85, Math.max(0.55, state.targetZoom * nextDistance / pinchDistance));
      pinchDistance = nextDistance;
    } else {
      state.yaw += (event.clientX - pointerX) * 0.006;
      targetPitch = Math.max(-1.4, Math.min(1.4, targetPitch + (event.clientY - pointerY) * 0.004));
    }
    pointerX = event.clientX; pointerY = event.clientY;
  });
  function releasePointer(event) {
    if (!pointers.has(event.pointerId)) return;
    const now = performance.now();
    if (event.type === 'pointerup' && !wasMultitouch && now - downAt < 300 && Math.hypot(event.clientX - downX, event.clientY - downY) < 8) {
      if (lastTap && now - lastTap < 340) { burstStart = now; lastTap = 0; }
      else lastTap = now;
    }
    pointers.delete(event.pointerId);
    const remaining = [...pointers.values()][0];
    if (remaining) { pointerX = remaining.x; pointerY = remaining.y; }
    pinchDistance = distance();
  }
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('lostpointercapture', releasePointer);
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    state.targetZoom = Math.max(0.55, Math.min(1.85, state.targetZoom * Math.exp(-event.deltaY * 0.001)));
  }, { passive: false });
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(frameId); }
    else if (!destroyed) { previousTime = performance.now(); lastFpsTime = previousTime; frameCount = 0; frameId = requestAnimationFrame(animate); }
  });
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    cancelAnimationFrame(frameId);
    toast('图形引擎正在恢复…');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    renderer = initializeRenderer();
    if (renderer) { renderer.updateShape(); previousTime = performance.now(); frameId = requestAnimationFrame(animate); toast('星河已恢复'); }
  });
  addEventListener('pagehide', () => { cancelAnimationFrame(frameId); });
  addEventListener('pageshow', (event) => {
    if (event.persisted && !destroyed) { previousTime = performance.now(); frameId = requestAnimationFrame(animate); }
  });

  function animate(now) {
    if (destroyed) return;
    const delta = Math.min((now - previousTime) / 1000, 0.06);
    previousTime = now;
    if (!state.paused) state.time += delta * state.speed;
    state.pitch += (targetPitch - state.pitch) * Math.min(1, delta * 8);
    state.zoom += (state.targetZoom - state.zoom) * Math.min(1, delta * 9);
    state.handSpread += (state.targetHandSpread - state.handSpread) * Math.min(1, delta * 6);
    state.handGather += (state.targetHandGather - state.handGather) * Math.min(1, delta * 6);
    const burstProgress = Math.max(0, (now - burstStart) / 2200);
    state.burst = burstProgress < 1 ? Math.sin(burstProgress * Math.PI) * Math.exp(-burstProgress * 2) * 1.8 : 0;
    renderer.render(morphAt(now));
    frameCount++;
    if (now - lastFpsTime >= 1000) {
      $('#fps').textContent = `${Math.round(frameCount * 1000 / (now - lastFpsTime))} FPS`;
      frameCount = 0;
      lastFpsTime = now;
    }
    frameId = requestAnimationFrame(animate);
  }

  resize();
  setPanelClosed(panelClosed);
  setPaused(state.paused);
  updateSliders();
  if (renderer) frameId = requestAnimationFrame(animate);
})();
