/* ============================================================
 * 斯坦福环 Stanford Torus · 1975 概念设计 · 可交互拆解
 * R3 · 生态 · 导览 · 声音 · 导出 · 打磨
 * ------------------------------------------------------------
 * 坐标口径：渲染单位 = 真实米 / 100（1 unit = 100 m）。
 * 重力、弧长、功率一律用真实米算完再缩放。
 * 所有零件按 §6 的 L1–L8 分组注册（REG）。
 * ============================================================ */

/* ── §0 结构定义（契约 §4：三结构逐字段 JSDoc） ────────────── */

/**
 * @typedef {Object} PerfData  perf() 返回；含逐组预算与两种 draw call 口径
 * @property {number} fps              帧率 EMA（0.95/0.05）
 * @property {0|1|2}  tier             画质档：0 低 / 1 中 / 2 高
 * @property {string} tierName         '低'|'中'|'高'
 * @property {number} dpr              当前 renderer 像素比
 * @property {number} sceneDrawCalls   口径一：场景对象计数（Mesh/Points/Sprite），A9 判此
 * @property {number} totalDrawCalls   口径二：renderer.info.render.calls（含后处理与 transmission 通道），只报数
 * @property {number} triangles        每帧提交三角面 Σ(几何三角面×实例数)
 * @property {number} trianglesBudget  120000
 * @property {Array<{key:string,name:string,budgetTris:number,budgetInst:number,tris:number,inst:number,dc:number}>} groups
 * @property {number} fpsTarget        当前档帧率目标（30/45/50）
 */

/**
 * @typedef {Object} State  分享 hash 还原态（第二轮 parseHash 接入，本轮仅锁定字段）
 * @property {number} e      爆炸 0–1
 * @property {number} a      相机方位角
 * @property {number} p      相机俯仰
 * @property {number} d      画质档 0–2
 * @property {number} ty     （第二轮 hash 接入时敲定语义）
 * @property {0|1}    x      透视开关
 * @property {0|1}    col    系统着色
 * @property {number} st      分步步号 1–7
 * @property {number} ts      时间加速 1/60/720
 * @property {number} rpm     重力档 0.5/1/2
 * @property {number} phase   昼夜相位快照
 * @property {0|1}    tour   导览中
 * @property {0|1}    snd    声音解锁
 * @property {number} q       （第二轮 hash 接入时敲定语义）
 * @property {0|1}    run    运行/暂停
 * @property {number} clk     virtualClock 秒
 * @property {number} led     （第二轮 hash 接入时敲定语义）
 * @property {string|null} sel  选中零件 id，须存在于注册表否则 null
 */

/**
 * @typedef {Object} ConservationData  conservation() 返回（第三轮接入，本轮仅锁定字段）
 * @property {number} o2DemandKgPerDay   耗氧 8400 kg/日
 * @property {number} o2SupplyKgPerDay   产氧（按当前农业产能）
 * @property {number} deltaKgPerDay      产氧 − 耗氧（拆解农业区后重算）
 * @property {number} agriAreaM2         当前可用农业面积 m²
 * @property {number} heatLoadMW         总热负荷 171.02 MW
 * @property {number} heatCapacityMW     散热容量 192 MW
 * @property {number} marginMW           C − Q ≥ 0
 */

/* ── §1 SPEC：数字即法律（§5 全部 P0 链数值 + 推导式） ─────── */

const VERSION = 'R3 · 生态 · 导览 · 声音 · 导出 · 打磨';

const SPEC = {
  Rc: 830,            // 中心线半径 m
  r: 65,              // 环管半径 m（环管占据 R∈[765,895]，径向跨度 130 m）
  Rf: 895,            // 地板半径 m = Rc + r（外侧内壁，人站此处）
  Ri: 765,            // 朝轴心内壁 m = Rc − r（窗带在此）
  shieldOut: 896.5,   // 屏蔽壳外缘 m（1.5 m 等效月壤，包在地板外侧）
  outerDia: 1793,     // 外缘直径 m ≈ 1.8 km
  scale: 0.01,        // 1 unit = 100 m
  S0: 1361,           // 太阳常数 W/m²
  // 能量链（系数给定，P0 链无 TBD）
  rho_m: 0.9, rho_s: 0.9, tau: 0.85, alpha: 0.70,
  Am: Math.PI * 1000 * 1000,       // 主镜整圆盘面积（口径近似）
  As: 12 * 180 * 120,              // 次镜总接收面积
  metabolicMW: 1, q_rad: 8, nRad: 24,
  // 主镜 / 次镜（设定值）
  mirrorY: 1200, mirrorR: 1000, mirrorHubR: 30,    // 渲染毂半径 30 m 为设定值；A_m 仍按整圆盘 π×1000² 计
  secRingR: 600, secW: 180, secD: 120,
  hubDia: 130, spokes: 6, docks: 4,
  // 百叶（设定值 5°/55°）
  louverMin: 5, louverAmp: 25,
  // 剖视盘（渲染标注，设定值）
  sectDiscs: 6, sectGapDeg: 1,     // 舱缝全宽 1°（两端各 0.5°）
  // 布局设定值
  cityAlphaDeg: 10,                // 城市/植被带：截面角 ±10°（壳外最外区）
  louverPerSec: 8,                 // 每面次镜 8 片百叶
};
const u = m => m * SPEC.scale;                    // 米 → unit
const D2R = Math.PI / 180;
// 截面层弧带（§5.2）：α 从朝外方向起、向 +Y 量；R_face(α)=Rc+r·cosα，y(α)=r·sinα
const LAYER_ALPHA = (() => {
  const a = c => Math.acos(c) / D2R;              // cos⁻¹((R−830)/65)
  const a880 = a((880 - 830) / 65), a845 = a((845 - 830) / 65), a810 = a((810 - 830) / 65);
  return {
    floor: [-a880, a880],                          // 居住层 R 880–895 → ±39.715°
    agri:  [a880, a845], agriM: [-a845, -a880],    // 农业层 R 845–880
    equip: [a845, a810], equipM: [-a810, -a845],   // 设备/散热层 R 810–845
    struct:[a810, 180],  structM: [-180, -a810],   // 结构层 R 765–810
    win:   [150, 210],                             // 窗带：内壁朝轴心半圆弧的 1/3（弧长 68 m），居中 α=180°
    shield:[-80, 80],                              // 屏蔽壳贴管面外包层（设定值张角）
  };
})();
// 能量链（只算数，展示在注释与 HUD 推导式；C≥Q 判据）
const ENERGY = (() => {
  const P_in = SPEC.S0 * SPEC.Am;                              // 4.2757 GW
  const P_m = P_in * SPEC.rho_m;                               // 3.8481 GW
  const P_s = P_m * (SPEC.As / SPEC.Am);                       // 317.49 MW（截获比 A_s/A_m=8.2506%）
  const solar = P_s * SPEC.rho_s * SPEC.tau * SPEC.alpha / 1e6; // 170.02 MW
  const Q = solar + SPEC.metabolicMW;                          // 171.02 MW
  const C = SPEC.nRad * SPEC.q_rad;                            // 192 MW
  return { P_in, intercept: SPEC.As / SPEC.Am, solarMW: solar, Q, C, margin: C - Q };
})();

/* ── §2 启动探测选档（P0 #12：首帧前选定，不得先跑高档再降档） ─ */

function detectTier() {
  const ua = navigator.userAgent || '';
  const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  const mem = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : 8;
  const cores = navigator.hardwareConcurrency || 8;
  let tier;
  if (mobile || mem <= 4 || cores <= 4) tier = 0;       // 低档
  else tier = (innerWidth || 1280) < 1280 ? 1 : 2;      // 视口判中/高（显存校验在 renderer 建立后）
  console.log('[TORUS] 启动探测选档:', {
    mobile, deviceMemory: mem, hardwareConcurrency: cores,
    viewport: (innerWidth || 0) + 'x' + (innerHeight || 0),
    tier: ['低', '中', '高'][tier],
  });
  return tier;
}
let TIER = detectTier();
const DPR_CAP = [1, 1.5, 2];                // 低 ≤1 / 中 ≤1.5 / 高 ≤2（§5.7）
const FPS_TARGET = [30, 45, 50];            // 低 / 中 / 高

/* ── §3 renderer / scene / camera / 太阳布光 ──────────────── */

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// 显存校验：maxTextureSize 偏小则至多中档（首帧前完成）
if (TIER === 2 && renderer.capabilities.maxTextureSize < 8192) {
  TIER = 1;
  console.log('[TORUS] maxTextureSize<8192，档位校验降为中档');
}
renderer.shadowMap.enabled = TIER > 0;      // 低档关阴影
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02040a);

const camera = new THREE.PerspectiveCamera(55, 1, 0.002, 200);   // near 0.002 unit(0.2 m) < 最小距离 0.02 unit
// 取景由规格反算（A12：不得手写相机坐标）；包围球含主镜，视线斜率 ≈0.68 与 R1 手调值一致
const R_OUT  = SPEC.outerDia / 2 * SPEC.scale;                                 // 8.965 unit
const R_VIEW = Math.max(R_OUT, Math.hypot(u(SPEC.mirrorR), u(SPEC.mirrorY)));  // 15.62（含主镜）
const FIT_D  = R_VIEW / Math.sin(camera.fov * Math.PI / 360) * 1.15;           // ≈ 38.9
camera.position.set(0, FIT_D * 0.56, FIT_D * 0.83);

const controls = new JLIB.OrbitControls(camera, renderer.domElement);
controls.target.set(0, 3, 0);            // 环心略上，兼顾主镜
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 0.02;             // 2 m（near 必须小于最小距离）
controls.maxDistance = FIT_D * 3.6;      // ≈140，由取景距离推导
controls.autoRotate = true; controls.autoRotateSpeed = 0.35;   // cameraAutoRotate：由阻尼定速
controls.addEventListener('start', () => { controls.autoRotate = false; });
controls.addEventListener('end',   () => { controls.autoRotate = true;  });

// 环境项：RoomEnvironment 作 PMREM 场景源。
// 另生成一张「水滴专用」equirect 环境（太阳亮点 + 地球反照 + 深空）：
// 完美镜面若只反射 RoomEnvironment 的暗部，看起来就是一块黑 —— 必须有亮内容可映。
let DROPLET_ENV = null;
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new JLIB.RoomEnvironment(), 0.04).texture;
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = '#04060b'; c.fillRect(0, 0, 512, 256);
  let g = c.createRadialGradient(256, 340, 10, 256, 340, 300);       // 地球反照（下半球偏蓝）
  g.addColorStop(0, 'rgba(96,158,220,0.85)');
  g.addColorStop(0.40, 'rgba(42,86,140,0.40)');
  g.addColorStop(1, 'rgba(8,16,30,0)');
  c.fillStyle = g; c.fillRect(0, 0, 512, 256);
  g = c.createRadialGradient(368, 74, 1, 368, 74, 72);               // 太阳：白心 + 暖晕
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.10, 'rgba(255,244,214,0.95)');
  g.addColorStop(0.38, 'rgba(255,196,130,0.30)');
  g.addColorStop(1, 'rgba(255,160,80,0)');
  c.fillStyle = g; c.fillRect(0, 0, 512, 256);
  const eq = new THREE.CanvasTexture(cv);
  eq.mapping = THREE.EquirectangularReflectionMapping;
  eq.colorSpace = THREE.SRGBColorSpace;
  DROPLET_ENV = pmrem.fromEquirectangular(eq).texture;
  eq.dispose();
  pmrem.dispose();
}

// 单一太阳方向（I = (0,−1,0)）平行光；阴影分 2 区（禁止单张覆盖全环）
// 两盏同方向、各覆盖半环 x∈[−9.95,0.45]/[−0.45,9.95]，叠加 = 等效单太阳
const SUNS = [];
for (const cx of [-4.75, 4.75]) {
  const L = new THREE.DirectionalLight(0xffffff, 1.1);
  L.position.set(cx, 50, 0);
  L.target.position.set(cx, 0, 0);
  L.castShadow = TIER > 0;
  L.shadow.mapSize.set(TIER === 2 ? 2048 : 1024, TIER === 2 ? 2048 : 1024);
  const c = L.shadow.camera;
  c.left = -5.2; c.right = 5.2; c.top = 9.8; c.bottom = -9.8;
  c.near = 30; c.far = 55;               // 光位 y=50，场景 y∈[−0.7,12.1]
  L.shadow.bias = -0.0004; L.shadow.normalBias = 0.02;
  scene.add(L, L.target);
  SUNS.push(L);
}
// 逻辑太阳方向（供校验）：I = (0,−1,0)，传播方向沿 −Y

// 轮廓补光（冷色、无阴影）：单侧主光下金属只会一半亮一半死灰，这道光给边缘高光
const RIM = new THREE.DirectionalLight(0x9fd8ff, 1.9);
RIM.position.set(-28, 26, -42);
scene.add(RIM);

/* ── §4 材质库（§5.7：钛合金/碳纤维/玻璃 transmission/反射镜） ─ */

const MAT = {
  ti:   new THREE.MeshStandardMaterial({ color: 0xc6d0da, metalness: 0.90, roughness: 0.24, envMapIntensity: 0.95, side: THREE.DoubleSide }),
  cf:   new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.35, roughness: 0.48, envMapIntensity: 0.55 }),
  cfD:  new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.35, roughness: 0.48, envMapIntensity: 0.55, side: THREE.DoubleSide }),
  // 窗带玻璃：transmission 0.65 / IOR 1.50；夜间城市自发光（强度随百叶相位）
  glass:new THREE.MeshPhysicalMaterial({ color: 0x8fb6cc, metalness: 0, roughness: 0.04,
          transmission: 0.65, ior: 1.5, thickness: 0.02, envMapIntensity: 0.95,
          side: THREE.DoubleSide, emissive: 0xffd9a0, emissiveIntensity: 1.25 }),
  mirror:new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1.0, roughness: 0.05, envMapIntensity: 1.25 }),
  glow: new THREE.MeshStandardMaterial({ color: 0x0a2530, emissive: 0x4fc3f7, emissiveIntensity: 0.2, metalness: 0, roughness: 1 }),  // 强调色仅 #4fc3f7
  sect: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.62, envMapIntensity: 0.55, side: THREE.DoubleSide }),
  city: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.55, envMapIntensity: 0.45,
          emissive: 0xffd9a0, emissiveIntensity: 1.25 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1a222c, metalness: 0.2, roughness: 0.85, envMapIntensity: 0.30, side: THREE.DoubleSide }),
  stars:new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }),
};
// per-part 材质实例（MAT 库只作模板）：colorize/xray 按 L1–L8 逐属性写材质，
// 同层内共享、跨层独立——共用模板材质会让相邻层的 color/opacity 互相污染
const MATL = {};
const partMat = (key, base) => (MATL[key] = base.clone());

