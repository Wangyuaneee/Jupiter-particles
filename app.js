import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { EffectComposer } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';

const canvas = document.getElementById('scene');
const video = document.getElementById('webcam');
const fullscreenBtn = document.getElementById('fullscreen');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);
camera.position.set(0, 40, 180);

const lightDir = new THREE.Vector3(-0.6, 0.25, 0.8).normalize();
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.25, 0.0);
composer.addPass(bloomPass);

// 物理常量（用于开普勒定律）
const GM = 30000; // 引力常量 * 质量（可调，影响环的角速度）

// 状态与手势映射
const state = {
    openness: 0.5, // 手掌张合（0收拢，1张开）
    scaleMin: 0.7,
    scaleMax: 4.2,
    chaosThreshold: 3.4, // 放大靠近屏幕时触发混沌
};

// 土星分组
const saturn = new THREE.Group();
scene.add(saturn);

// 着色器（统一用于核心与环）
const vertexShader = `
  precision mediump float;
  uniform float uTime;
  uniform float uPointSize;
  uniform float uNoiseLevel;
  varying float vDepth;
  varying vec3 vLocal;
  void main(){
    vec3 p = position;
    float hash = fract(sin(dot(p.xy, vec2(12.9898,78.233))) * 43758.5453);
    p += (hash - 0.5) * uNoiseLevel * normalize(p + vec3(1e-4));
    vLocal = p;
    vec4 mv = modelViewMatrix * vec4(p,1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
    float size = uPointSize * (320.0 / vDepth);
    gl_PointSize = size;
  }
`;

const fragmentShader = `
  precision mediump float;
  uniform float uBrightness;
  uniform vec3 uColor;
  uniform float uIsRing;
  uniform float uCoreRadius;
  uniform vec3 uLightDir;
  varying float vDepth;
  varying vec3 vLocal;
  void main(){
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float r = length(uv);
    if(r>1.0) discard;
    float falloff = smoothstep(1.0, 0.0, r);
    float depthGlow = clamp(1.0 - (vDepth / 900.0), 0.25, 1.0);
    float lat = vLocal.y / (length(vLocal) + 1e-4);
    float bandMix = 0.6 + 0.4 * smoothstep(0.0, 1.0, abs(sin(lat * 18.0)));
    vec3 bandColor = mix(uColor * vec3(1.0, 0.95, 0.85), uColor * vec3(1.0, 0.82, 0.65), bandMix);
    vec3 baseColor = mix(bandColor, uColor, uIsRing);
    float occ = 1.0;
    if(uIsRing > 0.5){
      vec3 L = normalize(uLightDir);
      float d = length(vLocal);
      float behind = step(0.0, -dot(normalize(vLocal), L));
      float near = smoothstep(uCoreRadius + 4.0, uCoreRadius - 6.0, d);
      occ = mix(1.0, 0.45, clamp(behind * near, 0.0, 1.0));
    }
    vec3 col = baseColor * uBrightness * falloff * depthGlow * occ;
    gl_FragColor = vec4(col, falloff * uBrightness);
  }
`;

function makeMaterial(colorHex) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uPointSize: { value: 2.8 },
            uNoiseLevel: { value: 0.0 },
            uBrightness: { value: 1.0 },
            uColor: { value: new THREE.Color(colorHex) },
            uIsRing: { value: 0.0 },
            uCoreRadius: { value: 26.0 },
            uLightDir: { value: lightDir.clone() },
        },
        vertexShader,
        fragmentShader,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
    });
}

// 创建核心（粒子球）
const coreCount = 22000;
const coreRadius = 32;
const coreGeom = new THREE.BufferGeometry();
const corePositions = new Float32Array(coreCount * 3);
for (let i = 0; i < coreCount; i++) {
    // 随机球面分布（带少许厚度）
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = coreRadius + (Math.random() - 0.5) * 2.0; // 细微厚度
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);
    corePositions[i * 3 + 0] = x;
    corePositions[i * 3 + 1] = y;
    corePositions[i * 3 + 2] = z;
}
coreGeom.setAttribute('position', new THREE.BufferAttribute(corePositions, 3));
const coreMat = makeMaterial(0xffe5b0);
coreMat.uniforms.uIsRing.value = 0.0;
const corePoints = new THREE.Points(coreGeom, coreMat);
saturn.add(corePoints);

