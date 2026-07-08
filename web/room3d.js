/**
 * Pixel Home 3D Room Viewer — Two-Room Procedural Edition
 * 户型：卧室（左） + 客厅（右），中间有隔墙和门洞
 * 与旧版 API 完全兼容
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ═══════════════════════════════════════════════════
// 材质工厂
// ═══════════════════════════════════════════════════
const Mat = {
  wall:      () => new THREE.MeshStandardMaterial({ color: 0xfff5e0, roughness: 0.92, name: 'mat_wall' }),
  floor:     () => new THREE.MeshStandardMaterial({ color: 0xc4a47a, roughness: 0.72, name: 'mat_floor' }),
  ceiling:   () => new THREE.MeshStandardMaterial({ color: 0xf7f7f7, roughness: 0.95, name: 'mat_ceiling' }),
  door:      () => new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.55, name: 'mat_door' }),
  frame:     () => new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.5, name: 'mat_frame' }),
  glass:     () => new THREE.MeshStandardMaterial({ color: 0xb8dff0, roughness: 0.08, metalness: 0.05, transparent: true, opacity: 0.38, name: 'mat_glass' }),
  lampBody:  () => new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.25, metalness: 0.7, name: 'mat_lamp_body' }),
  lampBulb:  () => new THREE.MeshStandardMaterial({ color: 0xfffbe6, roughness: 0.1, emissive: 0x000000, emissiveIntensity: 0, name: 'mat_lamp_bulb' }),
  fanBlade:  () => new THREE.MeshStandardMaterial({ color: 0x2c5282, roughness: 0.35, metalness: 0.25, name: 'mat_fan_blade' }),
  fanHub:    () => new THREE.MeshStandardMaterial({ color: 0xd4d4d4, roughness: 0.3, metalness: 0.6, name: 'mat_fan_hub' }),
  table:     () => new THREE.MeshStandardMaterial({ color: 0xdeb887, roughness: 0.55, name: 'mat_table' }),
  chairWood: () => new THREE.MeshStandardMaterial({ color: 0x5c4a3a, roughness: 0.5, name: 'mat_chair_wood' }),
  baseboard: () => new THREE.MeshStandardMaterial({ color: 0xe8ddcc, roughness: 0.85, name: 'mat_baseboard' }),
  rug:       () => new THREE.MeshStandardMaterial({ color: 0xd4c5a9, roughness: 0.9, name: 'mat_rug' }),
  bedFrame:  () => new THREE.MeshStandardMaterial({ color: 0x7a6552, roughness: 0.5, name: 'mat_bed_frame' }),
  mattress:  () => new THREE.MeshStandardMaterial({ color: 0xf5f1ea, roughness: 0.85, name: 'mat_mattress' }),
  pillow:    () => new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.9, name: 'mat_pillow' }),
  blanket:   () => new THREE.MeshStandardMaterial({ color: 0x5b8c7a, roughness: 0.8, name: 'mat_blanket' }),
  nightstand:()=> new THREE.MeshStandardMaterial({ color: 0xdeb887, roughness: 0.55, name: 'mat_nightstand' }),
};

// ═══════════════════════════════════════════════════
// 房间常量
// ═══════════════════════════════════════════════════
const W  = 4.0,  D  = 3.4,  H  = 2.6,  T  = 0.08;
const HW = 2.0,  HD = 1.7;

// 入户门 — 在客厅前墙（x>0 区域）
const MAIN_DOOR = { hingeX: 0.60, w: 0.86, h: 2.1, t: 0.04, side: 'right' };

// 窗户通用参数
const WIN = { w: 1.05, h: 1.0, t: 0.03, yBot: 1.05, frameT: 0.05, frameD: 0.07 };

// 卧室窗户（左墙）
const BED_WIN_Z = 0.45;
// 客厅窗户（右墙）
const LIV_WIN_Z = 0.45;

// 隔墙门洞（x=0 处，连通卧室与客厅）
const INT_DOOR = { z: -0.7, w: 0.82, h: 2.1 };

// ═══════════════════════════════════════════════════
// 工具
// ═══════════════════════════════════════════════════
let _meshIdx = 0;
function reg(obj, name) {
  obj.name = name;
  obj.castShadow = true;
  obj.receiveShadow = true;
  const bbox = new THREE.Box3().setFromObject(obj);
  const sx = bbox.max.x - bbox.min.x;
  const sy = bbox.max.y - bbox.min.y;
  const sz = bbox.max.z - bbox.min.z;
  const cy = (bbox.min.y + bbox.max.y) / 2;
  const volume = sx * sy * sz;
  return { node: obj, meshIndex: _meshIdx++, name,
    bbox: { sx, sy, sz, cy, volume, min: bbox.min.clone(), max: bbox.max.clone() } };
}
function box(w, h, d, mat, name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.name = name;
  return m;
}
function cyl(rTop, rBot, h, seg, mat, name) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
  m.name = name;
  return m;
}

// ═══════════════════════════════════════════════════
// 构建窗户 Group（可复用）
// ═══════════════════════════════════════════════════
function buildWindowGroup() {
  const g = new THREE.Group();
  const { w, h, t, frameT, frameD } = WIN;
  const fw = frameT, fd = frameD;
  const fW = w + fw * 2, fH = h + fw * 2;
  const fMat = Mat.frame();

  const fp = [
    { bw: fW, bh: fw, bd: fd, x: 0, y: fH - fw / 2, z: 0 },          // 上
    { bw: fW, bh: fw, bd: fd, x: 0, y: fw / 2, z: 0 },                 // 下
    { bw: fw, bh: fH, bd: fd, x: -fW / 2 + fw / 2, y: fH / 2, z: 0 }, // 左
    { bw: fw, bh: fH, bd: fd, x: fW / 2 - fw / 2, y: fH / 2, z: 0 },  // 右
  ];
  fp.forEach(p => {
    const m = box(p.bw, p.bh, p.bd, fMat, 'win_frame');
    m.position.set(p.x, p.y, p.z);
    g.add(m);
  });
  // 玻璃两扇
  for (let s = 0; s < 2; s++) {
    const gm = new THREE.Mesh(new THREE.BoxGeometry(w / 2 - fw, h - fw * 2, t), Mat.glass());
    gm.position.x = (s === 0 ? -1 : 1) * (w / 4);
    gm.position.y = fH / 2;
    gm.name = 'glass_' + s;
    gm.renderOrder = 1;
    gm.material.depthWrite = false;
    g.add(gm);
  }
  return g;
}

// ═══════════════════════════════════════════════════
// Room3D 主对象
// ═══════════════════════════════════════════════════
const Room3D = {

  ready: false,
  scene: null, camera: null, renderer: null, controls: null, modelRoot: null,

  allMeshes: [],
  doorTarget: null, doorTargets: [],
  windowTarget: null, windowOpen: false, windowTargets: [],
  lampTargets: [], ceilingTarget: null, fanTarget: null, shellTarget: null, lampPointLight: null,

  doorOpen: false, doorAngle: 0, lightOn: false, fanOn: false, fanAngle: 0,
  _focusAnim: null,

  // ═══════════════════════════════════════════════
  async init(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) { console.error('[Room3D] 容器未找到:', containerSelector); return; }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fd3e8);
    this.scene.fog = new THREE.Fog(0x8fd3e8, 8, 25);

    const rect = container.getBoundingClientRect();
    const cw = rect.width || container.clientWidth || 640;
    const ch = rect.height || container.clientHeight || 380;
    console.log('[Room3D] 容器尺寸:', cw, 'x', ch);
    this.camera = new THREE.PerspectiveCamera(50, cw / Math.max(1, ch), 0.05, 50);
    this.camera.position.set(3.2, 3.8, 4.5);
    this.camera.lookAt(0, 0.8, -0.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(cw, ch);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'room3dCanvas';

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 12;
    this.controls.maxPolarAngle = Math.PI * 0.85;
    this.controls.update();

    this._setupLights();
    this._buildProceduralRoom();
    this.ready = true;
    console.log('[Room3D] 两室户型构建完成，共', this.allMeshes.length, '个 mesh');
    this._printMeshGuide();

    this._setupRaycaster();
    this._setupKeyboard();
    window.addEventListener('resize', () => this._onResize(container));
    this._animate();
  },

  // ═══════════════════════════════════════════════
  _setupLights() {
    const ambient = new THREE.AmbientLight(0xfff5e8, 0.9);
    this.scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0x8fd3e8, 0x6b8c5c, 0.5);
    this.scene.add(hemi);
    this.sunLight = new THREE.DirectionalLight(0xfff8e7, 3.0);
    this.sunLight.position.set(8, 10, 2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 50;
    this.sunLight.shadow.camera.left = -8; this.sunLight.shadow.camera.right = 8;
    this.sunLight.shadow.camera.top = 8; this.sunLight.shadow.camera.bottom = -2;
    this.sunLight.shadow.bias = -0.0001;
    this.scene.add(this.sunLight);
    this._buildEnvMap();
  },

  _buildEnvMap() {
    if (!this.renderer) return;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, '#c9e4f2'); grad.addColorStop(0.45, '#fff3dc');
    grad.addColorStop(0.7, '#e8d5b0'); grad.addColorStop(1, '#c4b89a');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 256, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const envMap = pmrem.fromEquirectangular(tex);
    this.scene.environment = envMap;
    this.scene.background = new THREE.Color(0xdce8f0);
    tex.dispose(); pmrem.dispose();
  },

  // ═══════════════════════════════════════════════
  // 构建两室一厅程序化户型
  // ═══════════════════════════════════════════════
  _buildProceduralRoom() {
    _meshIdx = 0;
    this.allMeshes = [];
    this.modelRoot = new THREE.Group();
    this.modelRoot.name = 'Apartment';
    const frontZ = -HD;  // -1.7

    // ──── 地板 ────
    {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W, D), Mat.floor());
      m.rotation.x = -Math.PI / 2; m.position.y = 0.005;
      m.receiveShadow = true; m.castShadow = false; m.name = 'floor';
      this.modelRoot.add(m);
      this.allMeshes.push(reg(m, 'floor'));
    }

    // ──── 地毯（客厅）────
    {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), Mat.rug());
      m.rotation.x = -Math.PI / 2; m.position.set(1.0, 0.008, 0.7);
      m.receiveShadow = true; m.castShadow = false; m.name = 'rug_living';
      this.modelRoot.add(m);
      this.allMeshes.push(reg(m, 'rug_living'));
    }
    // 地毯（卧室）
    {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.5), Mat.rug());
      m.rotation.x = -Math.PI / 2; m.position.set(-1.0, 0.008, 0.2);
      m.receiveShadow = true; m.castShadow = false; m.name = 'rug_bedroom';
      this.modelRoot.add(m);
      this.allMeshes.push(reg(m, 'rug_bedroom'));
    }

    // ──── 天花板 ────
    {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W, D), Mat.ceiling());
      m.rotation.x = Math.PI / 2; m.position.y = H - 0.005;
      m.receiveShadow = true; m.castShadow = false; m.name = 'ceiling';
      this.modelRoot.add(m);
      const entry = reg(m, 'ceiling');
      this.allMeshes.push(entry);
      this.ceilingTarget = entry;
    }

    // ──── 外墙 ────
    const addWall = (w, h, d, x, y, z, name) => {
      const m = box(w, h, d, Mat.wall(), name);
      m.position.set(x, y, z); m.receiveShadow = true;
      this.modelRoot.add(m);
      this.allMeshes.push(reg(m, name));
      return m;
    };
    // 后墙（整面）
    addWall(W, H, T, 0, H / 2, HD, 'wall_back');
    // 左墙（整面）
    addWall(T, H, D, -HW, H / 2, 0, 'wall_left');
    // 右墙（整面）
    addWall(T, H, D, HW, H / 2, 0, 'wall_right');

    // ═══════════════════════════════════════════════
    // 隔墙 x=0（卧室 | 客厅），中间留门洞
    // ═══════════════════════════════════════════════
    {
      const iwZ = INT_DOOR.z;
      const iwW = INT_DOOR.w;
      const iwH = INT_DOOR.h;
      const segTopZ = iwZ + iwW / 2;        // 门洞上段起于 z = iwZ + iwW/2
      const segBotZ = iwZ - iwW / 2;
      const topLen = HD - segTopZ;          // segTopZ → +1.7
      const botLen = segBotZ - (-HD);       // -1.7 → segBotZ
      const topCY = segTopZ + topLen / 2;
      const botCY = -HD + botLen / 2;

      if (topLen > 0.01) addWall(T, H, topLen, 0, H / 2, topCY, 'wall_interior_top');
      if (botLen > 0.01) addWall(T, H, botLen, 0, H / 2, botCY, 'wall_interior_bot');

      // 门洞过梁
      const lintelH = H - iwH;
      if (lintelH > 0.01) {
        const lb = box(T, lintelH, iwW + 0.02, Mat.wall(), 'wall_interior_lintel');
        lb.position.set(0, H - lintelH / 2, iwZ);
        lb.receiveShadow = true;
        this.modelRoot.add(lb);
        this.allMeshes.push(reg(lb, 'wall_interior_lintel'));
      }
    }

    // ═══════════════════════════════════════════════
    // 前墙（分两段：卧室段 + 客厅段带入户门）
    // ═══════════════════════════════════════════════
    const md = MAIN_DOOR;
    const mdHinge = md.hingeX;         // 0.60
    const mdFar = mdHinge + md.w;      // 1.46

    // 前墙-卧室段 (x: -2 → 0, 整面)
    addWall(HW, H, T, -HW / 2, H / 2, frontZ, 'wall_front_bedroom');

    // 前墙-客厅门左 (x: 0 → mdHinge)
    if (mdHinge > 0.01) {
      addWall(mdHinge, H, T, mdHinge / 2, H / 2, frontZ, 'wall_front_liv_left');
    }
    // 前墙-客厅门右 (x: mdFar → 2)
    const segR = HW - mdFar;
    if (segR > 0.01) {
      addWall(segR, H, T, mdFar + segR / 2, H / 2, frontZ, 'wall_front_liv_right');
    }
    // 门过梁
    {
      const lh = H - md.h;
      const lb = box(md.w + 0.06, lh, T, Mat.wall(), 'wall_front_lintel');
      lb.position.set(mdHinge + md.w / 2, H - lh / 2, frontZ);
      lb.receiveShadow = true;
      this.modelRoot.add(lb);
      this.allMeshes.push(reg(lb, 'wall_front_lintel'));
    }

    // ═══════════════════════════════════════════════
    // 入户门（客厅前墙）
    // ═══════════════════════════════════════════════
    {
      const dg = new THREE.BoxGeometry(md.w, md.h, md.t);
      dg.translate(md.w / 2, 0, 0);  // 铰链边对齐 Y 轴

      const dm = new THREE.Mesh(dg, Mat.door());
      dm.position.set(mdHinge, md.h / 2 + 0.01, frontZ + md.t / 2 + 0.005);
      dm.castShadow = true; dm.receiveShadow = true;
      dm.name = 'procedural_door';
      this.modelRoot.add(dm);
      const entry = reg(dm, 'procedural_door');
      this.allMeshes.push(entry);
      this.doorTarget = entry;
      this.doorTargets = [entry];

      // 门框
      const fw = 0.06; const fd = 0.08; const fm = Mat.frame();
      [
        { bx: mdHinge - fw/2 + 0.01, by: md.h/2 + 0.01, bz: frontZ + fd/2, bw: fw, bh: md.h },
        { bx: mdFar + fw/2 - 0.01, by: md.h/2 + 0.01, bz: frontZ + fd/2, bw: fw, bh: md.h },
        { bx: mdHinge + md.w/2, by: md.h + fw/2 + 0.01, bz: frontZ + fd/2, bw: md.w + fw, bh: fw },
      ].forEach((p, i) => {
        const fm2 = new THREE.Mesh(new THREE.BoxGeometry(p.bw, p.bh, fd), fm);
        fm2.position.set(p.bx, p.by, p.bz);
        fm2.name = 'door_frame_' + i;
        fm2.castShadow = true; fm2.receiveShadow = true;
        this.modelRoot.add(fm2);
      });
    }

    // ═══════════════════════════════════════════════
    // 卧室窗户（左墙）
    // ═══════════════════════════════════════════════
    {
      const wg = buildWindowGroup();
      wg.position.set(-HW + T / 2 + 0.001, WIN.yBot, BED_WIN_Z);
      wg.rotation.y = Math.PI / 2;  // 左墙 YZ 面
      wg.name = 'procedural_window_bed';
      this.modelRoot.add(wg);
      const entry = reg(wg, 'procedural_window_bed');
      this.allMeshes.push(entry);
      this.windowTarget = entry;
      this.windowTargets = [entry];
    }

    // ═══════════════════════════════════════════════
    // 客厅窗户（右墙）
    // ═══════════════════════════════════════════════
    {
      const wg = buildWindowGroup();
      wg.position.set(HW - T / 2 - 0.001, WIN.yBot, LIV_WIN_Z);
      wg.rotation.y = -Math.PI / 2;  // 右墙 YZ 面，外侧
      wg.name = 'procedural_window_liv';
      this.modelRoot.add(wg);
      const entry = reg(wg, 'procedural_window_liv');
      this.allMeshes.push(entry);
      // 附加到 windowTargets 列表（主窗仍是卧室窗）
      this.windowTargets.push(entry);
    }

    // ═══════════════════════════════════════════════
    // 卧室：床（靠后墙偏左）
    // ═══════════════════════════════════════════════
    {
      const bedGroup = new THREE.Group();
      bedGroup.name = 'bed_group';
      const bx = -1.0, bz = 1.05;

      // 床架
      const frameW = 1.45, frameL = 2.05, frameH = 0.12;
      const frame = box(frameW, frameH, frameL, Mat.bedFrame(), 'bed_frame');
      frame.position.set(0, frameH / 2, 0);
      bedGroup.add(frame);

      // 床头板
      const hb = box(frameW + 0.06, 0.55, 0.05, Mat.bedFrame(), 'bed_headboard');
      hb.position.set(0, frameH + 0.28, -frameL / 2 + 0.03);
      bedGroup.add(hb);

      // 床垫
      const matW = frameW - 0.08, matL = frameL - 0.08;
      const mattress = box(matW, 0.16, matL, Mat.mattress(), 'bed_mattress');
      mattress.position.set(0, frameH + 0.08, 0);
      mattress.castShadow = false;
      bedGroup.add(mattress);

      // 两个枕头
      for (let p = 0; p < 2; p++) {
        const pillow = box(0.35, 0.08, 0.55, Mat.pillow(), 'pillow_' + p);
        pillow.position.set((p === 0 ? -1 : 1) * 0.38, frameH + 0.17, -matL / 2 + 0.28);
        pillow.castShadow = false;
        bedGroup.add(pillow);
      }

      // 被子（折叠在床尾）
      const blanket = box(matW - 0.04, 0.1, 0.5, Mat.blanket(), 'blanket');
      blanket.position.set(0, frameH + 0.17, matL / 2 - 0.25);
      blanket.castShadow = false;
      bedGroup.add(blanket);

      bedGroup.position.set(bx, 0.005, bz - frameL / 2);
      this.modelRoot.add(bedGroup);
      this.allMeshes.push(reg(bedGroup, 'bed'));
    }

    // ═══════════════════════════════════════════════
    // 卧室：床头柜
    // ═══════════════════════════════════════════════
    {
      const ns = new THREE.Group();
      ns.name = 'nightstand_group';
      // 柜体
      const body = box(0.38, 0.5, 0.35, Mat.nightstand(), 'nightstand_body');
      body.position.y = 0.25;
      ns.add(body);
      // 四条小短腿
      [[-0.15, 0.12, -0.13], [0.15, 0.12, -0.13], [-0.15, 0.12, 0.13], [0.15, 0.12, 0.13]].forEach(([lx, ly, lz]) => {
        ns.add(cyl(0.02, 0.02, 0.24, 6, Mat.chairWood(), 'ns_leg'));
        ns.children[ns.children.length - 1].position.set(lx, ly, lz);
      });
      // 台灯
      const tlBase = cyl(0.06, 0.07, 0.05, 12, Mat.lampBody(), 'ns_lamp_base');
      tlBase.position.y = 0.5;
      ns.add(tlBase);
      const tlShade = cyl(0.05, 0.09, 0.13, 12, Mat.lampBulb(), 'ns_lamp_shade');
      tlShade.position.y = 0.56;
      ns.add(tlShade);

      ns.position.set(-1.1, 0.005, 1.45);
      this.modelRoot.add(ns);
      this.allMeshes.push(reg(ns, 'nightstand'));
    }

    // ═══════════════════════════════════════════════
    // 卧室：风扇（天花板）
    // ═══════════════════════════════════════════════
    {
      const fg = new THREE.Group();
      fg.name = 'procedural_fan_group';

      fg.add(cyl(0.03, 0.03, 0.35, 8, Mat.fanHub(), 'fan_rod'));
      fg.children[0].position.y = 0.175;

      const hub = cyl(0.1, 0.1, 0.08, 16, Mat.fanHub(), 'fan_hub');
      hub.position.y = 0;
      fg.add(hub);

      for (let i = 0; i < 3; i++) {
        const bg = new THREE.BoxGeometry(0.5, 0.04, 0.13);
        bg.translate(0.18, 0, 0);
        const blade = new THREE.Mesh(bg, Mat.fanBlade());
        blade.rotation.y = (i / 3) * Math.PI * 2;
        blade.name = 'fan_blade_' + i;
        blade.castShadow = true;
        fg.add(blade);
      }

      fg.position.set(-1.0, H - 0.35, 0.0);
      this.modelRoot.add(fg);
      const entry = reg(fg, 'procedural_fan');
      this.allMeshes.push(entry);
      this.fanTarget = entry;
    }

    // ═══════════════════════════════════════════════
    // 客厅：餐桌 + 两把椅子
    // ═══════════════════════════════════════════════
    {
      const tg = new THREE.Group();
      tg.name = 'table_group';
      // 桌面
      const top = box(1.0, 0.04, 0.65, Mat.table(), 'table_top');
      top.position.y = 0.74;
      tg.add(top);
      this.allMeshes.push(reg(top, 'table_top'));
      // 腿
      [[-0.43, 0.37, -0.26], [0.43, 0.37, -0.26], [-0.43, 0.37, 0.26], [0.43, 0.37, 0.26]].forEach(([lx, ly, lz]) => {
        tg.add(cyl(0.035, 0.035, 0.74, 8, Mat.chairWood(), 'table_leg'));
        tg.children[tg.children.length - 1].position.set(lx, ly, lz);
      });
      tg.position.set(1.05, 0, 0.85);
      this.modelRoot.add(tg);
    }

    // 客厅椅子 ×2
    for (let ci = 0; ci < 2; ci++) {
      const cg = new THREE.Group();
      cg.name = 'chair_' + ci;
      // 座面
      cg.add(box(0.38, 0.03, 0.38, Mat.chairWood(), 'seat'));
      cg.children[0].position.y = 0.44;
      // 腿
      [[-0.15, 0.22, -0.15], [0.15, 0.22, -0.15], [-0.15, 0.22, 0.15], [0.15, 0.22, 0.15]].forEach(([lx, ly, lz]) => {
        cg.add(cyl(0.025, 0.025, 0.44, 8, Mat.chairWood(), 'leg'));
        cg.children[cg.children.length - 1].position.set(lx, ly, lz);
      });
      // 靠背
      cg.add(box(0.35, 0.32, 0.03, Mat.chairWood(), 'back'));
      cg.children[cg.children.length - 1].position.set(0, 0.62, -0.17);

      const cz = 1.2;
      cg.position.set(ci === 0 ? 0.55 : 1.55, 0, cz);
      cg.rotation.y = (ci === 0) ? Math.PI - 0.4 : Math.PI + 0.4;
      this.modelRoot.add(cg);
    }

    // ═══════════════════════════════════════════════
    // 客厅：天花板灯
    // ═══════════════════════════════════════════════
    {
      const lg = new THREE.Group();
      lg.name = 'procedural_lamp_group';
      lg.add(cyl(0.18, 0.2, 0.08, 24, Mat.lampBody(), 'lamp_base'));
      lg.children[0].position.y = 0;

      const shade = cyl(0.22, 0.28, 0.22, 24, Mat.lampBulb(), 'lamp_shade');
      shade.position.y = -0.12; shade.castShadow = false;
      lg.add(shade);

      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), Mat.lampBulb());
      bulb.position.y = -0.18; bulb.castShadow = false; bulb.name = 'lamp_bulb';
      lg.add(bulb);

      lg.position.set(1.0, H - 0.1, 0.3);

      // ── 灯泡位置添加点光源，让灯泡真正"发光" ──
      const bulbLight = new THREE.PointLight(0xfff5d0, 0, 12, 1.2);
      bulbLight.position.set(0, -0.18, 0);  // 灯泡球体位置
      bulbLight.castShadow = false;
      bulbLight.name = 'lamp_point_light';
      lg.add(bulbLight);
      this.lampPointLight = bulbLight;

      this.modelRoot.add(lg);
      const entry = reg(lg, 'procedural_lamp');
      this.allMeshes.push(entry);
      this.lampTargets = [entry];
    }

    // ═══════════════════════════════════════════════
    // 踢脚线
    // ═══════════════════════════════════════════════
    {
      const bh = 0.08, bt = 0.02, bm = Mat.baseboard();
      // 后墙、前墙全宽
      [{ z: HD }, { z: -HD }].forEach(({ z }) => {
        const m = box(W, bh, bt, bm, 'baseboard');
        m.position.set(0, bh / 2, z - Math.sign(z) * bt / 2);
        m.receiveShadow = true;
        this.modelRoot.add(m);
        this.allMeshes.push(reg(m, 'baseboard_z' + z));
      });
      // 左墙、右墙全深
      [{ x: -HW }, { x: HW }].forEach(({ x }) => {
        const m = box(bt, bh, D, bm, 'baseboard');
        m.position.set(x + Math.sign(x) * bt / 2, bh / 2, 0);
        m.receiveShadow = true;
        this.modelRoot.add(m);
        this.allMeshes.push(reg(m, 'baseboard_x' + x));
      });
    }

    // ── 加入场景 ──
    this.scene.add(this.modelRoot);
    this.modelRoot.updateMatrixWorld();

    // ── 外壳识别 ──
    {
      let largest = null, largestVol = 0;
      this.allMeshes.forEach(item => {
        if (item.bbox && item.bbox.volume > largestVol && item.name.includes('wall_')) {
          largestVol = item.bbox.volume; largest = item;
        }
      });
      this.shellTarget = largest;
      this._wallMeshes = this.allMeshes.filter(item => item.name.startsWith('wall_'));
      console.log('[Room3D] 外墙 mesh:', largest?.name, '体积:', largestVol.toFixed(1), '墙面总数:', this._wallMeshes.length);
    }

    // 默认墙壁半透明
    this._setShellOpacity(0.25);

    // 调整视角到房间中心
    const fullBox = new THREE.Box3().setFromObject(this.modelRoot);
    const center = fullBox.getCenter(new THREE.Vector3());
    this.controls.target.set(center.x, 1.0, center.z);
    this.controls.update();
  },

  // ═══════════════════════════════════════════════
  _setShellOpacity(opacity) {
    const targets = this._wallMeshes || (this.shellTarget ? [this.shellTarget] : []);
    targets.forEach(item => {
      const mat = item.node.material;
      if (!mat) return;
      const mats = Array.isArray(mat) ? mat : [mat];
      mats.forEach(m => {
        m.transparent = true; m.opacity = opacity;
        m.depthWrite = opacity > 0.8; m.needsUpdate = true;
      });
    });
  },

  toggleShell() {
    if (!this.shellTarget) return 'none';
    const mat = this.shellTarget.node.material;
    if (!mat) return 'none';
    const m = Array.isArray(mat) ? mat[0] : mat;
    const cur = m.opacity ?? 1;
    if (cur < 0.3)      { this._setShellOpacity(1.0);  console.log('[Room3D] 墙壁 → 不透明'); return 'opaque'; }
    else if (cur < 0.9) { this._setShellOpacity(0.08); console.log('[Room3D] 墙壁 → 全透明'); return 'hidden'; }
    else                { this._setShellOpacity(0.25); console.log('[Room3D] 墙壁 → 半透明'); return 'semi'; }
  },

  toggleXRay() {
    const targets = this._wallMeshes || (this.shellTarget ? [this.shellTarget] : []);
    if (this._xrayActive) {
      targets.forEach(item => {
        const mat = item.node.material;
        if (!mat) return;
        (Array.isArray(mat) ? mat : [mat]).forEach(m => {
          if (m._xrayOriginal) {
            m.opacity = m._xrayOriginal.opacity;
            m.transparent = m._xrayOriginal.transparent;
            m.depthWrite = m._xrayOriginal.depthWrite;
            m.needsUpdate = true;
            delete m._xrayOriginal;
          }
        });
      });
      this._xrayActive = false;
      console.log('[Room3D] X光 → 关闭');
      return false;
    }
    targets.forEach(item => {
      const mat = item.node.material;
      if (!mat) return;
      (Array.isArray(mat) ? mat : [mat]).forEach(m => {
        if (!m._xrayOriginal) m._xrayOriginal = { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
        m.transparent = true; m.opacity = 0.12; m.depthWrite = false; m.needsUpdate = true;
      });
    });
    this._xrayActive = true;
    console.log('[Room3D] X光 → 开启');
    return true;
  },

  toggleCeiling() {
    if (this.ceilingTarget) {
      this.ceilingTarget.node.visible = !this.ceilingTarget.node.visible;
      return this.ceilingTarget.node.visible;
    }
    return null;
  },

  // ═══════════════════════════════════════════════
  _setupRaycaster() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    this.renderer.domElement.addEventListener('click', (event) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      const targets = this.allMeshes.map(m => m.node).filter(Boolean);
      raycaster.setFromCamera(mouse, this.camera);
      const intersects = raycaster.intersectObjects(targets, true);
      if (intersects.length > 0) {
        let obj = intersects[0].object;
        let foundItem = null;
        while (obj && !foundItem) { foundItem = this.allMeshes.find(m => m.node === obj); obj = obj.parent; }
        if (foundItem && foundItem.bbox) {
          console.log(`%c[Room3D] 点击 %c${foundItem.name}%c 宽=${foundItem.bbox.sx.toFixed(2)} 高=${foundItem.bbox.sy.toFixed(2)} 深=${foundItem.bbox.sz.toFixed(2)} 中心Y=${foundItem.bbox.cy.toFixed(2)}`, 'color:#ffd166', 'font-weight:bold', '');
          this._flashHighlight(intersects[0].object);
        }
      }
    });
  },

  _flashHighlight(obj) {
    if (!obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const orig = mats.map(m => m.emissive ? m.emissive.getHex() : 0);
    mats.forEach(m => { if (m.emissive) m.emissive.set(0x444444); });
    setTimeout(() => { mats.forEach((m, i) => { if (m.emissive) m.emissive.setHex(orig[i] || 0); }); }, 400);
  },

  _printMeshGuide() {
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color:#ffd166');
    console.log('%c[Room3D] 🏠 两室户型', 'color:#62c370');
    console.log(`  入户门: ${this.doorTargets?.length ? this.doorTargets.map(d => `#${d.meshIndex} ${d.name}`).join(',') : '无'}`);
    console.log(`  窗户:   ${this.windowTargets?.length ? this.windowTargets.map(w => `#${w.meshIndex} ${w.name}`).join(',') : '无'}`);
    console.log(`  灯:     ${this.lampTargets?.length ? this.lampTargets.map(l => `#${l.meshIndex} ${l.name}`).join(',') : '无'}`);
    console.log(`  风扇:   ${this.fanTarget ? `#${this.fanTarget.meshIndex} ${this.fanTarget.name} (卧室)` : '无'}`);
    console.log(`  天花板: ${this.ceilingTarget ? `#${this.ceilingTarget.meshIndex} ${this.ceilingTarget.name}` : '无'}`);
    console.log(`  墙面:   ${this._wallMeshes?.length || 0} 块`);
    console.log('%c  G切换墙壁 · X X光 · R重置 · WASD移动', 'color:#888');
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color:#ffd166');
  },

  // ═══════════════════════════════════════════════
  // 公开 API（与旧版完全兼容）
  // ═══════════════════════════════════════════════
  updateDoor(open) {
    const changed = this.doorOpen !== open;
    this.doorOpen = open;
    if (!this.doorTarget) return;
    if (this.doorTarget._initialRot === undefined) this.doorTarget._initialRot = this.doorTarget.node.rotation.y;
    console.log(`[Room3D] 入户门 → ${open ? '打开' : '关闭'}`);
    if (changed) this.focusOn('door');
  },

  updateLight(brightness) {
    this.lightOn = brightness > 0;
    const intensity = brightness / 100;  // 0.0 ~ 1.0

    // ── 灯泡材质：高亮发光，亮度越高越白热 ──
    this.lampTargets.forEach(item => {
      item.node.traverse(child => {
        if (child.isMesh && child.material.emissive) {
          const warmColor = new THREE.Color(1.0, 0.82, 0.35);
          const hotColor  = new THREE.Color(1.0, 0.95, 0.7);
          child.material.emissive.copy(warmColor.lerp(hotColor, intensity))
            .multiplyScalar(this.lightOn ? intensity * 6 : 0);
          child.material.emissiveIntensity = this.lightOn ? intensity * 5 : 0;
        }
      });
    });

    // ── 灯泡点光源：从灯罩内向外辐射 ──
    if (this.lampPointLight) {
      this.lampPointLight.intensity = this.lightOn ? intensity * 25 : 0;
    }

    // ── 环境光：关灯暗、开灯亮，大幅摆动 ──
    const ambient = this.scene.children.find(c => c.isAmbientLight);
    if (ambient) ambient.intensity = 0.2 + intensity * 2.5;

    // ── 太阳光：开灯时略微压暗，突出室内灯光氛围 ──
    if (this.sunLight) {
      this.sunLight.intensity = 3.0 - intensity * 1.2;
    }
  },

  updateFan(on) {
    const changed = this.fanOn !== on;
    this.fanOn = on;
    if (!this.fanTarget) return;
    console.log(`[Room3D] 风扇(卧室) → ${on ? '开启' : '关闭'}`);
    if (changed) this.focusOn('fan');
  },

  updateWindow(open) {
    if (!this.windowTarget) return;
    const isOpen = open === 'open' || open === true;
    if (this.windowTarget._initialY === undefined) this.windowTarget._initialY = this.windowTarget.node.position.y;
    console.log(`[Room3D] 卧室窗户 → ${isOpen ? '打开' : '关闭'}`);
    this.windowOpen = isOpen;
  },

  // ═══════════════════════════════════════════════
  // 视角聚焦：检测到门/风扇信号时，自动将镜头转向对应设备
  // ═══════════════════════════════════════════════
  focusOn(targetName) {
    if (!this.ready || !this.controls) return;
    let toPos, toTarget;

    if (targetName === 'door') {
      // 入户门中心约 (1.03, 1.06, -1.675)，从室内正前方观看（拉远）
      toPos = new THREE.Vector3(1.03, 2.2, 1.6);
      toTarget = new THREE.Vector3(1.03, 1.06, -1.67);
    } else if (targetName === 'fan') {
      // 卧室风扇位于 (-1.0, 2.25, 0.0)，从下方仰视（拉远）
      toPos = new THREE.Vector3(-1.0, 0.6, 2.0);
      toTarget = new THREE.Vector3(-1.0, 2.25, 0.0);
    } else {
      return;
    }

    this._focusAnim = {
      fromPos: this.camera.position.clone(),
      toPos: toPos,
      fromTarget: this.controls.target.clone(),
      toTarget: toTarget,
      startTime: performance.now(),
      duration: 1200,
    };
    this.controls.enableDamping = false;
    this.controls.enabled = false;
    console.log(`[Room3D] 📷 视角转移 → ${targetName}`);
  },

  // ═══════════════════════════════════════════════
  _setupKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (!this.renderer || !this.renderer.domElement.isConnected) return;
      const step = 0.3;
      const t = this.controls.target;
      switch (e.key.toLowerCase()) {
        case 'w': t.y += step; break;
        case 's': t.y -= step; break;
        case 'a': t.x -= step; break;
        case 'd': t.x += step; break;
        case 'r': this.camera.position.set(3.2, 3.8, 4.5); t.set(0, 1.0, 0); break;
        case 'g': this.toggleShell(); break;
        case 'f': this.camera.position.set(0, 1.6, 4.2); t.set(0, 1.2, -0.3); break;
        case 't': this.camera.position.set(0, 7, 0); t.set(0, 1.0, 0); break;
        case 'x': this.toggleXRay(); break;
      }
      this.controls.update();
    });
  },

  _onResize(container) {
    const rect = container.getBoundingClientRect();
    this.camera.aspect = rect.width / Math.max(1, rect.height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(rect.width, rect.height);
  },

  // ═══════════════════════════════════════════════
  _animate() {
    requestAnimationFrame(() => this._animate());
    this.controls.update();

    // ── 视角聚焦动画：平滑移动镜头到目标设备 ──
    if (this._focusAnim) {
      const f = this._focusAnim;
      const elapsed = performance.now() - f.startTime;
      let t = Math.min(elapsed / f.duration, 1.0);
      t = 1 - Math.pow(1 - t, 3);  // easeOutCubic

      this.camera.position.lerpVectors(f.fromPos, f.toPos, t);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, t);
      this.controls.update();

      if (elapsed >= f.duration) {
        this._focusAnim = null;
        this.controls.enableDamping = true;
        this.controls.enabled = true;
      }
    }

    // 门：绕 Y 轴旋转
    if (this.doorTarget) {
      const target = this.doorOpen ? -Math.PI / 2 : 0;
      const init = this.doorTarget._initialRot ?? 0;
      const cur = this.doorTarget.node.rotation.y;
      const diff = target - (cur - init);
      if (Math.abs(diff) > 0.003) this.doorTarget.node.rotation.y = cur + diff * 0.12;
    }
    // 风扇：绕 Y 轴旋转
    if (this.fanTarget && this.fanOn) this.fanTarget.node.rotation.y += 0.10;
    // 卧室窗户：沿 Y 轴平移
    if (this.windowTarget) {
      const init = this.windowTarget._initialY ?? 0;
      const target = this.windowOpen ? init + 0.3 : init;
      const diff = target - this.windowTarget.node.position.y;
      if (Math.abs(diff) > 0.001) this.windowTarget.node.position.y += diff * 0.10;
    }

    this.renderer.render(this.scene, this.camera);
  },
};

window.Room3D = Room3D;
window.dispatchEvent(new CustomEvent('room3d-module-ready', { detail: Room3D }));
console.log('[Room3D] 两室户型模块就绪');
export default Room3D;