/* ── §5 几何构建（预算表反推：每组配额见 §8 BUDGET） ───────── */

const spinGroup = new THREE.Group();    // 随环自转：环管、窗带、剖视盘、辐条、枢纽
const staticGroup = new THREE.Group();  // 不随环转：屏蔽壳、散热片、主镜、次镜、光路、星场等
scene.add(spinGroup, staticGroup);

function makeGeo(pos, nor, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
const faceR = al => (SPEC.Rc + SPEC.r * Math.cos(al)) * SPEC.scale;   // 管面半径 unit：8.3 + 0.65·cosα
const faceY = al => SPEC.r * Math.sin(al) * SPEC.scale;               // 管面轴向 y unit：0.65·sinα

/* 5.1 环管主段：6 舱段（每舱 59° 面 + 两端 0.5° 缝），跳过窗带 α∈[150°,210°]
 *     端墙给舱缝以壁厚截面。三角形 = 6×50×30×2 + 12×30×2 = 18720 ≤ 20000 */
function buildTubeShell() {
  const AZ_SEG = 50, AL_SEG = 30, WALL = 0.02;
  const pos = [], nor = [], idx = []; let vi = 0;
  const aStart = 210 * D2R, aSpan = 300 * D2R;           // α 从 210° 跨 300°（经 0°）到 150°
  for (let c = 0; c < 6; c++) {
    const az0 = (c * 60 + 0.5) * D2R, az1 = (c * 60 + 59.5) * D2R;
    for (let i = 0; i <= AZ_SEG; i++) {
      const az = az0 + (az1 - az0) * i / AZ_SEG;
      for (let j = 0; j <= AL_SEG; j++) {
        const al = aStart + aSpan * j / AL_SEG;
        const R = faceR(al), y = faceY(al), ca = Math.cos(al), sa = Math.sin(al);
        pos.push(R * Math.sin(az), y, R * Math.cos(az));
        nor.push(ca * Math.sin(az), sa, ca * Math.cos(az));
      }
    }
    for (let i = 0; i < AZ_SEG; i++) for (let j = 0; j < AL_SEG; j++) {
      const a = vi + i * (AL_SEG + 1) + j, b = a + AL_SEG + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    vi += (AZ_SEG + 1) * (AL_SEG + 1);
    for (const azw of [az0, az1]) {                      // 舱缝端墙：管面向内偏 0.02 的截面墙
      const sx = Math.sin(azw), cz = Math.cos(azw);
      for (let j = 0; j <= AL_SEG; j++) {
        const al = aStart + aSpan * j / AL_SEG;
        const R = faceR(al), y = faceY(al), ca = Math.cos(al), sa = Math.sin(al);
        pos.push(R * sx, y, R * cz);                     // 外沿（管面）
        nor.push(cz, 0, -sx);
        pos.push((R - WALL * ca) * sx, y - WALL * sa, (R - WALL * ca) * cz);  // 内沿
        nor.push(cz, 0, -sx);
      }
      for (let j = 0; j < AL_SEG; j++) {
        const a = vi + j * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      vi += (AL_SEG + 1) * 2;
    }
  }
  const mesh = new THREE.Mesh(makeGeo(pos, nor, idx), partMat('tube', MAT.ti));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
const tubeMesh = buildTubeShell();
spinGroup.add(tubeMesh);

/* 5.2 窗带玻璃 600 格 + 内衬
 *     窗带 α∈[153°,207°]（带宽 54°），az 600 列 × 0.6° = 360° 连续；
 *     单位格细分 3×4 = 24 tris（配额 24）。矩阵只有 Ry(az) —— 600 实例 1 draw call */
function buildGlassGeo() {
  const AZ_HALF = 0.27 * D2R, A0 = 153 * D2R, A1 = 207 * D2R, NA = 4, NZ = 3;
  const pos = [], nor = [], idx = []; let vi = 0;
  for (let i = 0; i <= NZ; i++) {
    const az = -AZ_HALF + 2 * AZ_HALF * i / NZ;
    for (let j = 0; j <= NA; j++) {
      const al = A0 + (A1 - A0) * j / NA;
      const R = faceR(al), y = faceY(al), ca = Math.cos(al), sa = Math.sin(al);
      pos.push(R * Math.sin(az), y, R * Math.cos(az));
      nor.push(-ca * Math.sin(az), -sa, -ca * Math.cos(az));   // 朝轴心
    }
  }
  for (let i = 0; i < NZ; i++) for (let j = 0; j < NA; j++) {
    const a = vi + i * (NA + 1) + j, b = a + NA + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return makeGeo(pos, nor, idx);
}
const glassMesh = new THREE.InstancedMesh(buildGlassGeo(), partMat('glass', MAT.glass), 600);
{
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  for (let i = 0; i < 600; i++) {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.6 * D2R);
    m.compose(p.set(0, 0, 0), q, one);
    glassMesh.setMatrixAt(i, m);
  }
}
spinGroup.add(glassMesh);
// 玻璃内衬（α∈[150,210] 暗弧面，透过格缝成窗框感）——L4
function buildGlassBacking() {
  const NZ = 96, NA = 6, off = 0.03;
  const pos = [], nor = [], idx = []; let vi = 0;
  for (let i = 0; i <= NZ; i++) {
    const az = i / NZ * Math.PI * 2;
    for (let j = 0; j <= NA; j++) {
      const al = (150 + 60 * j / NA) * D2R;
      const R = faceR(al) - off, y = faceY(al), ca = Math.cos(al), sa = Math.sin(al);
      pos.push(R * Math.sin(az), y, R * Math.cos(az));
      nor.push(ca * Math.sin(az), sa, ca * Math.cos(az));
    }
  }
  for (let i = 0; i < NZ; i++) for (let j = 0; j < NA; j++) {
    const a = vi + i * (NA + 1) + j, b = a + NA + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return makeGeo(pos, nor, idx);
}
const glassBack = new THREE.Mesh(buildGlassBacking(), partMat('back', MAT.dark));
spinGroup.add(glassBack);

/* 5.3 城市 / 植被 1200 + 农业格 1800（盒 12 tris，各 1 draw call）
 *     全部位于耐压壳内：底面贴管面，向轴心方向生长（R 递减）
 *     城市/植被 R∈[8.80,8.95]（居住层 14 m）；农业格 R∈[8.45,8.80]（农业层 5 m）
 *     注：城市/植被分两个 InstancedMesh（L5/L6 各自注册，§6「一个零件只能属于一层」）；
 *         材质各自克隆（partMat），供 colorize/xray 按层隔离 —— 对任务书给定代码的唯一适配 */
function buildCityAgri() {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const meshC = new THREE.InstancedMesh(geo, partMat('city', MAT.city), 1200);   // 城市 + 植被
  const meshA = new THREE.InstancedMesh(geo, partMat('agri', MAT.city), 1800);   // 农业格
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qa = new THREE.Quaternion();
  const s = new THREE.Vector3(), p = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
  const col = new THREE.Color();
  let nc = 0, na = 0;
  // hRad = 径向高度（向轴心）；中心 = 管面点 − 外法线 × hRad/2；姿态 = Ry(az)·Rx(−α)（防 α≠0 斜插舱壁）
  const put = (mesh, i, azDeg, alphaDeg, wAz, hAz, hRad, hex) => {
    const az = azDeg * D2R, al = alphaDeg * D2R;
    const R = faceR(al), y = faceY(al), ca = Math.cos(al), sa = Math.sin(al);
    const nx = ca * Math.sin(az), ny = sa, nz = ca * Math.cos(az);   // 管面外法线
    q.setFromAxisAngle(Y, az).multiply(qa.setFromAxisAngle(X, -al));
    s.set(wAz, hAz, hRad);
    p.set(R * Math.sin(az) - nx * hRad / 2,
          y                - ny * hRad / 2,
          R * Math.cos(az) - nz * hRad / 2);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    col.setHex(hex).multiplyScalar(0.75 + Math.random() * 0.45);
    mesh.setColorAt(i, col);
  };
  const resSeg = [[60, 120], [180, 240], [300, 360]];
  const agiSeg = [[0, 60], [120, 180], [240, 300]];
  // 城市 900：6×3 m 底面，14 m 高（居住层 15 m 内留 1 m 净空，α=±7° 处顶面 8.806 ≥ 8.80）
  for (const [a0] of resSeg) for (let i = 0; i < 100; i++)
    for (const al of [-7, 0, 7]) put(meshC, nc++, a0 + 0.3 + i * 0.6, al, 0.06, 0.03, 0.14, 0xffd9a0);
  // 植被 300：5 m 高
  for (const [a0] of resSeg) for (let i = 0; i < 22; i++)
    for (const al of [-10, 10]) put(meshC, nc++, a0 + 1.3 + i * 2.7, al, 0.05, 0.02, 0.05, 0x3f9b4f);
  for (const [a0] of agiSeg) for (let i = 0; i < 56; i++)
    put(meshC, nc++, a0 + 0.5 + i * 1.07, i % 2 ? 45 : -45, 0.05, 0.02, 0.05, 0x3f9b4f);
  // 农业格 1800：5 m 高
  for (const [a0] of agiSeg) for (let i = 0; i < 75; i++)
    for (const al of [42, 52, 62, 72, -42, -52, -62, -72]) put(meshA, na++, a0 + 0.4 + i * 0.8, al, 0.05, 0.05, 0.05, 0x7ec850);
  for (const mm of [meshC, meshA]) {
    mm.castShadow = mm.receiveShadow = true;
    mm.instanceMatrix.needsUpdate = true;
    if (mm.instanceColor) mm.instanceColor.needsUpdate = true;
  }
  return { city: meshC, agri: meshA };
}
const cityAgri = buildCityAgri();
spinGroup.add(cityAgri.city, cityAgri.agri);   // 居住/农业随环自转（原挂 staticGroup 是壳外时代的连带症状）

/* 5.4 屏蔽壳 60 段（InstancedMesh，α∈[−80°,80°] 管面外偏 1.5 m）+ 剖视标注盘 */
function buildShieldSeg() {
  const NZ = 1, NA = 5, A0 = -80 * D2R, A1 = 80 * D2R;
  const pos = [], nor = [], idx = []; let vi = 0;
  for (let i = 0; i <= NZ; i++) {
    const az = (-3 + 6 * i / NZ) * D2R;
    for (let j = 0; j <= NA; j++) {
      const al = A0 + (A1 - A0) * j / NA;
      const R = faceR(al) + 0.015, y = faceY(al), ca = Math.cos(al), sa = Math.sin(al);
      pos.push(R * Math.sin(az), y, R * Math.cos(az));
      nor.push(ca * Math.sin(az), sa, ca * Math.cos(az));
    }
  }
  for (let i = 0; i < NZ; i++) for (let j = 0; j < NA; j++) {
    const a = vi + i * (NA + 1) + j, b = a + NA + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return makeGeo(pos, nor, idx);
}
const shieldMesh = new THREE.InstancedMesh(buildShieldSeg(), partMat('shield', MAT.cf), 60);
{
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(0, 0, 0);
  for (let k = 0; k < 60; k++) {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), k * 6 * D2R);
    m.compose(p, q, one);
    shieldMesh.setMatrixAt(k, m);
  }
  shieldMesh.castShadow = shieldMesh.receiveShadow = true;
}
staticGroup.add(shieldMesh);

// 剖视标注盘：6 块（az=k×60° 舱缝处），五层弧带 + 窗带段 + 屏蔽环带，顶点色，merge 为 1 Mesh
function buildSectDiscs() {
  const pieces = [];
  const colOf = { floor: 0xc9b489, agri: 0x3f9b4f, equip: 0x68727f, struct: 0x8fa1b5, win: 0x23425c, shield: 0x464b54 };
  const colored = (g, hex) => {
    const c = new THREE.Color(hex), n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
    return g;
  };
  const LA = LAYER_ALPHA;
  const arcs = [
    [LA.floor[0], LA.floor[1], colOf.floor],
    [LA.agri[0], LA.agri[1], colOf.agri],
    [LA.agriM[0], LA.agriM[1], colOf.agri],
    [LA.equip[0], LA.equip[1], colOf.equip],
    [LA.equipM[0], LA.equipM[1], colOf.equip],
    [LA.struct[0], 150, colOf.struct],             // 结构带上段（到窗带）
    [LA.structM[0], LA.structM[1], colOf.struct],  // 结构带下段（−180°→−107.92°，覆盖 210°→252.08°）
    [150, 210, colOf.win],                          // 窗带段（玻璃示意色）
  ];
  for (let k = 0; k < SPEC.sectDiscs; k++) {
    const az = k * 60 * D2R;
    // 盘基：局部 x → 径向（az 处），局部 y → 世界 +Y，局部 z → 切向；盘心在中心线 R=8.3
    const B = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(Math.sin(az), 0, Math.cos(az)),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(-Math.cos(az), 0, Math.sin(az)));
    B.setPosition(u(SPEC.Rc) * Math.sin(az), 0, u(SPEC.Rc) * Math.cos(az));
    for (const [d0, d1, hex] of arcs) {
      const seg = Math.max(2, Math.ceil((d1 - d0) / 6));
      const g = colored(new THREE.CircleGeometry(u(SPEC.r), seg, d0 * D2R, (d1 - d0) * D2R), hex);
      g.applyMatrix4(B); pieces.push(g);
    }
    const rg = colored(new THREE.RingGeometry(u(SPEC.r), u(SPEC.r) + 0.015, 8, 1, -80 * D2R, 160 * D2R), colOf.shield);
    rg.applyMatrix4(B); pieces.push(rg);
  }
  const mesh = new THREE.Mesh(JLIB.BufferGeometryUtils.mergeGeometries(pieces), partMat('sect', MAT.sect));
  pieces.forEach(g => g.dispose());
  return mesh;
}
const sectMesh = buildSectDiscs();
spinGroup.add(sectMesh);       // 嵌舱缝，随环转

/* 5.5 散热片 24 组（60 tris/组：主板 12 + 4 翅 48），贴屏蔽壳外面，周向均布 */
function buildRadiatorGeo() {
  const parts = [];
  const main = new THREE.BoxGeometry(0.5, 0.9, 0.05);
  parts.push(main);
  for (const y of [-0.33, -0.11, 0.11, 0.33]) {
    const f = new THREE.BoxGeometry(0.56, 0.14, 0.022);
    f.translate(0, y, 0.036);
    parts.push(f);
  }
  return JLIB.BufferGeometryUtils.mergeGeometries(parts);
}
const radMesh = new THREE.InstancedMesh(buildRadiatorGeo(), partMat('rad', MAT.cf), 24);
{
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  for (let k = 0; k < 24; k++) {
    const az = k * 15 * D2R;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), az);
    p.set(8.99 * Math.sin(az), 0, 8.99 * Math.cos(az));
    m.compose(p, q, s);
    radMesh.setMatrixAt(k, m);
  }
  radMesh.castShadow = radMesh.receiveShadow = true;
}
staticGroup.add(radMesh);

/* 5.6 主镜：12 扇 45° 平面梯形镜（盘心 y=12、外半径 10），法线 front = −n_m
 *     基准扇区（az=0，+Z 方向）中线伸向 +Z 下垂侧（ψ=+90°），反射 R1=(0,0,1) 命中基准次镜 */
const N_M_FRONT = new THREE.Vector3(0, 0.70711, 0.70711);      // −n_m（渲染正面法线，P0 不可省）
function buildMainMirror() {
  // 扇板：r∈[hubR,1000m]，ψ∈[75°,105°]，细分 4×4 = 32 tris/扇
  const pos = [], nor = [], idx = []; let vi = 0;
  const rIn = u(SPEC.mirrorHubR), rOut = u(SPEC.mirrorR), psi0 = 75 * D2R, psi1 = 105 * D2R, yc = u(SPEC.mirrorY);
  for (let i = 0; i <= 4; i++) {
    const r = rIn + (rOut - rIn) * i / 4;
    for (let j = 0; j <= 4; j++) {
      const ps = psi0 + (psi1 - psi0) * j / 4;
      pos.push(r * Math.cos(ps), yc - 0.70711 * r * Math.sin(ps), 0.70711 * r * Math.sin(ps));
      nor.push(N_M_FRONT.x, N_M_FRONT.y, N_M_FRONT.z);
    }
  }
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const a = vi + i * 5 + j, b = a + 5;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  vi += 25;
  const plateGeos = [];
  for (let k = 0; k < 12; k++) {
    const g = makeGeo(pos.slice(), nor.slice(), idx.slice());
    g.rotateY(k * 30 * D2R);
    plateGeos.push(g);
  }
  const mirror = new THREE.Mesh(JLIB.BufferGeometryUtils.mergeGeometries(plateGeos), partMat('mirror', MAT.mirror));
  mirror.castShadow = true;
  plateGeos.forEach(g => g.dispose());

  // 背架：12 肋（沿盘内 +Z 下垂方向）+ 中心毂；碳纤维
  const ribs = [];
  const v2 = new THREE.Vector3(0, -0.70711, 0.70711);          // 盘内「伸向 +Z 下方」方向
  const qv = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v2));
  const qn = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), N_M_FRONT));
  const yc2 = u(SPEC.mirrorY);
  for (let k = 0; k < 12; k++) {
    const g = new THREE.BoxGeometry(0.07, 9.7, 0.05);          // 肋长 9.7 unit（盘心→外缘）
    g.applyMatrix4(qv);
    g.translate(0, yc2 - 0.70711 * 5.15, 0.70711 * 5.15);      // 肋中心 r=5.15 沿 v2
    g.translate(N_M_FRONT.x * -0.07, N_M_FRONT.y * -0.07, N_M_FRONT.z * -0.07);  // 贴背面
    g.rotateY(k * 30 * D2R);
    ribs.push(g);
  }
  const hubG = new THREE.CylinderGeometry(0.3, 0.3, 0.18, 20); // 毂 Ø0.6 unit（渲染设定值）
  hubG.applyMatrix4(qn);
  hubG.translate(0, yc2, 0);
  ribs.push(hubG);
  const frame = new THREE.Mesh(JLIB.BufferGeometryUtils.mergeGeometries(ribs), partMat('mframe', MAT.cf));
  frame.castShadow = true;
  ribs.forEach(g => g.dispose());
  return { mirror, frame };
}
const mainMirror = buildMainMirror();
staticGroup.add(mainMirror.mirror, mainMirror.frame);