// 创建环：B环与A环，包含 Cassini、Encke、Keeler 空隙
const ringTilt = THREE.MathUtils.degToRad(27);
function genRing(rangeMin, rangeMax, count, colorHex) {
    const geom = new THREE.BufferGeometry();
    const posArr = new Float32Array(count * 3);
    const radiusArr = new Float32Array(count);
    const angleArr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const rRand = Math.pow(Math.random(), 1.15);
        const radius = THREE.MathUtils.lerp(rangeMin, rangeMax, rRand);
        const R = radius / coreRadius;
        if (R > 1.95 && R < 2.03) { // Cassini Division 强剔除
            posArr[i * 3] = 0; posArr[i * 3 + 1] = 0; posArr[i * 3 + 2] = 0;
            radiusArr[i] = coreRadius * 2.03; angleArr[i] = 0.0; continue;
        }
        if (R > 2.19 && R < 2.22 && Math.random() < 0.8) { // Encke gap 高概率剔除
            posArr[i * 3] = 0; posArr[i * 3 + 1] = 0; posArr[i * 3 + 2] = 0;
            radiusArr[i] = coreRadius * 2.22; angleArr[i] = 0.0; continue;
        }
        if (R > 2.255 && R < 2.265 && Math.random() < 0.9) { // Keeler gap 更窄
            posArr[i * 3] = 0; posArr[i * 3 + 1] = 0; posArr[i * 3 + 2] = 0;
            radiusArr[i] = coreRadius * 2.265; angleArr[i] = 0.0; continue;
        }
        const angle = Math.random() * Math.PI * 2;
        const thickness = (Math.random() - 0.5) * 0.35;
        const x = radius * Math.cos(angle);
        const y = thickness;
        const z = radius * Math.sin(angle);
        const i3 = i * 3;
        posArr[i3] = x; posArr[i3 + 1] = y; posArr[i3 + 2] = z;
        radiusArr[i] = radius; angleArr[i] = angle;
    }
    geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geom.setAttribute('radius', new THREE.BufferAttribute(radiusArr, 1));
    geom.setAttribute('angle', new THREE.BufferAttribute(angleArr, 1));
    const mat = makeMaterial(colorHex);
    mat.uniforms.uPointSize.value = 2.0;
    mat.uniforms.uIsRing.value = 1.0;
    mat.uniforms.uCoreRadius.value = coreRadius;
    const points = new THREE.Points(geom, mat);
    points.rotation.x = ringTilt;
    return { geom, mat, points, count };
}

const ringB = genRing(coreRadius * 1.52, coreRadius * 1.95, 16000, 0xd8ecff);
const ringA = genRing(coreRadius * 2.03, coreRadius * 2.27, 14000, 0xcfe8ff);
saturn.add(ringB.points);
saturn.add(ringA.points);

// 摄像头与手势（MediaPipe Hands）
async function initCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
    video.srcObject = stream;
    await video.play();
}

function computeOpenness(landmarks) {
    // 以腕部(0)与中指根(9)的距离作为尺度归一化
    const wrist = landmarks[0];
    const midMCP = landmarks[9];
    const norm = Math.hypot(midMCP.x - wrist.x, midMCP.y - wrist.y);
    // 4个指尖: 8, 12, 16, 20 距离掌心(9)的平均值，近似反映张开程度
    const tips = [8, 12, 16, 20].map(i => landmarks[i]);
    let avg = 0;
    for (const t of tips) { avg += Math.hypot(t.x - midMCP.x, t.y - midMCP.y); }
    avg /= tips.length;
    let o = (avg / (norm + 1e-6) - 0.45) / 0.55; // 经验阈值
    return THREE.MathUtils.clamp(o, 0, 1);
}

