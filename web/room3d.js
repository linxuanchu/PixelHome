/**
 * Pixel Home 3D Room Viewer
 * 使用 Three.js 渲染 SketchUp 公寓模型，并与智能家居系统联动
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const Room3D = {
  // ── 公开状态 ──
  ready: false,
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  modelRoot: null,

  // ── 已识别的 mesh 引用 ──
  allMeshes: [],        // { node, meshIndex, bbox, worldPos, name }
  doorTarget: null,     // 候选门 mesh（主门）
  doorTargets: [],      // 所有门 mesh 列表
  windowTarget: null,   // 候选窗户 mesh
  windowOpen: false,    // 窗户开关状态
  windowTargets: [],    // 所有窗户 mesh 列表
  lampTargets: [],      // 候选灯具 mesh 列表
  ceilingTarget: null,  // 候选天花板
  fanTarget: null,      // 候选风扇 mesh
  shellTarget: null,    // 房间外壳

  // ── 动画状态 ──
  doorOpen: false,
  doorAngle: 0,
  lightOn: false,
  fanOn: false,
  fanAngle: 0,

  /**
   * 初始化 3D 场景
   * @param {string} containerSelector 容器元素选择器
   */
  async init(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) {
      console.error('[Room3D] 容器未找到:', containerSelector);
      return;
    }

    // ── 场景 ──
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fd3e8); // 匹配 CSS --sky
    this.scene.fog = new THREE.Fog(0x8fd3e8, 8, 25);

    // ── 相机（Sketchfab 风格 3/4 俯视）──
    const rect = container.getBoundingClientRect();
    const w = rect.width || container.clientWidth || 640;
    const h = rect.height || container.clientHeight || 380;
    console.log('[Room3D] 容器尺寸:', w, 'x', h);
    this.camera = new THREE.PerspectiveCamera(50, w / Math.max(1, h), 0.05, 50);
    this.camera.position.set(3.2, 3.8, 4.5);   // 右上方 3/4 视角
    this.camera.lookAt(0, 0.8, -0.5);            // 俯瞰房间中心

    // ── 渲染器 ──
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.innerHTML = '';  // 清除 "加载中" 文字
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'room3dCanvas';

    // ── Orbit 控制器 ──
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.8, -0.5);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 10;
    this.controls.maxPolarAngle = Math.PI * 0.85;
    this.controls.update();

    // ── 灯光 ──
    this._setupLights();

    // ── 地面参考网格（加载失败时的兜底） ──
    const grid = new THREE.GridHelper(6, 20, 0xcccccc, 0xe0e0e0);
    grid.position.y = -1.5;
    this.scene.add(grid);

    // ── 加载模型 ──
    try {
      await this._loadModel('/small_apartment_morning_version.glb');
      this.ready = true;
      console.log('[Room3D] 模型加载完成，共发现', this.allMeshes.length, '个独立 mesh');
      this._printMeshGuide();
    } catch (err) {
      console.warn('[Room3D] 模型加载失败，使用占位场景:', err.message);
      this._buildFallbackScene();
    }

    // ── 点击识别 ──
    this._setupRaycaster();

    // ── 键盘快捷键 ──
    this._setupKeyboard();

    // ── 响应式 ──
    window.addEventListener('resize', () => this._onResize(container));

    // ── 渲染循环 ──
    this._animate();
  },

  /** 设置光照（模拟早晨氛围）+ 生成环境贴图 */
  _setupLights() {
    // 环境光 — 基础照明（提高亮度确保模型可见）
    const ambient = new THREE.AmbientLight(0xfff5e8, 1.2);
    this.scene.add(ambient);

    // 半球光 — 天空/地面模拟
    const hemi = new THREE.HemisphereLight(0x8fd3e8, 0x6b8c5c, 0.8);
    this.scene.add(hemi);

    // 平行光 — 模拟早晨阳光
    this.sunLight = new THREE.DirectionalLight(0xfff8e7, 3.5);
    this.sunLight.position.set(8, 10, 2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 50;
    this.sunLight.shadow.camera.left = -8;
    this.sunLight.shadow.camera.right = 8;
    this.sunLight.shadow.camera.top = 8;
    this.sunLight.shadow.camera.bottom = -2;
    this.sunLight.shadow.bias = -0.0001;
    this.scene.add(this.sunLight);

    // ── 生成简易环境贴图（解决 PBR 材质纯黑问题）──
    this._buildEnvMap();
  },

  /** 用 PMREMGenerator 生成环境贴图，避免金属/粗糙材质变黑 */
  _buildEnvMap() {
    // 使用 scene 的 renderer 生成环境贴图
    if (!this.renderer) return;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    // 早晨暖色调渐变
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, '#c9e4f2');  // 淡蓝天空
    grad.addColorStop(0.45, '#fff3dc'); // 暖黄地平线（早晨阳光）
    grad.addColorStop(0.7, '#e8d5b0');  // 暖灰墙面
    grad.addColorStop(1, '#c4b89a');    // 地板色
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const envMap = pmrem.fromEquirectangular(tex);
    this.scene.environment = envMap;
    this.scene.background = new THREE.Color(0xdce8f0);
    tex.dispose();
    pmrem.dispose();
  },

  /** 加载 GLB 模型 */
  async _loadModel(url) {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url, (progress) => {
      const pct = Math.round((progress.loaded / progress.total) * 100);
      console.log(`[Room3D] 加载中... ${pct}%`);
    });

    this.modelRoot = gltf.scene;

    // ── 计算包围盒并居中 ──
    const box = new THREE.Box3().setFromObject(this.modelRoot);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    console.log(`[Room3D] 原始包围盒: 中心(${center.x.toFixed(1)}, ${center.y.toFixed(1)}, ${center.z.toFixed(1)}) 尺寸(${size.x.toFixed(1)}, ${size.y.toFixed(1)}, ${size.z.toFixed(1)})`);

    // 缩放到合理大小（目标：宽约 4 单位）
    const targetWidth = 4.2;
    const scale = targetWidth / size.x;
    this.modelRoot.scale.setScalar(scale);
    this.modelRoot.position.set(
      -center.x * scale,
      -center.y * scale,
      -center.z * scale
    );

    // ── 修复材质 + 收集 mesh ──
    this.modelRoot.updateMatrixWorld();
    this.modelRoot.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;

        // 修复 PBR 材质：强制 metallic=0 避免无环境贴图时变黑
        const mat = node.material;
        if (mat) {
          const materials = Array.isArray(mat) ? mat : [mat];
          materials.forEach(m => {
            if (m.isMeshStandardMaterial) {
              // glTF 导出的材质如果 metallic 未定义默认 1，这在没有 IBL 时就是黑的
              if (m.metalness === undefined || m.metalness > 0.8) {
                m.metalness = 0.05;
              }
              if (m.roughness === undefined || m.roughness < 0.1) {
                m.roughness = 0.6;
              }
              // 确保颜色不是全黑
              if (m.color && m.color.getHex() === 0x000000 && !m.map) {
                m.color.set(0xcccccc);
              }
              m.needsUpdate = true;
            }
          });
        }

        this.allMeshes.push({
          node,
          meshIndex: this.allMeshes.length,
          name: node.name || `mesh_${this.allMeshes.length}`,
        });
      }
    });

    console.log(`[Room3D] 共 ${this.allMeshes.length} 个 mesh，材质已修复`);

    this.scene.add(this.modelRoot);

    // ── 自动识别 ──
    this.modelRoot.updateMatrixWorld();
    this._autoIdentify();

    // ── 识别房间外壳（最大的 mesh），默认半透明 ──
    this._identifyShell();

    // 调整 OrbitControls 目标到房间内部
    this.controls.target.set(0, 0.8, -0.5);
    this.controls.update();
  },

  /** 找出覆盖全场景的最大 mesh → 房间外壳，默认半透明 */
  _identifyShell() {
    if (this.allMeshes.length === 0) return;
    // 找到体积最大的 mesh
    let largest = this.allMeshes[0];
    let largestVol = 0;
    this.allMeshes.forEach(item => {
      if (item.bbox && item.bbox.volume > largestVol) {
        largestVol = item.bbox.volume;
        largest = item;
      }
    });
    this.shellTarget = largest;
    console.log(`[Room3D] 房间外壳: Mesh #${largest.meshIndex} '${largest.name}' 体积=${largestVol.toFixed(1)}`);

    // 默认半透明（展示内部家具）
    this._setShellOpacity(0.25);
  },

  /** 设置房间外壳透明度 */
  _setShellOpacity(opacity) {
    if (!this.shellTarget) return;
    const mat = this.shellTarget.node.material;
    if (!mat) return;
    const materials = Array.isArray(mat) ? mat : [mat];
    materials.forEach(m => {
      m.transparent = true;
      m.opacity = opacity;
      m.depthWrite = opacity > 0.8;
      m.needsUpdate = true;
    });
  },

  /** 切换房间外壳：全透明 → 半透明 → 不透明 */
  toggleShell() {
    if (!this.shellTarget) {
      console.log('[Room3D] 未找到房间外壳');
      return 'none';
    }
    const mat = this.shellTarget.node.material;
    if (!mat) return 'none';
    const m = Array.isArray(mat) ? mat[0] : mat;
    const current = m.opacity ?? 1;
    if (current < 0.3) {
      this._setShellOpacity(1.0);
      console.log('[Room3D] 墙壁 → 不透明');
      return 'opaque';
    } else if (current < 0.9) {
      this._setShellOpacity(0.08);
      console.log('[Room3D] 墙壁 → 全透明（仅家具可见）');
      return 'hidden';
    } else {
      this._setShellOpacity(0.25);
      console.log('[Room3D] 墙壁 → 半透明');
      return 'semi';
    }
  },

  /** 自动识别门/窗/灯 — 优先按 mesh 名称匹配，其次用几何启发式 */
  _autoIdentify() {
    const candidates = { door: [], window: [], lamp: [], ceiling: [], fan: [] };

    console.log('[Room3D] ── 网格识别（名称优先 + 几何兜底）──');

    this.allMeshes.forEach((item, idx) => {
      const geo = item.node.geometry;
      if (!geo) return;
      if (!geo.boundingBox) geo.computeBoundingBox();

      const bbox = geo.boundingBox.clone();
      bbox.applyMatrix4(item.node.matrixWorld);

      const sx = bbox.max.x - bbox.min.x;
      const sy = bbox.max.y - bbox.min.y;
      const sz = bbox.max.z - bbox.min.z;
      const cy = (bbox.min.y + bbox.max.y) / 2;
      const volume = sx * sy * sz;

      item.bbox = { sx, sy, sz, cy, volume, min: bbox.min.clone(), max: bbox.max.clone() };

      // ── 第一步：按名称关键词匹配（优先级最高）──
      const nameLower = item.name.toLowerCase();

      if (nameLower.includes('door') || nameLower.includes('门')) {
        candidates.door.push(idx);
      }
      if (nameLower.includes('window') || nameLower.includes('窗')) {
        candidates.window.push(idx);
      }
      if (nameLower.includes('lamp') || nameLower.includes('light') || nameLower.includes('灯')) {
        candidates.lamp.push(idx);
      }
      if (nameLower.includes('ceiling') || nameLower.includes('天花')) {
        candidates.ceiling.push(idx);
      }
      if (nameLower.includes('fan') || nameLower.includes('风扇')) {
        candidates.fan.push(idx);
      }

      // ── 第二步：几何启发式（仅当名字没匹配到时作为兜底）──
      const matchedByName = ['door', 'window', 'lamp', 'ceiling', 'fan'].some(
        cat => candidates[cat].includes(idx)
      );

      if (!matchedByName) {
        console.log(`  Mesh #${idx} '${item.name}': ${sx.toFixed(2)}x${sy.toFixed(2)}x${sz.toFixed(2)}m 中心Y=${cy.toFixed(2)}m 体积=${volume.toFixed(3)} [无关键词匹配，使用启发式]`);

        const aspectH = sy / Math.max(sx, 0.01);
        const thin = Math.min(sx, sy, sz);
        // 门：扁平 + 高 > 宽*1.5 + 薄 + 靠近地面
        if (aspectH > 1.8 && thin < 0.3 && cy < 1.8 && sx > 0.2) {
          candidates.door.push(idx);
        }
        // 窗户：扁平 + 有一定大小 + 位置中上 + 薄
        if (sx > 0.15 && sx < 3 && sy > 0.15 && sy < 3 && thin < 0.15 && cy > 0.5) {
          candidates.window.push(idx);
        }
        // 灯具：小体积 + 位置偏高
        if (volume < 0.3 && cy > 1.6 && sx < 1.5 && sy < 1.0) {
          candidates.lamp.push(idx);
        }
        // 天花板：宽大扁平 + 位置最高
        if (sx > 2 && sz > 1 && sy < 0.5 && cy > 2.0) {
          candidates.ceiling.push(idx);
        }
      } else {
        console.log(`  Mesh #${idx} '%c${item.name}%c': ${sx.toFixed(2)}x${sy.toFixed(2)}x${sz.toFixed(2)}m [✅ 名称匹配]`, 'color:#62c370', '');
      }
    });

    // ── 分配识别结果 ──
    this.doorTargets = [];  // 支持多扇门
    if (candidates.door.length) {
      this.doorTarget = this.allMeshes[candidates.door[0]];   // 默认主门
      this.doorTargets = candidates.door.map(i => this.allMeshes[i]);
    }
    if (candidates.window.length) {
      this.windowTarget = this.allMeshes[candidates.window[0]];
      this.windowTargets = candidates.window.map(i => this.allMeshes[i]);
    }
    if (candidates.ceiling.length) {
      this.ceilingTarget = this.allMeshes[candidates.ceiling[0]];
      this.ceilingTarget.node.visible = false;  // 默认隐藏天花板
    }
    if (candidates.fan.length) {
      this.fanTarget = this.allMeshes[candidates.fan[0]];     // 风扇
    }
    this.lampTargets = candidates.lamp.map(i => this.allMeshes[i]);

    console.log(`[Room3D] 识别结果: 门=${candidates.door.map(i => this.allMeshes[i].name).join(',') || '无'} 窗=${candidates.window.map(i => this.allMeshes[i].name).join(',') || '无'} 灯=${candidates.lamp.map(i => this.allMeshes[i].name).join(',') || '无'} 风扇=${candidates.fan.map(i => this.allMeshes[i].name).join(',') || '无'} 天花板=${candidates.ceiling.map(i => this.allMeshes[i].name).join(',') || '无'}`);
  },

  /** 构建简易占位场景（模型加载失败时） */
  _buildFallbackScene() {
    // 地板
    const floorGeo = new THREE.PlaneGeometry(4, 3);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xd4a574, roughness: 0.8 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.5, 1.2);
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 四面墙壁
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xfff8e7, roughness: 0.9 });
    const walls = [
      { w: 4, h: 2.6, x: 0, y: 0.8, z: -0.3, ry: 0 },           // 前墙
      { w: 3, h: 2.6, x: 0, y: 0.8, z: 2.7, ry: 0 },             // 后墙
      { w: 3, h: 2.6, x: -2, y: 0.8, z: 1.2, ry: Math.PI / 2 }, // 左墙
      { w: 3, h: 2.6, x: 2, y: 0.8, z: 1.2, ry: -Math.PI / 2 }, // 右墙
    ];
    walls.forEach(w => {
      const geo = new THREE.PlaneGeometry(w.w, w.h);
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.position.set(w.x, w.y, w.z);
      mesh.rotation.y = w.ry;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.scene.add(mesh);
    });

    // 简易灯球
    const lampGeo = new THREE.SphereGeometry(0.15, 16, 16);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0x000000, roughness: 0.3 });
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(0, 2.2, 1.2);
    lamp.userData.isLamp = true;
    lamp.userData.lampMaterial = lampMat;
    this.scene.add(lamp);
    this.lampTargets = [{ node: lamp, meshIndex: -1, name: 'fallback_lamp' }];
  },

  /** 点击 mesh 打印识别信息 */
  _setupRaycaster() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    this.renderer.domElement.addEventListener('click', (event) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, this.camera);
      const intersects = raycaster.intersectObjects(this.allMeshes.map(m => m.node), false);

      if (intersects.length > 0) {
        const obj = intersects[0].object;
        const item = this.allMeshes.find(m => m.node === obj);
        if (item && item.bbox) {
          console.log(
            `%c[Room3D] 点击 Mesh #${item.meshIndex} '%c${item.name}%c' ` +
            `宽=${item.bbox.sx.toFixed(2)}m 高=${item.bbox.sy.toFixed(2)}m 深=${item.bbox.sz.toFixed(2)}m ` +
            `中心Y=${item.bbox.cy.toFixed(2)}m`,
            'color:#ffd166', 'font-weight:bold', ''
          );
          // 高亮闪烁
          this._flashHighlight(obj);
        }
      }
    });
  },

  /** 高亮闪烁一个 mesh */
  _flashHighlight(obj) {
    if (!obj.material) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    const originalColors = materials.map(m => m.emissive ? m.emissive.getHex() : 0);

    materials.forEach(m => {
      if (m.emissive) m.emissive.set(0x444444);
    });

    setTimeout(() => {
      materials.forEach((m, i) => {
        if (m.emissive) m.emissive.setHex(originalColors[i] || 0);
      });
    }, 400);
  },

  /** 打印 mesh 识别指南 */
  _printMeshGuide() {
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color:#ffd166');
    console.log('%c[Room3D] 🏠 智能家居 mesh 识别结果', 'color:#62c370');
    console.log(`  门: ${this.doorTargets?.length ? this.doorTargets.map(d => `#${d.meshIndex} ${d.name}`).join(', ') : '未识别 — 请在 Blender 中命名包含 "door"'}`);
    console.log(`  窗: ${this.windowTargets?.length ? this.windowTargets.map(w => `#${w.meshIndex} ${w.name}`).join(', ') : '未识别 — 请在 Blender 中命名包含 "window"'}`);
    console.log(`  灯: ${this.lampTargets.length ? this.lampTargets.map(l => `#${l.meshIndex} ${l.name}`).join(', ') : '未识别 — 请在 Blender 中命名包含 "lamp" 或 "light"'}`);
    console.log(`  风扇: ${this.fanTarget ? `#${this.fanTarget.meshIndex} ${this.fanTarget.name}` : '未识别 — 请在 Blender 中命名包含 "fan"'}`);
    console.log(`  天花板: ${this.ceilingTarget ? `#${this.ceilingTarget.meshIndex} ${this.ceilingTarget.name} (已隐藏)` : '未识别'}`);
    console.log('%c  点击控制台显示的 mesh 编号可查看尺寸', 'color:#888');
    console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color:#ffd166');
  },

  // ═══════════════════════════════════════════
  // 公开 API — 给 app.js 调用
  // ═══════════════════════════════════════════

  /** 控制门（绕 Z 轴旋转，模拟开门） */
  updateDoor(open) {
    this.doorOpen = open;
    if (!this.doorTarget) {
      console.log('[Room3D] 门未识别，无法动画。请在 Blender 中命名门 mesh 包含 "door" 关键词。');
      return;
    }
    // 记录初始旋转（首次调用时）
    if (this.doorTarget._initialRot === undefined) {
      this.doorTarget._initialRot = this.doorTarget.node.rotation.z;
    }
    console.log(`[Room3D] 门 '${this.doorTarget.name}' → ${open ? '打开' : '关闭'}`);
  },

  /** 控制灯光 */
  updateLight(brightness) {
    this.lightOn = brightness > 10;
    const intensity = Math.max(0.1, brightness / 100);

    this.lampTargets.forEach(item => {
      const mat = item.node.material;
      if (!mat) return;
      const materials = Array.isArray(mat) ? mat : [mat];
      materials.forEach(m => {
        if (m.emissive) {
          m.emissive.set(this.lightOn ? new THREE.Color(1.0, 0.88, 0.45).multiplyScalar(intensity * 2) : new THREE.Color(0x000000));
        }
      });
    });

    // 调整场景环境光模拟室内灯光
    const ambient = this.scene.children.find(c => c.isAmbientLight);
    if (ambient) {
      ambient.intensity = 0.7 + (this.lightOn ? intensity * 0.6 : 0);
    }
  },

  /** 控制风扇（绕 Y 轴旋转扇叶） */
  updateFan(on) {
    this.fanOn = on;
    if (!this.fanTarget) {
      console.log('[Room3D] 风扇未识别，无法动画。请在 Blender 中命名风扇 mesh 包含 "fan" 关键词。');
      return;
    }
    console.log(`[Room3D] 风扇 '${this.fanTarget.name}' → ${on ? '开启' : '关闭'}`);
  },

  /** 控制窗户（沿 Y 轴平移，模拟开窗） */
  updateWindow(open) {
    if (!this.windowTarget) {
      console.log('[Room3D] 窗户未识别。请在 Blender 中命名窗户 mesh 包含 "window" 关键词。');
      return;
    }
    const isOpen = open === 'open' || open === true;
    // 记录初始位置（首次调用时）
    if (this.windowTarget._initialY === undefined) {
      this.windowTarget._initialY = this.windowTarget.node.position.y;
    }
    console.log(`[Room3D] 窗户 '${this.windowTarget.name}' → ${isOpen ? '打开' : '关闭'}`);
    this.windowOpen = isOpen;
  },

  /** 切换天花板可见性 */
  toggleCeiling() {
    if (this.ceilingTarget) {
      this.ceilingTarget.node.visible = !this.ceilingTarget.node.visible;
      return this.ceilingTarget.node.visible;
    }
    return null;
  },

  /** 切换外墙/外壳透明模式 */
  toggleXRay() {
    if (this._xrayActive) {
      this._restoreOuterMaterials();
      console.log('[Room3D] X光模式 → 关闭');
      return false;
    }
    this._makeOuterTransparent();
    console.log('[Room3D] X光模式 → 开启（外墙半透明）');
    return true;
  },

  /** 识别并半透明化外壳 mesh（包围盒接近全场景的即为外墙） */
  _makeOuterTransparent() {
    if (!this.modelRoot) return;
    this._xrayActive = true;
    this._xrayOriginals = [];

    // 计算模型总包围盒
    const fullBox = new THREE.Box3().setFromObject(this.modelRoot);
    const fullSize = fullBox.getSize(new THREE.Vector3());

    this.modelRoot.traverse((node) => {
      if (!node.isMesh) return;
      // 计算该 mesh 的世界包围盒
      const meshBox = new THREE.Box3().setFromObject(node);
      const meshSize = meshBox.getSize(new THREE.Vector3());

      // 如果 mesh 在任一维度覆盖 >70% 全场景尺寸，判定为外壳
      const coverX = meshSize.x / Math.max(fullSize.x, 0.01);
      const coverY = meshSize.y / Math.max(fullSize.y, 0.01);
      const coverZ = meshSize.z / Math.max(fullSize.z, 0.01);

      if (coverX > 0.7 || coverY > 0.7 || coverZ > 0.7) {
        console.log(`[Room3D] X光: mesh '${node.name}' 覆盖比 X=${coverX.toFixed(1)} Y=${coverY.toFixed(1)} Z=${coverZ.toFixed(1)} → 半透明`);
        const mat = node.material;
        const materials = Array.isArray(mat) ? mat : [mat];
        const saved = { node, materials: [] };

        materials.forEach(m => {
          saved.materials.push({ material: m, opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite });
          // 克隆材质避免影响共享同一材质的其他 mesh
          if (!m._xrayClone) {
            m._xrayClone = m.clone();
          }
          node.material = Array.isArray(mat)
            ? materials.map(orig => orig._xrayClone || orig)
            : (mat._xrayClone || mat);
          const clone = Array.isArray(node.material) ? node.material[0] : node.material;
          clone.transparent = true;
          clone.opacity = 0.15;
          clone.depthWrite = true;
          clone.needsUpdate = true;
        });

        this._xrayOriginals.push(saved);
      }
    });
  },

  /** 恢复外壳材质 */
  _restoreOuterMaterials() {
    this._xrayActive = false;
    if (!this._xrayOriginals) return;
    this._xrayOriginals.forEach(({ node, materials }) => {
      materials.forEach(({ material, opacity, transparent, depthWrite }) => {
        material.opacity = opacity;
        material.transparent = transparent;
        material.depthWrite = depthWrite;
        material.needsUpdate = true;
      });
    });
    this._xrayOriginals = [];
  },

  // ═══════════════════════════════════════════
  // 内部
  // ═══════════════════════════════════════════

  /** 键盘快捷键 */
  _setupKeyboard() {
    window.addEventListener('keydown', (e) => {
      // 只在 3D 模式下响应
      if (!this.renderer || !this.renderer.domElement.isConnected) return;

      const step = 0.3;
      const target = this.controls.target;
      switch (e.key.toLowerCase()) {
        case 'w': target.y += step; break;           // 上移目标
        case 's': target.y -= step; break;           // 下移目标
        case 'a': target.x -= step; break;           // 左移目标
        case 'd': target.x += step; break;           // 右移目标
        case 'r':                                     // 重置视角
          this.camera.position.set(3.2, 3.8, 4.5);
          target.set(0, 0.8, -0.5);
          break;
        case 'g':                                     // 切换墙壁透明度
          this.toggleShell();
          break;
        case 'f':                                     // 前视
          this.camera.position.set(0, 1.5, 4.5);
          target.set(0, 0.8, -1.5);
          break;
        case 't':                                     // 俯视
          this.camera.position.set(0, 7, 0);
          target.set(0, 0.8, -0.5);
          break;
        case 'x':                                     // X光模式
          this.toggleXRay();
          break;
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

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.controls.update();

    // ── 门动画：绕 Z 轴旋转 0 ~ -90° ──
    if (this.doorTarget) {
      const targetAngle = this.doorOpen ? -Math.PI / 2 : 0;
      const initial = this.doorTarget._initialRot ?? 0;
      const current = this.doorTarget.node.rotation.z;
      const diff = targetAngle - (current - initial);
      if (Math.abs(diff) > 0.005) {
        this.doorTarget.node.rotation.z = current + diff * 0.1;
      }
    }

    // ── 风扇动画：绕 Y 轴持续旋转 ──
    if (this.fanTarget && this.fanOn) {
      this.fanTarget.node.rotation.y += 0.08;
    }

    // ── 窗户动画：沿 Y 轴平移 0 ~ -0.3m ──
    if (this.windowTarget) {
      const initY = this.windowTarget._initialY ?? 0;
      const targetY = this.windowOpen ? initY - 0.3 : initY;
      const diff = targetY - this.windowTarget.node.position.y;
      if (Math.abs(diff) > 0.001) {
        this.windowTarget.node.position.y += diff * 0.1;
      }
    }

    this.renderer.render(this.scene, this.camera);
  },
};

// ── 挂载为全局 + 派发就绪事件 ──
window.Room3D = Room3D;
window.dispatchEvent(new CustomEvent('room3d-module-ready', { detail: Room3D }));
console.log('[Room3D] 模块就绪，等待 init() 调用');

export default Room3D;