/* 5.7 次镜 12 面（InstancedMesh，基准面 az=0 于 (0,12,6)）+ 百叶 96 片 + 支撑桁架
 *     面基 B：x→切向 t=(1,0,0)，y→径向 r̂=(0,−0.65718,0.75373)，z→正面法线 n_s_front=−n_s */
const N_S_FRONT = new THREE.Vector3(0, -0.75373, -0.65718);
const SEC_BASIS = [];
function buildSecondary() {
  // 基准面（az=0）局部坐标：面板细分 6×4 = 48 tris + 背板 12 → 60 tris（配额 200）
  const plate = JLIB.BufferGeometryUtils.mergeGeometries([
    new THREE.PlaneGeometry(1.8, 1.2, 6, 4),
    new THREE.BoxGeometry(1.8, 1.2, 0.04).translate(0, 0, -0.02),
  ]);
  const mesh = new THREE.InstancedMesh(plate, partMat('sec', MAT.mirror), 12);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  const t = new THREE.Vector3(1, 0, 0);
  const rHat = new THREE.Vector3(0, -0.65718, 0.75373);
  const B = new THREE.Matrix4().makeBasis(t, rHat, N_S_FRONT);
  for (let k = 0; k < 12; k++) {
    const az = k * 30 * D2R;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), az);
    p.set(u(SPEC.secRingR) * Math.sin(az), u(SPEC.mirrorY), u(SPEC.secRingR) * Math.cos(az));
    m.compose(p, q, s).multiply(B);
    mesh.setMatrixAt(k, m);
    SEC_BASIS.push(m.clone());
  }
  mesh.castShadow = true;
  return mesh;
}
const secMesh = buildSecondary();
staticGroup.add(secMesh);

// 百叶 96 片：12 面 × 8 片，沿面内径向排布，绕切向轴（局部 x）独立开角 θ(t)
function buildLouvers() {
  const geo = new THREE.PlaneGeometry(u(176), u(13));   // 2 tris/片
  const mesh = new THREE.InstancedMesh(geo, partMat('louver', MAT.cfD), 12 * SPEC.louverPerSec);
  mesh.castShadow = false;
  return mesh;
}
const louverMesh = buildLouvers();
const LOUVER_OFF = [];
{
  const per = SPEC.louverPerSec, D = u(SPEC.secD);
  for (let i = 0; i < per; i++) {
    const off = -D / 2 + D * (i + 0.5) / per;
    LOUVER_OFF.push(new THREE.Matrix4().makeTranslation(0, off, 0.03));
  }
}
function updateLouvers(thetaDeg) {
  const m = new THREE.Matrix4(), rx = new THREE.Matrix4().makeRotationX(thetaDeg * D2R);
  let n = 0;
  for (let k = 0; k < 12; k++) for (let i = 0; i < SPEC.louverPerSec; i++) {
    m.multiplyMatrices(SEC_BASIS[k], LOUVER_OFF[i]).multiply(rx);
    louverMesh.setMatrixAt(n++, m);
  }
  louverMesh.instanceMatrix.needsUpdate = true;
  // 百叶相位 → 昼夜表现：窗带/城市自发光（夜亮昼暗）、光路（昼亮夜微）——按 per-part 克隆材质联动
  const day = (thetaDeg - SPEC.louverMin) / (2 * SPEC.louverAmp);   // 0 夜 → 1 昼
  MATL.glass.emissiveIntensity = 1.25 - 1.15 * day;
  MATL.city.emissiveIntensity = 1.25 - 1.15 * day;
  MATL.agri.emissiveIntensity = 1.25 - 1.15 * day;
  MATL.glow.emissiveIntensity = 0.2 + 1.8 * day;
}
staticGroup.add(louverMesh);

// 次镜支撑：中心桅杆 + 次镜环 + 12 径向杆 + 毂盘（固定非旋转）
function buildSecFrame() {
  const parts = [];
  const mast = new THREE.CylinderGeometry(0.07, 0.09, 11.83, 10);
  mast.translate(0, 6.115, 0); parts.push(mast);
  const ring = new THREE.TorusGeometry(6.0, 0.045, 4, 60);
  ring.rotateX(Math.PI / 2); ring.translate(0, u(SPEC.mirrorY), 0); parts.push(ring);
  for (let k = 0; k < 12; k++) {
    const bar = new THREE.CylinderGeometry(0.03, 0.03, 5.8, 6);
    bar.rotateX(Math.PI / 2); bar.translate(0, u(SPEC.mirrorY), 3.1);
    bar.rotateY(k * 30 * D2R); parts.push(bar);
  }
  const disc = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12);
  disc.translate(0, u(SPEC.mirrorY), 0); parts.push(disc);
  const mesh = new THREE.Mesh(JLIB.BufferGeometryUtils.mergeGeometries(parts), partMat('sframe', MAT.ti));
  mesh.castShadow = true;
  parts.forEach(g => g.dispose());
  return mesh;
}
const secFrame = buildSecFrame();
staticGroup.add(secFrame);

/* 5.8 枢纽与辐条（L8，随环转）：hub Ø130 m + 4 对接口 + 6 辐条 + 2 肋环 */
function buildHub() {
  const parts = [];
  const hub = new THREE.CylinderGeometry(u(SPEC.hubDia / 2), u(SPEC.hubDia / 2), 1.0, 28);
  parts.push(hub);
  for (const [x, z] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {     // 4 对接口
    const d = new THREE.CylinderGeometry(0.16, 0.16, 0.35, 14);
    d.rotateX(Math.PI / 2);
    if (x !== 0) d.rotateY(Math.PI / 2);
    d.translate(x * 0.82, 0, z * 0.82);
    parts.push(d);
  }
  for (let k = 0; k < SPEC.spokes; k++) {                        // 6 辐条，等角 60°
    const s = new THREE.CylinderGeometry(0.055, 0.055, 7.0, 10);
    s.rotateX(Math.PI / 2);
    s.translate(0, 0, 4.15);                                     // 0.65 → 7.65
    s.rotateY(k * 60 * D2R);
    parts.push(s);
  }
  for (const y of [-0.35, 0.35]) {
    const r = new THREE.TorusGeometry(0.67, 0.02, 5, 28);
    r.rotateX(Math.PI / 2); r.translate(0, y, 0);
    parts.push(r);
  }
  const mesh = new THREE.Mesh(JLIB.BufferGeometryUtils.mergeGeometries(parts), partMat('hub', MAT.ti));
  mesh.castShadow = mesh.receiveShadow = true;
  parts.forEach(g => g.dispose());
  return mesh;
}
const hubMesh = buildHub();
spinGroup.add(hubMesh);

/* 5.9 光路线 12 条（基准三点 P_m(0,12,0)→P_s(0,12,600m)→P_w(0,0,765m)），
 *     每条按 φ=k×30° 绕 Y 旋转；强调色 #4fc3f7 自发光，随昼夜相位 */
function buildLightPaths() {
  const parts = [];
  const p1 = new THREE.Vector3(0, u(SPEC.mirrorY) + 0.014, 0.014);   // 主镜盘心 + 法向微偏（贴镜面）
  const p2 = new THREE.Vector3(0, u(SPEC.mirrorY), u(SPEC.secRingR));
  const p3 = new THREE.Vector3(0, 0, u(SPEC.Ri));
  for (let k = 0; k < 12; k++) {
    for (const [a, b] of [[p1, p2], [p2, p3]]) {
      const g = new THREE.TubeGeometry(new THREE.LineCurve3(a.clone(), b.clone()), 6, 0.035, 4, false);
      g.rotateY(k * 30 * D2R);
      parts.push(g);
    }
  }
  const mesh = new THREE.Mesh(JLIB.BufferGeometryUtils.mergeGeometries(parts), partMat('glow', MAT.glow));
  parts.forEach(g => g.dispose());
  return mesh;
}
const lightMesh = buildLightPaths();
staticGroup.add(lightMesh);

/* 5.10 星场（Points 8000，含银河带）+ 太阳方向 billboard */
function buildStars() {
  const N = 8000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const c1 = new THREE.Color(0xffffff), c2 = new THREE.Color(0xa9c8ff), c3 = new THREE.Color(0xffe3b8);
  const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(60 * D2R, 20 * D2R, 0));
  const v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    if (i < 5000) {           // 均匀球壳
      v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (v.lengthSq() < 1e-4) v.set(0, 1, 0);
      v.normalize().multiplyScalar(130 + Math.random() * 60);
    } else {                  // 银河带：倾角 60° 的带状分布
      const th = Math.random() * Math.PI * 2;
      const g = (Math.random() + Math.random() + Math.random() - 1.5) * 8;
      v.set(Math.cos(th) * (130 + Math.random() * 50), g, Math.sin(th) * (130 + Math.random() * 50)).applyMatrix4(rot);
    }
    pos.set([v.x, v.y, v.z], i * 3);
    const r0 = Math.random(), b = 0.4 + Math.random() * 0.6;
    const c = r0 < 0.88 ? c1 : (r0 < 0.95 ? c2 : c3);
    col.set([c.r * b, c.g * b, c.b * b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(g, MAT.stars);
  pts.renderOrder = -1;
  return pts;
}
const starPoints = buildStars();
scene.add(starPoints);

/* 5.13 银河带：加载时程序化生成等距圆柱贴图（1024×512，实测 ~230 ms），贴在内表面球上
 *      半径 190（星场 130–190 的外沿），跟随相机；加法混合，renderOrder 在星场之前 → 星星压在带上
 *      不引外部全景图：省 500 KB，且银道方位、带宽、尘带可调 */
const milkySphere = (() => {
  const W = 768, H = 384;                       // 带宽柔和，0.47°/px 足够；再高只是多花生成时间
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H), d = img.data;
  const NT = 32, tab = new Float32Array(NT * NT * NT);
  for (let i = 0; i < tab.length; i++) tab[i] = Math.random();
  const id = (x, y, z) => ((x & 31) + ((y & 31) << 5) + ((z & 31) << 10));
  const vn = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const c000 = tab[id(xi, yi, zi)], c100 = tab[id(xi + 1, yi, zi)],
          c010 = tab[id(xi, yi + 1, zi)], c110 = tab[id(xi + 1, yi + 1, zi)],
          c001 = tab[id(xi, yi, zi + 1)], c101 = tab[id(xi + 1, yi, zi + 1)],
          c011 = tab[id(xi, yi + 1, zi + 1)], c111 = tab[id(xi + 1, yi + 1, zi + 1)];
    const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
    const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w;
  };
  const fbm = (x, y, z) => { let s = 0, a = 0.5, f = 1; for (let o = 0; o < 3; o++) { s += a * vn(x * f, y * f, z * f); f *= 2.1; a *= 0.5; } return s; };
  const ax = 0.55, ay = 0.55, az = -0.63;       // 银道极轴：斜切画面
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI, cy = Math.sin(lat), r = Math.cos(lat);
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W) * Math.PI * 2 - Math.PI;
      const dx = r * Math.sin(lon), dz = r * Math.cos(lon);
      const b = dx * ax + cy * ay + dz * az;
      if (Math.abs(b) > 0.60) continue;                       // 带外不算，省一半生成时间
      const warp = (fbm(dx * 1.9 + 11, cy * 1.9, dz * 1.9) - 0.44) * 0.16;   // 中心线起伏，不做成直带
      const bb = b + warp;
      const core = Math.exp(-(bb * bb) / 0.016);              // 半宽 ≈ 7°，比之前窄一半
      const halo = Math.exp(-(bb * bb) / 0.18) * 0.20;        // 弥散外晕，很淡
      const clouds = Math.min(1, fbm(dx * 2.3 + 3, cy * 2.3, dz * 2.3) * 1.5);
      const knots = Math.pow(Math.min(1, fbm(dx * 5.5 + 21, cy * 5.5, dz * 5.5) * 1.7), 2.0);
      const dust = Math.exp(-(bb * bb) / 0.0032) * fbm(dx * 9 + 30, cy * 9, dz * 9);
      const gap = 0.26 + 0.74 * clouds;                       // 沿带断续：亮段 / 暗段交替
      let inten = ((core + halo) * gap * (1 - 0.80 * dust) + core * knots * 0.28) * 0.62;
      inten *= 0.88 + 0.24 * vn(dx * 14, cy * 14, dz * 14);   // 细颗粒，破平涂
      const o = (y * W + x) * 4;
      const warm = 0.30 + clouds * 0.55;
      d[o]     = 255 * inten * (0.80 + 0.18 * warm);
      d[o + 1] = 255 * inten * (0.84 + 0.12 * warm);
      d[o + 2] = 255 * inten * (0.98 - 0.04 * warm);
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(190, 64, 40),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.62 })
  );
  mesh.renderOrder = -2;
  return mesh;
})();
scene.add(milkySphere);