function initHands() {
    const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
    hands.setOptions({
        maxHands: 1,
        modelComplexity: 1,
        selfieMode: true,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.6,
    });
    hands.onResults((results) => {
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const lm = results.multiHandLandmarks[0];
            state.openness = computeOpenness(lm);
        }
    });
    const cameraFeed = new Camera(video, {
        onFrame: async () => { await hands.send({ image: video }); },
        width: 640, height: 480
    });
    cameraFeed.start();
}

// 交互：全屏
fullscreenBtn.addEventListener('click', () => {
    const el = document.getElementById('app');
    if (!document.fullscreenElement) el.requestFullscreen().catch(() => { });
    else document.exitFullscreen();
});

// 响应尺寸变化
addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    composer.setSize(innerWidth, innerHeight);
    bloomPass.setSize(innerWidth, innerHeight);
});

// 动画更新
const clock = new THREE.Clock();
let currentScale = state.scaleMin;
let targetScale = state.scaleMin;
function animate() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    targetScale = THREE.MathUtils.lerp(state.scaleMin, state.scaleMax, state.openness);
    currentScale = THREE.MathUtils.damp(currentScale, targetScale, 3.6, dt);
    saturn.scale.setScalar(currentScale);
    const brightness = THREE.MathUtils.clamp(Math.pow(currentScale / state.scaleMax, 2.0) * 1.05, 0.3, 1.0);
    coreMat.uniforms.uBrightness.value = brightness;
    ringB.mat.uniforms.uBrightness.value = brightness;
    ringA.mat.uniforms.uBrightness.value = brightness;

    const chaosLevel = THREE.MathUtils.smoothstep(state.chaosThreshold, state.scaleMax, currentScale);
    const noiseAmp = chaosLevel * 2.8;
    coreMat.uniforms.uNoiseLevel.value = noiseAmp;
    ringB.mat.uniforms.uNoiseLevel.value = noiseAmp * 0.7;
    ringA.mat.uniforms.uNoiseLevel.value = noiseAmp * 0.7;

    // 土星核心微旋转，带来生命感
    saturn.rotation.y += 0.02 * dt;

    // 开普勒轨道更新（双环）
    function updateRing(ring) {
        const pos = ring.geom.getAttribute('position');
        const radiusAttr = ring.geom.getAttribute('radius');
        const angleAttr = ring.geom.getAttribute('angle');
        for (let i = 0; i < ring.count; i++) {
            const r = radiusAttr.getX(i) * currentScale;
            const omega = Math.sqrt(GM / Math.max(r * r * r, 1.0));
            let phi = angleAttr.getX(i);
            phi += omega * dt;
            const jitterAng = (Math.random() - 0.5) * chaosLevel * 0.26;
            const jitterRad = (Math.random() - 0.5) * chaosLevel * 0.6;
            const rr = r + jitterRad;
            const x = rr * Math.cos(phi + jitterAng);
            const z = rr * Math.sin(phi + jitterAng);
            const y = (Math.random() - 0.5) * chaosLevel * 0.85;
            pos.setXYZ(i, x, y, z);
            angleAttr.setX(i, phi);
        }
        pos.needsUpdate = true;
        angleAttr.needsUpdate = true;
    }
    updateRing(ringB);
    updateRing(ringA);

    // 时间传入着色器
    coreMat.uniforms.uTime.value = t;
    ringB.mat.uniforms.uTime.value = t;
    ringA.mat.uniforms.uTime.value = t;

    composer.render();
    requestAnimationFrame(animate);
}

(async function start() {
    await initCamera();
    initHands();
    // 星空背景
    (function addStarfield() {
        const count = 12000, radius = 1200;
        const pos = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const u = Math.random();
            const v = Math.random();
            const theta = 2 * Math.PI * u;
            const phi = Math.acos(2 * v - 1);
            const r = radius;
            const x = r * Math.sin(phi) * Math.cos(theta);
            const y = r * Math.sin(phi) * Math.sin(theta);
            const z = r * Math.cos(phi);
            const i3 = i * 3; pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z;
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = makeMaterial(0xffffff);
        mat.uniforms.uBrightness.value = 0.55;
        mat.uniforms.uPointSize.value = 1.1;
        const pts = new THREE.Points(geom, mat);
        pts.renderOrder = -1;
        scene.add(pts);
    })();
    animate();
})();