/* 5.12 太阳（视觉锚点，与布光方向解耦）
 *     旧锚点在 (0,+1,0)：离默认视线轴 120°，永远在框外——等于没有太阳。
 *     现放右上：离轴 28.3°（水平 +15.1°、垂直 +23.3°），在 55° 视场内、靠上沿。
 *     距离 150：在地球（120）之后、星场（130–190）之内，被环体正确遮挡。 */
const SUN_DIR = new THREE.Vector3(0.26, -0.10, -0.96).normalize();
const SUN_DIST = 150;
const sunGroup = new THREE.Group();
{
  const mk = (stops) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const ctx = cv.getContext('2d');
    const gr = ctx.createRadialGradient(128, 128, 1, 128, 128, 126);
    for (const [p, c] of stops) gr.addColorStop(p, c);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: mk([[0, 'rgba(255,244,214,0.85)'], [0.12, 'rgba(255,196,120,0.32)'],
             [0.35, 'rgba(255,150,90,0.09)'], [1, 'rgba(255,120,60,0)']]),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9,
  }));
  halo.scale.set(46, 46, 1); halo.renderOrder = 2;
  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: mk([[0, 'rgba(255,255,255,1)'], [0.30, 'rgba(255,248,226,0.95)'],
             [0.62, 'rgba(255,224,168,0.35)'], [1, 'rgba(255,200,140,0)']]),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  core.scale.set(15, 15, 1); core.renderOrder = 3;
  sunGroup.add(halo, core);
}
scene.add(sunGroup);

/* 5.9 背景地球（NASA Blue Marble 2048×1024，公有领域；构建期 base64 内联，运行时不发请求）
 *     跟随相机 = 视觉上无穷远：中心距相机 120 unit、半径 38 → 视直径约 37°。
 *     星场在 130–190，恒在地球之后；地球 renderOrder 0 > 星场 −1，深度关系正确。 */
const EARTH_TEX = '__EARTH_TEX_B64__';   // build.mjs 打包时替换为 data:image/jpeg;base64,…
const EARTH_DIR = new THREE.Vector3(0.18, -0.60, -0.78).normalize();
const EARTH_DIST = 120, EARTH_R = 38;
const earthGroup = new THREE.Group();
{
  const tex = new THREE.TextureLoader().load(EARTH_TEX);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_R, 80, 56),
    new THREE.MeshStandardMaterial({
      map: tex, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.05,
      emissive: 0x2a3b52, emissiveMap: tex, emissiveIntensity: 0.30,   // 夜面留一点轮廓，不死黑
    })
  );
  earth.name = 'earth';
  earthGroup.add(earth);
  // 大气边缘光：Fresnel * 受光侧权重，只在晨昏线附近亮
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_R * 1.045, 64, 40),
    new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uColor: { value: new THREE.Color(0x4a9eff) } },
      vertexShader: [
        '#include <common>',
        '#include <logdepthbuf_pars_vertex>',
        'varying vec3 vN; varying vec3 vW;',
        'void main(){',
        '  vN = normalize(mat3(modelMatrix) * normal);',
        '  vec4 w = modelMatrix * vec4(position, 1.0);',
        '  vW = w.xyz;',
        '  gl_Position = projectionMatrix * viewMatrix * w;',
        '  #include <logdepthbuf_vertex>',
        '}',
      ].join('\n'),
      fragmentShader: [
        '#include <common>',
        '#include <logdepthbuf_pars_fragment>',
        'uniform vec3 uSun; uniform vec3 uColor; varying vec3 vN; varying vec3 vW;',
        'void main(){',
        '  #include <logdepthbuf_fragment>',
        '  vec3 n = normalize(vN); vec3 V = normalize(cameraPosition - vW);',
        '  float rim = pow(1.0 - abs(dot(n, V)), 3.0);',
        '  float day = smoothstep(-0.25, 0.35, dot(n, normalize(uSun)));',
        '  float a = rim * (0.28 + 0.72 * day);',
        '  gl_FragColor = vec4(uColor * a * 1.4, a);',
        '  #include <colorspace_fragment>',
        '}',
      ].join('\n'),
    })
  );
  atmo.name = 'earthAtmo';
  earthGroup.add(atmo);
}
scene.add(earthGroup);

/* 5.10 背景月球（NASA/three.js 示例 moon_1024，公有领域）
 *     半径 8.5、距相机 105（在星场 130–190 之前，遮挡关系正确），视直径约 9°。
 *     无大气：不加边缘光，只给夜面极弱的自发光避免纯黑。 */
const MOON_TEX = '__MOON_TEX_B64__';
const MOON_DIR = new THREE.Vector3(-0.38, -0.18, -0.90).normalize();
const MOON_DIST = 105, MOON_R = 8.5;
const moonGroup = new THREE.Group();
{
  const tex = new THREE.TextureLoader().load(MOON_TEX);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_R, 48, 32),
    new THREE.MeshStandardMaterial({
      map: tex, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.03,
      emissive: 0x10161f, emissiveMap: tex, emissiveIntensity: 0.12,
    })
  );
  moon.name = 'moon';
  moonGroup.add(moon);
}
scene.add(moonGroup);

/* 5.11 地球轨道卫星：8 颗，轨道半径 1.14–1.36 R，倾角/升交点/周期错开
 *     独立于 earthGroup 的自转（否则卫星会跟着地球一起转，物理上错） */
const SAT_N = 8, SAT_ORBITS = [];
const satGroup = new THREE.Group();
{
  const satGeo = new THREE.SphereGeometry(0.55, 8, 6);
  const satMat = new THREE.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0.95 });
  const glowTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(32, 32, 1, 32, 32, 30);
    g.addColorStop(0, 'rgba(226,242,255,1)');
    g.addColorStop(0.32, 'rgba(130,196,255,0.55)');
    g.addColorStop(1, 'rgba(80,150,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  for (let i = 0; i < SAT_N; i++) {
    const r = EARTH_R * (1.14 + (i % 3) * 0.11);
    const node = new THREE.Group();
    node.rotation.set((14 + i * 9) * D2R, (i * 47) * D2R, 0);   // 倾角 + 升交点错开
    const spin = new THREE.Group();
    spin.rotation.y = i * 0.9;                                   // 初始相位错开
    const body = new THREE.Mesh(satGeo, satMat);
    body.position.set(r, 0, 0);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.85,
    }));
    glow.scale.set(2.6, 2.6, 1);
    glow.position.copy(body.position);
    spin.add(body, glow);
    node.add(spin);
    satGroup.add(node);
    SAT_ORBITS.push({ spin, speed: (0.10 + (i % 4) * 0.028) * (i % 2 ? -1 : 1) });  // 顺行/逆行混排
  }
}
scene.add(satGroup);

/* 5.14 三体·水滴（强互作用力探测器）：完美镜面泪滴
 *      原著 3.5 m，按 1:100 只有 0.035 unit，肉眼不可见；此处放大到约 195 m（1.95 unit）作视觉物件。
 *      独立漂浮，不进 REG：不参与爆炸/分步/着色/透视，也不可拾取（避免撞零件注册表）。 */
const Y_AXIS = new THREE.Vector3(0, 1, 0), X_AXIS = new THREE.Vector3(1, 0, 0);
const Q_A = new THREE.Quaternion(), Q_B = new THREE.Quaternion(), Q_C = new THREE.Quaternion();
let dropSpin = 0;
const DROPLET_DIR = new THREE.Vector3(0.2447, -0.2487, -0.9372).normalize();  // 离地心 22.5°、离日心 8.7°
const DROPLET_DIST = 100;                                                     // 在环体(≈30)与地球(120)之间，地球之前
const droplet = (() => {
  const R = 1.00, L = 2.30;                       // 头部半径 / 尾部拉长 → 总高约 4.3 unit；距相机 100 → 视直径约 2.5°
  const geo = new THREE.SphereGeometry(R, 64, 48);
  const pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = Math.max(0, -v.y / R);              // 下半球 0→1
    const pull = t * t * (3 - 2 * t);             // smoothstep，衔接无折痕
    v.y -= pull * L;
    const shrink = 1 - 0.93 * Math.pow(t, 2.2);   // 收细成尖端
    v.x *= shrink; v.z *= shrink;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0xffffff, metalness: 1.0, roughness: 0.05,
    envMap: DROPLET_ENV, envMapIntensity: 1.5,
  }));
  // 姿态每帧重算：头（局部 +Y）对准地球，尾（局部 −Y，收尖那端）背向地球即朝向太阳
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), EARTH_DIR);
  m.name = 'droplet';
  return m;
})();
scene.add(droplet);

/* ── §6 L1–L8 注册表 + 零件元数据（第二轮：变换 / 拾取 / 信息卡） ─ */

const REG = {
  L1: { name: '反射镜阵列', delay: 0,    parts: [] },
  L2: { name: '屏蔽壳',     delay: 0.08, parts: [] },
  L3: { name: '散热片',     delay: 0.16, parts: [] },
  L4: { name: '窗带与采光带', delay: 0.24, parts: [] },
  L5: { name: '居住层与城市', delay: 0.32, parts: [] },
  L6: { name: '农业层',     delay: 0.40, parts: [] },
  L7: { name: '结构层与环管', delay: 0.50, parts: [] },
  L8: { name: '辐条与枢纽', delay: 0.60, parts: [] },
};
const REG_IDS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'];
const PART_BY_MESH = new Map();
const PART_IDS = [];
// 信息卡五字段：名称 / 系统(=层名) / 规格 / 推导式 /「设定值」徽标（全部为设定值，非 NASA 实测）
const PART_META = {
  tube:   { name: '环管主段',        spec: '中心线 Ø1660 m · 管径 130 m · 6 舱段', derive: '周长 2πRc = 5215 m；R ∈ [765, 895]' },
  glass:  { name: '窗带格',          spec: '600 格 · 内壁弧带 α∈[150°,210°]', derive: '带宽 68 m = 内壁半圆弧 204 m × 1/3' },
  back:   { name: '窗带内衬',        spec: '暗衬弧面（窗框底衬）', derive: '—' },
  city:   { name: '城市与植被',      spec: '1200 实例 · 居 14 m / 绿 5 m 高', derive: 'R∈[8.80, 8.95] 耐压壳内，底贴管面向轴心生长' },
  agri:   { name: '农业格',          spec: '1800 实例 · 高 5 m', derive: 'α∈±[42°,72°] · R∈[8.45,8.80]（农业层）' },
  shield: { name: '屏蔽壳',          spec: '厚 1.5 m 等效月壤 · 60 段', derive: '896.5 − 895 = 1.5 m；不随环自转' },
  sect:   { name: '剖视标注盘',      spec: '6 块 · 五色层序 + 窗带段', derive: '1.5+15+35+35+45 = 131.5 m' },
  rad:    { name: '散热片',          spec: '24 组 · 额定 8 MW/组', derive: 'C = 24×8 = 192 MW ≥ Q 171.02 MW（余 20.98）' },
  mirror: { name: '主镜 · 12 扇分段镜', spec: 'Ø2000 m · 12×30° · 45° 倾角 · y=+1200 m', derive: 'A_m=π×1000²=3.1416×10⁶ m²；R1=I−2(I·n_m)·n_m=(0,0,1)' },
  mframe: { name: '主镜背架',        spec: '12 肋 + 中心毂', derive: '—' },
  sec:    { name: '次镜 · 12 面环列', spec: '180×120 m · 环列半径 600 m · y=1200 m', derive: 'A_s=12×180×120=259 200 m²；截获比 8.2506%' },
  louver: { name: '百叶',            spec: '12 面 × 8 片 = 96 片', derive: 'θ(t)=5°+25°(1−cos 2πt/86400)：昼 55° / 夜 5°' },
  sframe: { name: '次镜支撑桁架',    spec: '中心桅杆 + 环 + 12 杆', derive: '固定非旋转' },
  hub:    { name: '枢纽与辐条',      spec: 'Ø130 m · 6 辐条等角 60° · 4 对接口', derive: '地板弧长 2πRf/6 = 937.24 m' },
  light:  { name: '光路线',          spec: '12 条 · P_m→P_s→P_w', derive: 'd2=(0,−0.99068,0.13622)；n_s=(0,0.75373,0.65718)' },
};
// 说明：剖视标注盘为可视化标注件（跨五层色带），整体注册 L7，不按带拆层（取舍已登记）。
// 光路线注册 L1：爆炸时随反射镜阵移动（端点脱离窗带属拆解态正常表现）。
// §6「一个零件只能属于一层」：city/agri 拆为两个 InstancedMesh 各自注册，无 instMap 双层注册。
function regP(layer, id, mesh) {
  const part = { id, mesh, mat: mesh.material, meta: PART_META[id],
                 base: { pos: mesh.position.clone(), rotY: mesh.rotation.y } };
  REG[layer].parts.push(part);
  PART_BY_MESH.set(mesh, part);
  PART_IDS.push(id);
}
regP('L1', 'mirror', mainMirror.mirror); regP('L1', 'mframe', mainMirror.frame);
regP('L1', 'sec', secMesh); regP('L1', 'sframe', secFrame); regP('L1', 'louver', louverMesh);
regP('L1', 'light', lightMesh);
regP('L2', 'shield', shieldMesh);
regP('L3', 'rad', radMesh);
regP('L4', 'glass', glassMesh); regP('L4', 'back', glassBack);
regP('L5', 'city', cityAgri.city);
regP('L6', 'agri', cityAgri.agri);
regP('L7', 'tube', tubeMesh); regP('L7', 'sect', sectMesh);
regP('L8', 'hub', hubMesh);

/* ── §7 三时钟与重力（P0 #6/#7） ──────────────────────────── */

// gravityAt：a = (2πn/60)² × Rf，R 取地板半径 895 m；返回地板 g 值（1 rpm → 1.00083）
function gravityAt(rpm) {
  const w = 2 * Math.PI * rpm / 60;
  return w * w * SPEC.Rf / 9.80665;
}
// 三时钟：
//   ringSpin       环体几何自转（重力来源），周期 60/n s，墙钟驱动，不随时间加速
//   cameraAutoRotate OrbitControls.autoRotate（阻尼定速）
//   virtualClock   昼夜逻辑时钟 86400 s，驱动百叶相位；本轮恒 1×（时间加速三档为第三轮）
let OMEGA = 2 * Math.PI / 60;            // 1 rpm 标称：周期 60 s
let vt = 0;                              // virtualClock 秒
function dayNightPhase() { return (vt / 86400) % 1; }
function louverTheta() {
  const t = vt % 86400;
  return SPEC.louverMin + SPEC.louverAmp * (1 - Math.cos(2 * Math.PI * t / 86400));
}

/* ── §8 预算表、perf() 与 HUD ─────────────────────────────── */

const BUDGET = [
  { key: 'tube',    name: '环管主段',         budgetTris: 20000, budgetInst: 1 },
  { key: 'win',     name: '窗带格',           budgetTris: 14400, budgetInst: 600 },
  { key: 'city',    name: '城市/植被/农业格', budgetTris: 36000, budgetInst: 3000 },
  { key: 'shield',  name: '屏蔽壳与分层环带', budgetTris: 1920,  budgetInst: 120 },
  { key: 'radiator',name: '散热片',           budgetTris: 1440,  budgetInst: 24 },
  { key: 'secmirror',name: '次镜',            budgetTris: 2400,  budgetInst: 12 },
  { key: 'hub',     name: '枢纽与辐条',       budgetTris: 8000,  budgetInst: 1 },
  { key: 'stars',   name: '星场与其余',       budgetTris: 4000,  budgetInst: 1 },
];
const GROUP_MESH = {
  tube: tubeMesh, win: glassMesh, city: [cityAgri.city, cityAgri.agri], shield: shieldMesh,
  radiator: radMesh, secmirror: secMesh, hub: hubMesh, stars: starPoints,
};
const geomTris = g => (g.index ? g.index.count : g.attributes.position.count) / 3;

let fpsEMA = 60;
function perf() {
  const groups = BUDGET.map(b => {
    const entry = GROUP_MESH[b.key];
    const meshes = Array.isArray(entry) ? entry : [entry];
    const inst = b.budgetInst === 1 ? 1 : meshes.reduce((s, m) => s + (m.count || 1), 0);
    const tris = meshes.reduce((s, m) => s + Math.round(geomTris(m.geometry) * (m.count || 1)), 0);
    return { ...b, tris, inst, dc: meshes.length };   // 城市组拆 L5/L6 两 mesh：dc 1→2（§6 单层注册）
  });
  // 独立零件（≤60 Mesh）：次镜架、主镜背架、剖视盘、内衬、光路、太阳 billboard 等
  const loose = [];
  scene.traverse(o => {
    if ((o.isMesh || o.isPoints || o.isSprite) && !Object.values(GROUP_MESH).includes(o) && o !== renderer.domElement)
      loose.push(o);
  });
  const looseTris = loose.reduce((s, o) => s + (o.geometry ? Math.round(geomTris(o.geometry)) : 0), 0);
  let sceneDC = 0;
  scene.traverse(o => { if (o.isMesh || o.isPoints || o.isSprite) sceneDC++; });
  const triangles = groups.reduce((s, g) => s + g.tris, 0) + looseTris;
  return {
    fps: fpsEMA, tier: TIER, tierName: ['低', '中', '高'][TIER], dpr: renderer.getPixelRatio(),
    sceneDrawCalls: sceneDC, totalDrawCalls: renderer.info.render.calls,
    triangles, trianglesBudget: 120000, groups,
    loose: { count: loose.length, budgetDc: 60, tris: looseTris },
    fpsTarget: FPS_TARGET[TIER],
  };
}

// HUD
const hud = document.createElement('div'); hud.id = 'hud';
hud.innerHTML = `
  <h1>斯坦福环<small>Stanford Torus · 1975 概念设计</small></h1>
  <div class="ver">${VERSION} <span class="svBadge">设定值</span></div>
  <div class="svNote">本页数据均为设定值，非 NASA 实测</div>
  <section>
    <h2>画质</h2>
    <div class="row"><span class="dim">当前档位</span><b id="hTier">—</b></div>
    <div class="gset">
      <button class="gbtn tbtn2" data-t="2">高</button>
      <button class="gbtn tbtn2" data-t="1">中</button>
      <button class="gbtn tbtn2" data-t="0">低</button>
    </div>
  </section>
  <section>
    <h2>重力演示</h2>
    <div class="gset">
      <button class="gbtn" data-n="0.5">0.5 rpm</button>
      <button class="gbtn on" data-n="1">1 rpm</button>
      <button class="gbtn" data-n="2">2 rpm</button>
    </div>
    <div class="row"><span class="dim">地板加速度 a</span><b id="hAcc">—</b></div>
    <div class="row"><span class="dim">地板 g（读数）</span><b id="hG">—</b></div>
    <div class="derive">a = (2πn/60)² × Rf，Rf = 895 m</div>
  </section>
  <section>
    <h2>三时钟</h2>
    <div class="row"><span class="dim">virtualClock</span><b id="hVt">—</b></div>
    <div class="row"><span class="dim">昼夜相位 phase</span><b id="hPh">—</b></div>
    <div class="row"><span class="dim">百叶开角 θ</span><b id="hLv">—</b></div>
    <div class="row"><span class="dim">ringSpin 周期</span><b id="hSp">—</b></div>
    <div class="row"><span class="dim">时间加速（T）</span><button class="tbtn" id="bTs"><span id="hTs">1×</span></button></div>
  </section>
  <section>
    <h2>生态 · 散热</h2>
    <div class="row"><span class="dim">产氧 − 耗氧</span><b id="hO2">—</b></div>
    <div class="row"><span class="dim">可用农业面积</span><b id="hAgri">—</b></div>
    <div class="row"><span class="dim">热负荷 Q / 容量 C</span><b id="hHeat">—</b></div>
    <div class="derive">17 g/m²/日 × 50.40 万 m²；C = 192 ≥ Q = 171.02 MW</div>
  </section>
  <section>
    <h2>性能</h2>
    <div class="row"><span class="dim">fps（目标 ≥<span id="hTg">50</span>）</span><b id="hFps">—</b></div>
    <div class="row"><span class="dim">draw calls 场景/总计</span><b id="hDc">—</b></div>
    <div class="row"><span class="dim">三角面 / 12 万</span><b id="hTris">—</b></div>
  </section>
  <section>
    <h2>拆解 · 状态合成</h2>
    <div class="row"><span class="dim">爆炸 E</span><input id="eSlider" type="range" min="0" max="100" value="0" aria-label="爆炸进度 0 到 100%"></div>
    <div class="row"><span class="dim">分步 S</span><button class="tbtn" id="bStep">步 <span id="hStep">0</span>/7</button></div>
    <div class="row"><button class="tbtn" id="bCol">着色 C</button><button class="tbtn" id="bXray">透视 X</button></div>
    <div id="legend" class="legend" hidden></div>
  </section>
  <section>
    <h2>导览</h2>
    <div class="row"><button class="tbtn" id="bTour">导览 · 7 站</button><button class="tbtn" id="bPrev">[</button><button class="tbtn" id="bNext">]</button></div>
    <div id="tourBox" class="tourBox"></div>
  </section>
  <section>
    <h2>声音 · 导出</h2>
    <div class="row"><button class="tbtn" id="bSnd">点击启用声音</button><button class="tbtn" id="bSpec">频谱图</button></div>
    <div class="row"><button class="tbtn" id="bShot">截图 2K（Shift=4K）</button></div>
  </section>`;
document.body.appendChild(hud);

const toastBox = document.createElement('div'); toastBox.id = 'toast';
document.body.appendChild(toastBox);
let toastTimer = 0;
function toast(msg) {
  toastBox.textContent = msg; toastBox.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastBox.classList.remove('show'), 3000);
}

const $ = id => document.getElementById(id);
function refreshGravity() {
  const n = OMEGA * 60 / (2 * Math.PI);            // 当前 rpm
  const g = gravityAt(n);                          // gravityAt 返回地板 g 值（1 rpm → 1.00083）
  $('hAcc').textContent = (g * 9.80665).toFixed(4) + ' m/s²';
  $('hG').textContent = g.toFixed(5) + ' g';
  $('hSp').textContent = (60 / n).toFixed(1) + ' s';
}
function setRpm(n) {
  OMEGA = 2 * Math.PI * n / 60;
  document.querySelectorAll('.gbtn').forEach(b => b.classList.toggle('on', +b.dataset.n === n));
  refreshGravity();
  setAmbientTune();                              // 环境音基频随重力档联动（§18）
  toast(`重力演示档 ${n} rpm · 地板 ${gravityAt(n).toFixed(5)} g · ringSpin 周期 ${(60 / n).toFixed(0)} s`);
}
document.querySelectorAll('.gbtn').forEach(b => b.addEventListener('click', () => setRpm(+b.dataset.n)));

$('hTier').textContent = ['低', '中', '高'][TIER] + '（探测）';
$('hTg').textContent = FPS_TARGET[TIER];
refreshGravity();

let hudAcc = 0;
function refreshHud() {
  const p = dayNightPhase();
  const t = vt % 86400;
  const hh = String(Math.floor(t / 3600)).padStart(2, '0');
  const mm = String(Math.floor(t / 60) % 60).padStart(2, '0');
  const ss = String(Math.floor(t) % 60).padStart(2, '0');
  $('hVt').textContent = `${hh}:${mm}:${ss}`;
  $('hPh').textContent = p.toFixed(4);
  $('hLv').textContent = louverTheta().toFixed(2) + '°';
  const c = conservation();                      // 生态 + 散热双读数（P1 #16）
  $('hO2').textContent = `${c.deltaKgPerDay >= 0 ? '+' : ''}${c.deltaKgPerDay} kg/日`;
  $('hAgri').textContent = c.agriAreaM2.toLocaleString() + ' m²';
  $('hHeat').textContent = `${c.heatLoadMW} / ${c.heatCapacityMW} MW`;
  const pf = perf();
  $('hFps').textContent = pf.fps.toFixed(1);
  $('hDc').textContent = `${pf.sceneDrawCalls} / ${pf.totalDrawCalls}`;
  $('hTris').textContent = pf.triangles.toLocaleString();
}

/* ── §9 主循环 ────────────────────────────────────────────── */

let lastFrame = performance.now();
let thetaLast = -1;
updateLouvers(louverTheta());            // 初始百叶相位（午夜 θ=5°）
function tick(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (dt > 0) fpsEMA = fpsEMA * 0.95 + (1 / dt) * 0.05;
  vt += dt * ST.ts;                                  // virtualClock：时间加速只作用于它（ringSpin 不加速）
  spinGroup.rotation.y = (spinGroup.rotation.y + OMEGA * dt) % (Math.PI * 2);   // ringSpin：墙钟，不加速
  const th = louverTheta();
  if (Math.abs(th - thetaLast) > 0.02) { updateLouvers(th); thetaLast = th; }
  // 拆解状态推进（合成顺序之 transform 层；colorize/xray 为事件式逐属性写入）
  if (ST.e !== ST.eTarget) {                         // E 键 0↔1 补间 0.6 s（滑块输入直达）
    const d = dt / 0.6;
    ST.e = ST.eTarget > ST.e ? Math.min(ST.eTarget, ST.e + d) : Math.max(ST.eTarget, ST.e - d);
    $('eSlider').value = Math.round(ST.e * 100);
  }
  if (ST.stepEnabled && sVis !== ST.st) {            // 分步 0.25 s 平滑（终态二值）
    const d = dt / 0.25;
    sVis = ST.st > sVis ? Math.min(ST.st, sVis + d) : Math.max(ST.st, sVis - d);
  }
  applyLayerTransforms();
  if (tween.active) {                                // 聚焦补间 1.15 s 墙钟
    tween.t += dt;
    const k = easeInOut(Math.min(1, tween.t / tween.dur));
    camera.position.lerpVectors(tween.fromP, tween.toP, k);
    controls.target.lerpVectors(tween.fromT, tween.toT, k);
    if (tween.t >= tween.dur) { tween.active = false; queueHash(); }   // 补间结束补写 hash
  }
  controls.update();
  // 星空与太阳跟随相机 = 视觉上位于无穷远：否则半径 130–190 的星壳会被 far=200 远裁剪面切开，
  // 相机一自转就一片片闪断（表现为背景「乱晃」）
  starPoints.position.copy(camera.position);
  milkySphere.position.copy(camera.position);
  sunGroup.position.copy(camera.position).addScaledVector(SUN_DIR, SUN_DIST);
  earthGroup.position.copy(camera.position).addScaledVector(EARTH_DIR, EARTH_DIST);
  earthGroup.rotation.y += dt * 0.012;               // 约 8.7 min 一圈：云陆缓缓移动，背景不死板
  moonGroup.position.copy(camera.position).addScaledVector(MOON_DIR, MOON_DIST);
  satGroup.position.copy(earthGroup.position);         // 卫星与地球共用同一视差偏移，但不吃地球自转
  for (const o of SAT_ORBITS) o.spin.rotation.y += o.speed * dt;
  droplet.position.copy(camera.position).addScaledVector(DROPLET_DIR, DROPLET_DIST);
  // 头朝地球、尾朝太阳；再叠一个绕自身轴的 5.7° 进动，让镜面高光缓慢扫过（纯自转对旋转体不可见）
  dropSpin += dt * 0.55;
  Q_A.setFromUnitVectors(Y_AXIS, EARTH_DIR);
  Q_B.setFromAxisAngle(Y_AXIS, dropSpin).multiply(Q_C.setFromAxisAngle(X_AXIS, 0.10));
  droplet.quaternion.copy(Q_A).multiply(Q_B);
  watchdogTick(dt);                                  // FPS 看门狗（连续两窗口低于目标→降档）
  if (TIER > 0 && composer) composer.render();
  else renderer.render(scene, camera);
  hudAcc += dt;
  if (hudAcc > 0.25) { hudAcc = 0; refreshHud(); }
  requestAnimationFrame(tick);
}

/* ── §10 后处理链（按档，可重建）与 resize ────────────────── */

let composer = null, fxaaPass = null, outlinePass = null;
function buildComposer() {   // hash 档位还原（applyTier）时重建；低档恒 null 直渲
  if (composer) composer.dispose();             // 切档重建时释放旧 render target，防反复切档泄漏
  composer = null; fxaaPass = null; outlinePass = null;
  if (TIER === 2) {           // 高：RenderPass → Outline → UnrealBloom → SMAA → OutputPass
    composer = new JLIB.EffectComposer(renderer);
    composer.addPass(new JLIB.RenderPass(scene, camera));
    outlinePass = makeOutlinePass();            // 必须回存，否则 syncOutlineSelection 永远 early-return
    composer.addPass(outlinePass);
    composer.addPass(new JLIB.UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.5, 0.85));
    composer.addPass(new JLIB.SMAAPass(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio()));
    composer.addPass(new JLIB.OutputPass());
  } else if (TIER === 1) {    // 中：RenderPass → Outline → UnrealBloom → FXAA → OutputPass
    composer = new JLIB.EffectComposer(renderer);
    composer.addPass(new JLIB.RenderPass(scene, camera));
    outlinePass = makeOutlinePass();
    composer.addPass(outlinePass);
    composer.addPass(new JLIB.UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.5, 0.85));
    fxaaPass = new JLIB.ShaderPass(JLIB.FXAAShader);
    composer.addPass(fxaaPass);
    composer.addPass(new JLIB.OutputPass());
  }
  syncOutlineSelection();
}
// P2：OutlinePass 选中描边（只认 object 不认 instanceId，零件粒度即 mesh——契约 §6）
function makeOutlinePass() {
  const op = new JLIB.OutlinePass(new THREE.Vector2(innerWidth, innerHeight), scene, camera);
  op.edgeStrength = 3.0; op.edgeGlow = 0.4; op.edgeThickness = 1;
  op.visibleEdgeColor.set(0x4fc3f7); op.hiddenEdgeColor.set(0x123a52);
  op.selectedObjects = [];
  return op;
}
function syncOutlineSelection() {
  if (!outlinePass) return;    // 低档无后处理：选中反馈由信息卡承担（登记取舍）
  const part = ST.sel ? REG_IDS.flatMap(id => REG[id].parts).find(p => p.id === ST.sel) : null;
  outlinePass.selectedObjects = part ? [part.mesh] : [];
}
// buildComposer() 的首次调用下移到 ST 声明之后：它末尾的 syncOutlineSelection() 要读 ST.sel，
// 在这里调用会撞 TDZ（Cannot access 'ST' before initialization）
// 低档：无后处理，直接 renderer.render()，ACES 由 renderer 生效（色彩三档都必须正常）

function applyDPR() {
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, DPR_CAP[TIER]));
  renderer.setSize(innerWidth, innerHeight);
}
function fxaaResolution() {
  if (fxaaPass) {
    const dpr = renderer.getPixelRatio();
    fxaaPass.material.uniforms.resolution.value.set(1 / (innerWidth * dpr), 1 / (innerHeight * dpr));
  }
}
function setSize() {
  applyDPR();
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (composer) composer.setSize(innerWidth, innerHeight);
  fxaaResolution();
}
addEventListener('resize', setSize);
setSize();

/* ── §12 拆解状态机：爆炸 / 分步 / 着色 / 透视（P0 #3 #4 #5） ── */

const ST = {
  e: 0, eTarget: 0,          // 爆炸滑块 0–1 与目标值（E 键 0↔1，0.6 s 补间）
  stepEnabled: false,
  st: 0,                     // 分步步号 0=关闭 1..7
  col: 0, x: 0,              // 着色 / 透视
  ts: 1,                     // 时间加速 1/60/720（只加速 virtualClock）
  tour: 0,                   // 导览中（期间不写 hash）
  snd: 0,                    // 声音意图（未手势解锁前不创建 AudioContext）
  led: 0,                    // 图例常显（语义猜测：led=legend；若契约语义不同请指正）
  sel: null,                 // 选中零件 id（PART_IDS 内）
  focused: false,            // 聚焦中（Esc 优先级链最高）
  prevDist: FIT_D,           // 聚焦前相机距离（退出聚焦恢复）
};
buildComposer();             // 必须在 ST 之后：内部 syncOutlineSelection() 读 ST.sel
// 层爆炸位移（设定值，已登记）：环形件的整体变换族 = Y 向错落 + 环向旋转。
// 纯平移会把环推成偏心环，绕 Y 拧转保持环形 —— L7 环管拧 −4°，其余沿 Y 错落。
const EXPLODE_VEC = {
  L1: { pos: [0,  5.0, 0], rot: 0 },
  L2: { pos: [0, -2.5, 0], rot: 0 },
  L3: { pos: [0,  2.2, 0], rot: 0 },
  L4: { pos: [0, -1.2, 0], rot: 0 },
  L5: { pos: [0,  1.4, 0], rot: 0 },
  L6: { pos: [0,  2.6, 0], rot: 0 },
  L7: { pos: [0,  0.0, 0], rot: -4 * D2R },
  L8: { pos: [0, -3.6, 0], rot: 0 },
};
const LAYER_STEP = { L1: 1, L2: 1, L3: 2, L4: 3, L5: 4, L6: 5, L7: 6, L8: 7 };  // 7 步 ↔ 8 层（步 1 合并 L1+L2）
const STEP_LABEL = { 1: 'L1+L2 反射镜阵列与屏蔽壳', 2: 'L3 散热片', 3: 'L4 窗带与采光带',
                     4: 'L5 居住层与城市', 5: 'L6 农业层', 6: 'L7 结构层与环管', 7: 'L8 辐条与枢纽' };
const easeInOut = x => x * x * (3 - 2 * x);   // smoothstep
const clamp01 = x => Math.min(1, Math.max(0, x));

let sVis = 0;   // 分步视觉步号（0.25 s 平滑过渡到 ST.st，终态二值；驱动仍单源于 stepEnabled）

// 变换唯一来源：stepEnabled ? 分步驱动 : 爆炸驱动，互斥不叠加；滑块 t 与步号 st 不同时写变换
function layerT(id) {
  if (ST.stepEnabled) return easeInOut(clamp01(sVis - (LAYER_STEP[id] - 1)));
  return easeInOut(clamp01((ST.e - REG[id].delay) / 0.40));   // 末层 0.60+0.40=1.00：t=1 八层全完成
}
function applyLayerTransforms() {
  for (const id of REG_IDS) {
    const t = layerT(id), v = EXPLODE_VEC[id];
    for (const part of REG[id].parts) {
      const b = part.base, m = part.mesh;
      m.position.set(b.pos.x + v.pos[0] * t, b.pos.y + v.pos[1] * t, b.pos.z + v.pos[2] * t);
      m.rotation.y = b.rotY + v.rot * t;
    }
  }
}

// 着色热图（设定值）：colorize 只写 color
const HEAT = { L1: 0x4fc3f7, L2: 0xe8b04b, L3: 0xd96c4f, L4: 0x57c785,
               L5: 0xb48ee8, L6: 0x7ec850, L7: 0x9aa7b4, L8: 0xe8d44f };
// 透视（设定值）：外层（远离轴心）L1/L2/L3 = 10%，内层 L4–L8 = 25%；开启透视时关阴影
const XRAY_OPACITY = { outer: 0.10, inner: 0.25 };
const XRAY_GROUP = { L1: 'outer', L2: 'outer', L3: 'outer',
                     L4: 'inner', L5: 'inner', L6: 'inner', L7: 'inner', L8: 'inner' };

// 合成顺序 transform → colorize → xray：后两者不写变换、逐属性记录原值、逐属性恢复，不整体替换材质引用
function applyColorize() {
  for (const id of REG_IDS) for (const part of REG[id].parts) {
    const mat = part.mat;
    if (ST.col) {
      if (!mat.userData._c0) mat.userData._c0 = mat.color.clone();
      mat.color.setHex(HEAT[id]);
    } else if (mat.userData._c0) {
      mat.color.copy(mat.userData._c0);
      delete mat.userData._c0;
    }
  }
  $('legend').hidden = !(ST.col || ST.led);   // 着色开或图例常显（led）时展示
}
function applyXray() {
  for (const id of REG_IDS) for (const part of REG[id].parts) {
    const mat = part.mat;
    if (ST.x) {
      if (!mat.userData._x0) mat.userData._x0 = { opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite };
      mat.opacity = XRAY_OPACITY[XRAY_GROUP[id]];
      mat.transparent = true;
      mat.depthWrite = false;
    } else if (mat.userData._x0) {
      mat.opacity = mat.userData._x0.opacity;
      mat.transparent = mat.userData._x0.transparent;
      mat.depthWrite = mat.userData._x0.depthWrite;
      delete mat.userData._x0;
    }
  }
  const wantShadow = !ST.x && TIER > 0;
  if (renderer.shadowMap.enabled !== wantShadow) {
    renderer.shadowMap.enabled = wantShadow;
    scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  }
}

function setExplode(v) { ST.e = ST.eTarget = clamp01(v); $('eSlider').value = Math.round(ST.e * 100); }
function toggleExplode() {
  if (ST.stepEnabled) { toast('分步接管中，先按 S 关闭分步'); return; }   // 否则喊「爆炸 100%」但画面不动
  setExplode(ST.eTarget > 0.5 ? 0 : 1); toast(`爆炸 ${Math.round(ST.eTarget * 100)}%`); blip(ST.eTarget > 0.5 ? 140 : 260, 0.3); queueHash();
}
function toggleStep() {
  ST.stepEnabled = !ST.stepEnabled;
  ST.st = ST.stepEnabled ? Math.max(1, ST.st) : 0;
  if (ST.stepEnabled) sVis = 0;                 // 复位：否则从第 7 步关掉再开，会先炸开再收拢
  $('hStep').textContent = ST.st;
  $('bStep').classList.toggle('on', ST.stepEnabled);
  toast(ST.stepEnabled ? `分步开 · 第 ${ST.st} 步（7 步覆盖 8 层）` : '分步关');
  queueHash();
}
function stepBy(dir) {
  if (!ST.stepEnabled) { ST.stepEnabled = true; ST.st = 1; sVis = 0; }
  else ST.st = Math.min(7, Math.max(1, ST.st + dir));
  $('hStep').textContent = ST.st;
  $('bStep').classList.add('on');
  toast(`分步 · 第 ${ST.st} 步：${STEP_LABEL[ST.st]}`);
  blip(240 + ST.st * 24, 0.12);
  queueHash();
}
function toggleColorize() {
  ST.col = ST.col ? 0 : 1; applyColorize();
  $('bCol').classList.toggle('on', !!ST.col);
  toast(`系统着色 ${ST.col ? '开 · L1–L8 热图' : '关'}`); queueHash();
}
function toggleXray() {
  ST.x = ST.x ? 0 : 1; applyXray();
  $('bXray').classList.toggle('on', !!ST.x);
  toast(`透视 ${ST.x ? '开 · 外 10% / 内 25%，关阴影' : '关'}`); queueHash();
}

/* ── §13 拾取 · 信息卡 · 聚焦（P0 #2） ────────────────────── */

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pickables = REG_IDS.flatMap(id => REG[id].parts.map(p => p.mesh));
let downX = 0, downY = 0, lastClickT = 0, singleTimer = 0;

const card = document.createElement('div'); card.id = 'card'; card.hidden = true;
document.body.appendChild(card);

function selectPart(part) {
  ST.sel = part ? part.id : null;
  if (!part) { card.hidden = true; queueHash(); return; }
  const L = REG_IDS.find(id => REG[id].parts.includes(part));
  card.innerHTML = `
    <button class="cClose" aria-label="关闭信息卡">✕</button>
    <div class="cName">${part.meta.name} <span class="svBadge">设定值</span></div>
    <div class="cRow"><span>系统</span><b>${L} ${REG[L].name}</b></div>
    <div class="cRow"><span>规格</span><b>${part.meta.spec}</b></div>
    <div class="cRow"><span>推导式</span><b>${part.meta.derive}</b></div>`;
  card.querySelector('.cClose').addEventListener('click', () => selectPart(null));
  card.hidden = false;
  syncOutlineSelection();
  queueHash();
}

// 聚焦：1.15 s 墙钟补间（契约 §5.5），推近到零件设定距离；Esc 最高优先退出
const tween = { active: false, t: 0, dur: 1.15,
                fromP: new THREE.Vector3(), toP: new THREE.Vector3(),
                fromT: new THREE.Vector3(), toT: new THREE.Vector3() };
const FOCUS_DIST = { tube: 26, glass: 18, back: 18, city: 13, agri: 13, shield: 22, sect: 20,
                     rad: 20, mirror: 24, mframe: 24, sec: 11, louver: 9, sframe: 26, hub: 5, light: 26 };  // 设定值
function focusPart(part) {
  const d = FOCUS_DIST[part.id] || FIT_D;
  const dir = camera.position.clone().sub(controls.target).normalize();
  const wp = part.mesh.getWorldPosition(new THREE.Vector3());
  const target = wp.lengthSq() < 1e-6 ? controls.target.clone() : wp;   // 几何烘焙件围绕原点看
  tween.fromP.copy(camera.position); tween.fromT.copy(controls.target);
  tween.toT.copy(target); tween.toP.copy(target).add(dir.multiplyScalar(d));
  tween.t = 0; tween.active = true; tween.dur = 1.15;   // 显式重置：首屏演出 3.2 s 不得污染聚焦时长
  ST.focused = true;
  ST.prevDist = camera.position.distanceTo(controls.target);
  controls.autoRotate = false;
}
function unfocus() {
  ST.focused = false;
  const dir = camera.position.clone().sub(controls.target).normalize();
  tween.fromP.copy(camera.position); tween.fromT.copy(controls.target);
  tween.toT.copy(controls.target);
  tween.toP.copy(controls.target).add(dir.multiplyScalar(ST.prevDist));
  tween.t = 0; tween.active = true; tween.dur = 1.15;
  controls.autoRotate = true;
}

// 单击/双击去抖：click 后等 250 ms 无二击判单选；双击只聚焦不弹卡；拖拽（>6 px）不算点击
renderer.domElement.addEventListener('pointerdown', ev => { downX = ev.clientX; downY = ev.clientY; });
renderer.domElement.addEventListener('pointerup', ev => {
  if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 6) return;
  pointer.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickables, false);
  const part = hits.length ? (PART_BY_MESH.get(hits[0].object) || null) : null;
  const now = performance.now();
  if (now - lastClickT < 250) {
    clearTimeout(singleTimer);
    lastClickT = 0;
    if (part) focusPart(part);
  } else {
    lastClickT = now;
    clearTimeout(singleTimer);
    singleTimer = setTimeout(() => { selectPart(part); }, 250);
  }
});
controls.addEventListener('end', () => { if (!ST.focused) controls.autoRotate = true; });   // 聚焦中不自转

/* ── §14 分享 hash（P0 #11）：18 字段白名单 + 全程 try/catch ── */

const HASH_KEYS = ['e','a','p','d','ty','x','col','st','ts','rpm','phase','tour','snd','q','run','clk','led','sel'];
const rpmNow = () => +(OMEGA * 60 / (2 * Math.PI)).toFixed(3);
function parseHash(hash) {
  const def = { e: 0, a: null, p: null, d: TIER, ty: 0, x: 0, col: 0, st: 0, ts: 1,
                rpm: 1, phase: 0, tour: 0, snd: 0, q: TIER, run: 1, clk: 0, led: 0, sel: null };
  try {
    if (!hash || hash.length < 2) return def;
    const out = { ...def };
    for (const seg of hash.slice(1).split('&')) {
      const i = seg.indexOf('=');
      if (i < 1) continue;
      const k = seg.slice(0, i);
      if (!HASH_KEYS.includes(k)) continue;                     // 白名单枚举校验键
      const v = decodeURIComponent(seg.slice(i + 1));           // decode 异常由外层捕获回落默认
      if (v === '') continue;                                   // 空值不得被 Number('')===0 当成 0
      if (k === 'sel') { out.sel = PART_IDS.includes(v) ? v : null; continue; }   // 不在注册表回落 null
      const num = Number(v);
      if (!Number.isFinite(num)) continue;
      out[k] = num;
    }
    out.e = clamp01(out.e);
    out.d = Math.min(2, Math.max(0, Math.round(out.d)));
    out.x = out.x ? 1 : 0; out.col = out.col ? 1 : 0;
    out.st = Math.min(7, Math.max(0, Math.round(out.st)));
    out.ts = [1, 60, 720].includes(out.ts) ? out.ts : 1;
    out.rpm = [0.5, 1, 2].includes(out.rpm) ? out.rpm : 1;
    out.phase = clamp01(out.phase);
    out.clk = Math.max(0, out.clk);
    if (out.a !== null) out.a = Math.min(180, Math.max(-180, out.a));
    if (out.p !== null) out.p = Math.min(179, Math.max(0.1, out.p));
    return out;
  } catch (err) {
    console.warn('[TORUS] hash 解析失败，回落默认 State', err);
    return def;
  }
}
let hashTimer = 0, hashQueued = false;
function queueHash() { hashQueued = true; clearTimeout(hashTimer); hashTimer = setTimeout(writeHash, 700); }   // 交互静止 0.7 s
function writeHash() {
  if (!hashQueued) return;
  if (ST.tour) return;                          // 导览期间不写（退出导览时补写一次）
  if (tween.active) { queueHash(); return; }    // 相机补间中不写，结束后补写一次
  hashQueued = false;
  const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  const h = '#e=' + ST.e.toFixed(3) +
    '&a=' + (sph.theta / D2R).toFixed(3) + '&p=' + (sph.phi / D2R).toFixed(3) +   // 球坐标 toFixed(3)
    '&d=' + TIER + '&ty=0&x=' + ST.x + '&col=' + ST.col + '&st=' + ST.st +
    '&ts=' + ST.ts + '&rpm=' + rpmNow() + '&phase=' + dayNightPhase().toFixed(3) +
    '&tour=' + ST.tour + '&snd=' + (audioOn ? 1 : 0) + '&q=' + TIER +
    '&run=1&clk=' + Math.floor(vt) + '&led=' + ST.led + '&sel=' + (ST.sel || '');
  history.replaceState(null, '', h);
}
// ty / q / run 三字段：解析存储、还原忽略（ty/q 契约未给语义不编造；run 时钟恒跑）——登记取舍
function applyTier(n, manual, silent) {
  TIER = Math.min(2, Math.max(0, Math.round(n)));
  buildComposer();
  applyDPR(); setSize();
  renderer.shadowMap.enabled = TIER > 0 && !ST.x;
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  if (manual) watchdog.manual = true;           // 用户手动切档（含 hash 还原）→ 看门狗关闭
  $('hTier').textContent = ['低', '中', '高'][TIER] + (watchdog.manual ? '' : '（探测）');
  $('hTg').textContent = FPS_TARGET[TIER];
  document.querySelectorAll('.tbtn2').forEach(b => b.classList.toggle('on', +b.dataset.t === TIER));
  if (!silent) toast(`画质档「${['低', '中', '高'][TIER]}」${manual ? '· 看门狗已关闭' : ''}`);
}
function applyHash(s) {
  if (s.a !== null && s.p !== null) {           // 相机方向还原（距离不进 hash，保持当前值）
    const sph = new THREE.Spherical(camera.position.distanceTo(controls.target), s.p * D2R, s.a * D2R);
    camera.position.setFromSpherical(sph).add(controls.target);
  }
  vt = s.clk;                                    // virtualClock 还原（phase 为冗余快照，以 clk 为准）
  if (s.rpm !== 1) setRpm(s.rpm);
  if (s.d !== TIER) applyTier(s.d, true, true);
  if (s.ts !== 1) { ST.ts = s.ts; $('hTs').textContent = s.ts + '×'; }
  if (s.e > 0) setExplode(s.e);
  if (s.col) toggleColorize();
  if (s.x) toggleXray();
  if (s.st > 0) {
    ST.stepEnabled = true; ST.st = s.st; sVis = s.st;
    $('hStep').textContent = s.st; $('bStep').classList.add('on');
  }
  if (s.snd) {                                   // 声音意图还原：仍需手势解锁才有声（契约 §5.8）
    ST.snd = 1;                                  // audioOn 保持 false：首次点击才是「开」，否则第一下变「关」
    $('bSnd').textContent = '声音 待手势'; $('bSnd').classList.add('on');
  }
  if (s.led) { ST.led = 1; $('legend').hidden = false; }
  if (s.sel) {
    const part = REG_IDS.flatMap(id => REG[id].parts).find(p => p.id === s.sel);
    if (part) selectPart(part);
  }
  if (s.tour) enterTour();                       // tour=1 还原进导览（§20 已就绪）
  console.log('[TORUS] hash 还原:', { e: s.e, st: s.st, rpm: s.rpm, d: s.d, x: s.x, col: s.col, ts: s.ts, sel: s.sel, clk: s.clk });
}

/* ── §15 键盘（C/X/S/E 可同时开启；Space 相机自转；Esc 逐级退出） ── */

function escapeChain() {   // 聚焦 > 分步 > 导览 > 取消选中 > 整机
  if (ST.focused) { unfocus(); toast('退出聚焦'); }
  else if (ST.stepEnabled) toggleStep();
  else if (ST.tour) exitTour();
  else if (ST.sel) selectPart(null);
  else {
    let did = false;
    if (ST.col) { toggleColorize(); did = true; }
    if (ST.x) { toggleXray(); did = true; }
    if (ST.eTarget > 0) { setExplode(0); did = true; }
    if (did) toast('已复位拆解状态');
  }
}
addEventListener('keydown', ev => {
  if (ev.repeat) return;
  const k = ev.key.toLowerCase();
  if (k === 'c') toggleColorize();
  else if (k === 'x') toggleXray();
  else if (k === 's') toggleStep();
  else if (k === 'e') toggleExplode();
  else if (k === 't') cycleTs();
  else if (k === '[') { ST.tour ? tourStep(-1) : toggleTour(); }
  else if (k === ']') { ST.tour ? tourStep(1) : toggleTour(); }
  else if (k === ' ') { ev.preventDefault(); controls.autoRotate = !controls.autoRotate; toast(`相机自转 ${controls.autoRotate ? '开' : '关'}`); }
  else if (k === 'escape') escapeChain();
});

// HUD 拆解区绑定
$('eSlider').addEventListener('input', ev => { setExplode(+ev.target.value / 100); queueHash(); });
$('bStep').addEventListener('click', () => stepBy(1));
$('bCol').addEventListener('click', toggleColorize);
$('bXray').addEventListener('click', toggleXray);
{
  const lg = $('legend');
  lg.innerHTML = REG_IDS.map(id =>
    `<span class="lgItem"><i style="background:#${HEAT[id].toString(16).padStart(6, '0')}"></i>${id} ${REG[id].name}</span>`).join('');
}

/* ── §16 生态守恒（P1 #15 conservation）——§5.4 全链给定系数 ── */

const AGRI = {
  arcM: 2 * Math.PI * 862.5 / 6,   // 903.21 m：农业层中径 R=862.5 m 的 1/6 弧长（不用地板 895 m 的 937.24 m）
  widthM: 62,                      // 设定值：栽培面宽（沿管壁截面弧长；35 m 层可用约 84 m 取 62）
  layers: 3,                       // 设定值：立体层数
  rate: 17,                        // 设定值：g/m²/日（由 8400 / 50.40 万 = 16.67 推导取 17）
};
AGRI.areaM2 = 3 * AGRI.arcM * AGRI.widthM * AGRI.layers;      // ≈ 503 991 m² ≈ 50.40 万 m²
const O2 = {
  demand: 8400,                             // 0.84 kg/人·日 × 10 000 人
  supplyFull: AGRI.areaM2 * AGRI.rate / 1000,               // ≈ 8567.8 kg/日（+167.8，+2.00%）
};
// conservation()：生态 + 散热双读数；农业层（L6）拆解程度 → 产能重算 delta（不返回固定值）
function conservation() {
  const t = layerT('L6');                   // 0 原位 → 1 完全拆出（爆炸 t / 分步 sVis 单源驱动）
  const supply = O2.supplyFull * (1 - t);
  return {
    o2DemandKgPerDay: O2.demand,
    o2SupplyKgPerDay: +supply.toFixed(1),
    deltaKgPerDay: +(supply - O2.demand).toFixed(1),
    agriAreaM2: Math.round(AGRI.areaM2 * (1 - t)),
    heatLoadMW: ENERGY.Q,                   // 171.02 MW（能量链系数给定）
    heatCapacityMW: ENERGY.C,               // 192 MW
    marginMW: ENERGY.margin,                // 20.98 MW ≥ 0
  };
}

/* ── §17 时间加速三档（P1 #21：1×/60×/720×，只加速 virtualClock） ── */

const TS_STEPS = [1, 60, 720];
function cycleTs() {
  ST.ts = TS_STEPS[(TS_STEPS.indexOf(ST.ts) + 1) % TS_STEPS.length];
  $('hTs').textContent = ST.ts + '×';
  toast(`时间加速 ${ST.ts}×` + (ST.ts > 1 ? ` · 一昼夜 ≈ ${(86400 / ST.ts / 60).toFixed(0)} 分钟 · ringSpin 不受影响` : ''));
  queueHash();
}
$('bTs').addEventListener('click', cycleTs);

/* ── §18 WebAudio（P1 #18 手势解锁 + P2 卷积混响/频谱导出） ── */

let audioCtx = null, analyser = null, masterGain = null, audioIn = null, ambient = null;
let audioOn = false;              // 用户意图；未手势解锁前不创建音源、不报错（契约 §5.8）
function makeIR(seconds, decay) { // P2 卷积混响：程序化指数衰减白噪声 IR（禁止加载音频采样文件）
  const rate = audioCtx.sampleRate, len = Math.floor(rate * seconds);
  const buf = audioCtx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}
function setAmbientTune() {       // 环境音基频随重力档联动：n rpm → 110·n Hz（55 Hz 在笔记本喇叭上等于没声音）
  if (!ambient) return;
  const n = OMEGA * 60 / (2 * Math.PI);
  ambient.oscA.frequency.value = 110 * n;
  ambient.oscB.frequency.value = 110 * n * 1.006 + 0.8;   // 轻微失谐产生 0.6 Hz 拍频，听感更"活"
}
function ensureAudio() {          // 首次手势（声音按钮）内创建；节点图逐项赋 .value
  if (audioCtx) { audioCtx.resume(); return; }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  audioCtx = new Ctx();
  const p1 = audioCtx.createBiquadFilter();
  p1.type = 'peaking'; p1.frequency.value = 1600; p1.Q.value = 3; p1.gain.value = 3;
  const p2 = audioCtx.createBiquadFilter();
  p2.type = 'lowshelf'; p2.frequency.value = 100; p2.gain.value = -2;
  const comp = audioCtx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.25;
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0;
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  const verb = audioCtx.createConvolver();       // P2 卷积混响
  verb.buffer = makeIR(2.4, 3.2);
  const wet = audioCtx.createGain(); wet.gain.value = 0.22;
  audioIn = p1;
  ambient = { oscA: audioCtx.createOscillator(), oscB: audioCtx.createOscillator(),
              g: audioCtx.createGain(), lfo: audioCtx.createOscillator(), lg: audioCtx.createGain() };
  const a = ambient;
  a.oscA.type = 'sine'; a.oscB.type = 'sine';
  a.g.gain.value = 0.13;
  a.lfo.type = 'sine'; a.lfo.frequency.value = 0.07; a.lg.gain.value = 0.02;
  a.lfo.connect(a.lg); a.lg.connect(a.g.gain);
  a.oscA.connect(a.g); a.oscB.connect(a.g);
  a.g.connect(p1); a.g.connect(verb);
  verb.connect(wet); wet.connect(p1);
  // 宽带噪声床：110 Hz 纯音在小喇叭上仍然弱，低通噪声给出"舱内环境"的可听质地
  {
    const nb = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 2), audioCtx.sampleRate);
    const nd = nb.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < nd.length; i++) { lp = (lp + 0.02 * (Math.random() * 2 - 1)) / 1.02; nd[i] = lp * 3.2; }
    const noise = audioCtx.createBufferSource(); noise.buffer = nb; noise.loop = true;
    const nf = audioCtx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 520; nf.Q.value = 0.7;
    const ng = audioCtx.createGain(); ng.gain.value = 0.06;
    noise.connect(nf); nf.connect(ng); ng.connect(p1);
    noise.start();
  }
  p1.connect(p2); p2.connect(comp); comp.connect(masterGain); masterGain.connect(analyser);
  analyser.connect(audioCtx.destination);
  a.oscA.start(); a.oscB.start(); a.lfo.start();
  setAmbientTune();
}
function toggleSound() {
  audioOn = !audioOn;
  ST.snd = audioOn ? 1 : 0;
  if (audioOn && !audioCtx) ensureAudio();       // 创建在用户手势上下文内
  if (audioCtx) {
    audioCtx.resume();
    masterGain.gain.setTargetAtTime(audioOn ? 1 : 0, audioCtx.currentTime, 0.12);
  }
  $('bSnd').textContent = audioOn ? '声音 开' : '声音 关';
  $('bSnd').classList.toggle('on', audioOn);
  if (audioOn) { blip(880, 0.18); setTimeout(() => blip(1320, 0.14), 110); }   // 开声确认音：先让人听见「有声音了」
  toast(audioOn ? '声音开 · 环境嗡鸣随重力档联动' : '声音关');
}
function blip(freq, dur) {         // 交互短音（爆炸/分步切换），走同一滤波链
  if (!audioCtx || !audioOn || !audioIn) return;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'triangle'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.12, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  o.connect(g); g.connect(audioIn);
  o.start(); o.stop(audioCtx.currentTime + dur + 0.05);
}
function exportSpectrum() {        // P2 频谱导出：analyser → canvas 2D → PNG
  if (!analyser || !audioOn) { toast('声音未启用，无法导出频谱'); return; }
  const N = analyser.frequencyBinCount, data = new Uint8Array(N);
  analyser.getByteFrequencyData(data);
  const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 480;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, cv.width, cv.height);
  const grad = ctx.createLinearGradient(0, cv.height, 0, 0);
  grad.addColorStop(0, '#123a52'); grad.addColorStop(1, '#4fc3f7');
  ctx.fillStyle = grad;
  const bars = 320, bw = cv.width / bars;
  for (let i = 0; i < bars; i++) {
    const v = data[Math.floor(i * N / bars / 2)] / 255;   // 对数感：取低半段
    const hh = v * (cv.height - 70);
    ctx.fillRect(i * bw, cv.height - 40 - hh, bw - 1.5, hh);
  }
  ctx.fillStyle = '#e6f1fb';
  ctx.font = '22px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText('Stanford Torus · spectrum · ' + new Date().toISOString().slice(0, 10) + '  TRS-1975', 24, 30);
  const a = document.createElement('a');
  a.download = 'torus-spectrum.png'; a.href = cv.toDataURL('image/png'); a.click();
  toast('频谱图已导出 PNG');
}

/* ── §19 2K/4K 导出 + 品牌条（P1 #19 / P2 4K） ─────────────── */

function exportPNG(scale) {
  const maxTex = renderer.capabilities.maxTextureSize || 4096;
  const maxSamples = renderer.capabilities.maxSamples ?? 0;    // 显存预算：MSAA 采样上限一并记录
  const w0 = innerWidth, h0 = innerHeight;
  const s = Math.min(scale, maxTex / Math.max(w0, h0));        // 超显存自动收口
  const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (composer) { composer.setSize(w, h); composer.render(); }
  else renderer.render(scene, camera);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(renderer.domElement, 0, 0, w, h);
  // 品牌条（契约 §7）：高 8.5% 贴底 #0b0e14、左右 padding 2.5%、字号 = 条高×0.32、monospace、#e6f1fb
  const barH = Math.round(h * 0.085), pad = Math.round(w * 0.025);
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, h - barH, w, barH);
  ctx.fillStyle = '#e6f1fb';
  ctx.font = Math.round(barH * 0.32) + 'px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'middle';
  const y = h - barH / 2;
  ctx.textAlign = 'left';   ctx.fillText('Stanford Torus · 1975 概念设计', pad, y);
  ctx.textAlign = 'center'; ctx.fillText('设定值 · 剖视复原', w / 2, y);
  ctx.textAlign = 'right';  ctx.fillText(new Date().toISOString().slice(0, 10) + '  TRS-1975', w - pad, y);
  const a = document.createElement('a');
  a.download = `stanford-torus-${Math.max(w, h)}px.png`;
  a.href = cv.toDataURL('image/png'); a.click();
  applyDPR(); setSize();                        // 完整恢复 pixelRatio / aspect / composer 尺寸
  toast(`已导出 ${scale >= 4 ? '4K' : '2K'} 截图 · 长边 ${Math.max(w, h)}px（含品牌条；maxSamples=${maxSamples}）`);
}

/* ── §20 导览 7 站（P1 #17；导览期间不写 hash） ────────────── */

const TOUR = [
  { name: '整体', dist: FIT_D, dir: [0, 0.56, 0.83],
    text: '斯坦福环（1975 NASA Ames 概念设计）：旋转产生 1 g 人工重力，主镜阵列沿自转轴采光。本页全部数据为设定值，非 NASA 实测。' },
  { name: '光路', dist: 26, dir: [0.1, 0.62, 0.50],
    text: '太阳光沿自转轴入射（I=−Y）→ 主镜 45° 折成水平 R1=(0,0,1) → 12 面次镜再折向下 → 命中 R=765 m 内壁窗带。光在 y>0 段恒 R<765，不穿环管。' },
  { name: '截面', dist: 12, dir: [0, 0.18, 0.92],
    text: '六块剖视盘读五层序：屏蔽壳 1.5 m（最外）→ 居住 15 m → 农业 35 m → 设备 35 m → 结构 45 m，合计 131.5 m 闭合。离心重力朝外，地板在外侧内壁，头朝轴心。' },
  { name: '重力', dist: FIT_D, dir: [-0.35, 0.45, 0.82],
    text: () => `当前 ${rpmNow()} rpm：地板 ${gravityAt(rpmNow()).toFixed(5)} g，a = (2πn/60)² × Rf。三档中仅 1 rpm 是 1 g；换档同时改变 ringSpin 周期，720× 加速不改变它。` },
  { name: '生态', dist: 14, dir: [0.55, 0.10, 0.83],
    text: () => { const c = conservation(); return `农业面积 ${c.agriAreaM2.toLocaleString()} m² · 产氧 ${c.o2SupplyKgPerDay} − 耗氧 8400 = ${c.deltaKgPerDay >= 0 ? '+' : ''}${c.deltaKgPerDay} kg/日。拆解农业区（L6）后 delta 按产能重算，不返回固定值。`; } },
  { name: '爆炸', dist: FIT_D * 1.25, dir: [0, 0.70, 0.72],
    text: '拖爆炸滑块或按 E（0.6 s 补间）、按 S 分步走 7 步。八层按 delay 0→0.60 错峰，t=1 时全部完成；C 着色 / X 透视可同时开启。' },
  { name: '昼夜', dist: FIT_D, dir: [0, 0.56, 0.83],
    text: '百叶 θ(t)=5°+25°(1−cos 2πt/86400) 驱动昼夜：白昼 55° 采光、夜晚 5° 闭合并亮城市夜光。按 T 切 60×/720× 加速看一天（720× 下一天 ≈ 2 分钟）。' },
];
let tourIdx = -1;
function tourShow() {
  const stn = TOUR[tourIdx];
  const text = typeof stn.text === 'function' ? stn.text() : stn.text;
  $('tourBox').innerHTML = `<b>${tourIdx + 1}/7 · ${stn.name}</b><br>${text}`;
  $('bTour').textContent = `导览 ${tourIdx + 1}/7`;
  $('bTour').classList.add('on');
  const dir = new THREE.Vector3(stn.dir[0], stn.dir[1], stn.dir[2]).normalize();
  tween.fromP.copy(camera.position); tween.fromT.copy(controls.target);
  tween.toT.set(0, 3, 0);
  tween.toP.copy(tween.toT).add(dir.multiplyScalar(stn.dist));
  tween.t = 0; tween.active = true; tween.dur = 1.15;   // 补间一律 1.15 s 墙钟
  controls.autoRotate = false;
}
function enterTour() { ST.tour = 1; tourIdx = 0; tourShow(); toast('导览开始 · [ ] 前后切换 · Esc 退出'); }
function exitTour() {
  ST.tour = 0; tourIdx = -1;
  $('tourBox').innerHTML = '';
  $('bTour').textContent = '导览 · 7 站';
  $('bTour').classList.remove('on');
  controls.autoRotate = !ST.focused;
  queueHash();                                  // 退出导览补写一次 hash
}
function tourStep(d) { tourIdx = Math.min(TOUR.length - 1, Math.max(0, tourIdx + d)); tourShow(); }
function toggleTour() { ST.tour ? exitTour() : enterTour(); }
$('bTour').addEventListener('click', toggleTour);
$('bPrev').addEventListener('click', () => tourStep(-1));
$('bNext').addEventListener('click', () => tourStep(1));

/* ── §21 FPS 看门狗（P1 #20：连续两窗口低于目标→降一档，只降不升） ── */

const watchdog = { win: 0, timer: 0, len: 2.0, manual: false };
function watchdogTick(dt) {
  watchdog.timer += dt;
  if (watchdog.timer < watchdog.len) return;    // 采样窗口 2 s
  watchdog.timer = 0;
  if (watchdog.manual || TIER === 0) return;
  const below = fpsEMA < FPS_TARGET[TIER];
  watchdog.win = below ? watchdog.win + 1 : 0;
  if (watchdog.win >= 2) {
    watchdog.win = 0;
    const prevTarget = FPS_TARGET[TIER];
    applyTier(TIER - 1, false, true);
    toast(`帧率连续两窗口低于 ${prevTarget}，已自动降为「${['低', '中', '高'][TIER]}」档`);
  }
}
// 手动切档（含 hash 还原）→ applyTier(manual=true) 关闭看门狗
$('bShot').addEventListener('click', ev => exportPNG(ev.shiftKey ? 4 : 2));
$('bSpec').addEventListener('click', exportSpectrum);
$('bSnd').addEventListener('click', toggleSound);
document.querySelectorAll('.tbtn2').forEach(b => b.addEventListener('click', () => applyTier(+b.dataset.t, true)));

/* ── §22 首屏演出（P2，简版）与 hash 还原 ─────────────────── */

if (location.hash.length <= 1) {                // 无 hash：3.2 s 推近开场；带 hash 跳过直接还原
  camera.position.set(0, FIT_D * 0.70, FIT_D * 1.04);   // 终点位置 ×1.25；再远地球球心会压到原点 32 → 罩住整环
  tween.fromP.copy(camera.position); tween.fromT.copy(controls.target);
  tween.toT.set(0, 3, 0);
  tween.toP.set(0, FIT_D * 0.56, FIT_D * 0.83);
  tween.t = 0; tween.active = true; tween.dur = 3.2;
  controls.autoRotate = false;                  // 演出结束由补间收尾 + autoRotate 恢复
  setTimeout(() => { if (!ST.focused && !ST.tour) controls.autoRotate = true; }, 3400);
}
// hash 还原移至全初始化完成后执行（tour/snd/led 依赖 §16–§22；原 R2 位置在 §14 末）
if (location.hash.length > 1) applyHash(parseHash(location.hash));

requestAnimationFrame(tick);

/* ── §11 公开 API（window.__TORUS__，均为本项目自定义函数） ── */

window.__TORUS__ = {
  version: VERSION,
  gravityAt,                                   // (rpm:number)=>number  地板 g 值
  dayNightPhase,                               // ()=>number  [0,1)
  parseHash,                                   // (hash:string)=>State  恒不抛异常（P0 #11）
  perf,                                        // ()=>PerfData  含逐组预算与两种 draw call 口径
  conservation,                                // ()=>ConservationData  生态+散热双读数（P1 #15）
  getAudioData: () => (audioOn && analyser) ? analyser : null,   // 未解锁返回 null（P1 #18）
  exportPNG,                                   // (scale:2|4)=>void  导出后恢复画布（P1 #19）
  spec: SPEC, energy: ENERGY, agri: AGRI, o2: O2,
  reg: REG, parts: PART_META, state: ST,       // 规格与运行态观察（自测辅助）
};
