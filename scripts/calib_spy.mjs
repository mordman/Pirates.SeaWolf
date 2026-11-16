// Калибровка позы «ПОДЗОРНАЯ ТРУБА У ГЛАЗА» (Task 77):
// прямая кинематика руки детальной фигуры (crewDetailed.ts,
// суставы shR→elR→handR→spyHand) — численный поиск углов плеча/
// локтя и поворота трубы в кисти, чтобы ОКУЛЯР оказался у ПРАВОГО
// глаза, а ось трубы смотрела ВПЕРЁД (к горизонту). Плюс: левая
// рука-подпорка под ствол и поза «дотянуться до пояса» (draw).
import * as THREE from 'three';

const h = 1;
const UP = 0.185 * h, FO = 0.155 * h;
const MOUNT = new THREE.Vector3(0, -0.042, 0.018);
// суставы в ПРОСТРАНСТВЕ ГРУДИ (chest)
const SH_R = new THREE.Vector3(-0.163 * h, 0.29 * h, 0.008);   // правое плечо
const SH_L = new THREE.Vector3(0.163 * h, 0.29 * h, 0.008);    // левое плечо
// правый глаз ≈ head(0,0.40,0) + (−0.036, 0.015, 0.10)
const EYEPIECE = new THREE.Vector3(-0.045, 0.415, 0.108);      // окуляр ВПЛОТНУЮ, уровень глаза
const AXIS_T = new THREE.Vector3(0, 0.16, 0.99).normalize();    // ось: строго вперёд
const BELT = new THREE.Vector3(-0.148, -0.21, -0.085);          // гнездо трубы (draw)

const EU = new THREE.Euler();
const quat = (x, y, z) => new THREE.Quaternion().setFromEuler(EU.set(x, y, z, 'XYZ'));

function arm(sh, angles) {
  const [shx, shy, shz, elx, elz] = angles;
  const qSh = quat(shx, shy, shz);
  const qFore = qSh.clone().multiply(quat(elx, 0, elz));
  const pEl = sh.clone().add(new THREE.Vector3(0, -UP, 0).applyQuaternion(qSh));
  const pHand = pEl.clone().add(new THREE.Vector3(0, -FO, 0).applyQuaternion(qFore));
  return { qSh, qFore, pEl, pHand };
}

function fkTube(angles, trx, trz) {
  const a = arm(SH_R, angles);
  // маунт кисти + смещение ТРУБЫ внутри него (как в updateSpyglassPhase)
  const pMount = a.pHand.clone().add(MOUNT.clone().applyQuaternion(a.qFore));
  const pOrigin = pMount.clone().add(new THREE.Vector3(0, -0.03, 0.012).applyQuaternion(a.qFore));
  const qTube = a.qFore.clone().multiply(quat(trx, 0, trz));
  const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(qTube);
  const eyePiece = pOrigin.clone().addScaledVector(axis, -0.088);  // окуляр (−Z конца)
  const objective = pOrigin.clone().addScaledVector(axis, 0.16);   // объектив
  return { ...a, pMount, pOrigin, axis, eyePiece, objective };
}

function costTube(v) {
  const [shx, shy, shz, elx, elz, trx, trz] = v;
  const f = fkTube([shx, shy, shz, elx, elz], trx, trz);
  let c = f.eyePiece.distanceTo(EYEPIECE) * 12;          // окуляр к глазу — главное
  c += (1 - f.axis.dot(AXIS_T)) * 6;                     // ось вперёд
  c += Math.abs(f.axis.x) * 14;                          // БЕЗ скоса вбок (строго вперёд)
  if (f.pEl.x > -0.03) c += 2;                           // локоть на своей стороне
  if (f.pEl.z < 0.0) c += 2;                             // локоть перед грудью
  if (f.pEl.y < 0.1) c += (0.1 - f.pEl.y) * 2;           // локоть не ниже пояса груди
  if (f.objective.z < 0.24) c += (0.24 - f.objective.z) * 5;  // объектив вперёд от лица
  if (f.pMount.z < 0.10) c += (0.10 - f.pMount.z) * 3;   // кулак перед лицом, не в щеке
  // компактная поза: рука НЕ вытянута (плечо не горизонтально,
  // локоть заметно согнут) — «труба у глаза», не «факел»
  if (shx < -1.45) c += (-1.45 - shx) * 1.6;
  if (elx > -1.05) c += (elx + 1.05) * 1.4;
  return c;
}

function costDraw(v) {
  const [shx, shy, shz, elx, elz] = v;
  const a = arm(SH_R, [shx, shy, shz, elx, elz]);
  let c = a.pHand.distanceTo(BELT) * 14;                 // кисть к гнезду за поясом
  if (a.pEl.y > 0.18) c += (a.pEl.y - 0.18) * 3;         // локоть вниз (рука опущена)
  if (a.pEl.x > -0.02) c += 1;
  return c;
}

function costSupport(v, tubeA, tubeB) {
  const [shx, shy, shz, elx, elz] = v;
  const a = arm(SH_L, [shx, shy, shz, elx, elz]);
  // расстояние от кисти до ОТРЕЗКА ствола (любая точка хвата)
  const ab = tubeB.clone().sub(tubeA);
  const t = THREE.MathUtils.clamp(a.pHand.clone().sub(tubeA).dot(ab) / ab.lengthSq(), 0.15, 0.95);
  const near = tubeA.clone().addScaledVector(ab, t);
  let c = a.pHand.distanceTo(near) * 16;                 // кисть к стволу
  if (a.pEl.x < 0.02) c += 1;                            // локоть на своей стороне (+X)
  if (a.pEl.y < 0.12) c += (0.12 - a.pEl.y) * 2;
  if (a.pHand.y < 0.2) c += (0.2 - a.pHand.y) * 2;       // кисть повыше (у лица)
  c += Math.abs(elx) * 0.06;                             // локоть слегка согнут (не палка)
  return c;
}

const rnd = (a, b) => a + Math.random() * (b - a);
function search(cost, ranges, n = 60000) {
  let best = null;
  for (let i = 0; i < n; i++) {
    const v = ranges.map(r => rnd(r[0], r[1]));
    const c = cost(v);
    if (!best || c < best.c) best = { c, v };
  }
  let step = 0.25;
  for (let round = 0; round < 200; round++) {
    let improved = false;
    for (let i = 0; i < best.v.length; i++) {
      for (const s of [step, -step]) {
        const cand = best.v.slice();
        cand[i] += s;
        const c = cost(cand);
        if (c < best.c) { best = { c, v: cand }; improved = true; }
      }
    }
    if (!improved) step *= 0.5;
    if (step < 0.002) break;
  }
  return best;
}

// ---- 1. OBSERVE: окуляр у глаза, ось вперёд ----
const tube = search(costTube, [
  [-2.4, 0.6], [-0.9, 0.9], [-1.1, 0.2],   // плечо x/y/z
  [-2.8, -0.1], [-0.7, 0.7],               // локоть x/z
  [-3.4, 3.4], [-0.9, 0.9],                // труба в кисти rx/rz
]);
const f = fkTube(tube.v.slice(0, 5), tube.v[5], tube.v[6]);
console.log('=== OBSERVE (рука с трубой) ===');
console.log('cost =', tube.c.toFixed(4));
console.log('sh[%.2f, %.2f, %.2f]  el[%.2f, 0, %.2f]',
  ...tube.v.slice(0, 5).map(x => +x.toFixed(2)));
console.log('tubeInHand.rotation.set(%.3f, 0, %.3f)', +tube.v[5].toFixed(3), +tube.v[6].toFixed(3));
console.log('окуляр:', f.eyePiece.toArray().map(x => +x.toFixed(3)), '(цель', EYEPIECE.toArray().map(x => +x.toFixed(3)), ')');
console.log('ось:', f.axis.toArray().map(x => +x.toFixed(3)), '(цель', AXIS_T.toArray().map(x => +x.toFixed(3)), ')');
console.log('локоть:', f.pEl.toArray().map(x => +x.toFixed(3)), 'кулак:', f.pMount.toArray().map(x => +x.toFixed(3)),
  'объектив:', f.objective.toArray().map(x => +x.toFixed(3)));

// ---- 2. ПОДПОРКА: левая кисть под ствол (любой хват вдоль) ----
const tubeA = f.pMount.clone().addScaledVector(f.axis, -0.02);
const tubeB = f.pMount.clone().addScaledVector(f.axis, 0.20);
const sup = search(v => costSupport(v, tubeA, tubeB), [
  [-2.2, 0.6], [-0.9, 0.9], [-0.2, 1.1],
  [-2.8, -0.1], [-0.7, 0.7],
]);
const supArm = arm(SH_L, sup.v);
console.log('\n=== ПОДПОРКА (левая рука) ===');
console.log('cost =', sup.c.toFixed(4));
console.log('sh[%.2f, %.2f, %.2f]  el[%.2f, 0, %.2f]',
  ...sup.v.map(x => +x.toFixed(2)));
console.log('кисть:', supArm.pHand.toArray().map(x => +x.toFixed(3)),
  '(ствол:', tubeA.toArray().map(x => +x.toFixed(3)), '→', tubeB.toArray().map(x => +x.toFixed(3)), ')');

// ---- 3. DRAW: кисть к гнезду за поясом ----
const draw = search(costDraw, [
  [-0.2, 1.2], [-0.9, 0.9], [-1.0, 0.2],
  [-2.6, -0.1], [-0.7, 0.7],
]);
const drawArm = arm(SH_R, draw.v);
console.log('\n=== DRAW (дотянуться до пояса) ===');
console.log('cost =', draw.c.toFixed(4));
console.log('sh[%.2f, %.2f, %.2f]  el[%.2f, 0, %.2f]',
  ...draw.v.map(x => +x.toFixed(2)));
console.log('кисть:', drawArm.pHand.toArray().map(x => +x.toFixed(3)),
  '(пояс:', BELT.toArray().map(x => +x.toFixed(3)), ')');

// ---- зеркальные значения (рука с трубой ЛЕВАЯ, крюк справа) ----
console.log('\n=== ЗЕРКАЛО (mr=-1): подписи для левой руки ===');
console.log('sh[%.2f, %.2f, %.2f]  el[%.2f, 0, %.2f]',
  tube.v[0], -tube.v[1], -tube.v[2], tube.v[3], -tube.v[4]);

// ---- 4. КЛАССИКА (crew.ts): рука-меш с запечённым локтем ----
// капитан: legH=.62 torsoH=.62 torsoW=.40 → shoulderY=1.19, hipY=.62
// рука: пивот (−0.25, 1.19, 0.01); кисть H в локале руки (mkArmMesh)
const CL_PIVOT = new THREE.Vector3(-0.25, 1.19, 0.01);
const CL_H = new THREE.Vector3(-0.071, -0.470, 0.238);   // запечённая кисть
const CL_EYE = new THREE.Vector3(-0.02, 1.33, 0.20);      // перед лицом (чуть ниже глаза)
function classicFk(ax, az, ph, ps, ta) {
  const qArm = quat(ax, 0, az);
  const pHand = CL_PIVOT.clone().add(CL_H.clone().applyQuaternion(qArm));
  const qTube = qArm.clone().multiply(quat(ph, ps, ta));
  const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(qTube);
  const eyePiece = pHand.clone().addScaledVector(axis, -0.08);
  return { pHand, axis, eyePiece };
}
function costClassic(v) {
  const [ax, az, ph, ps, ta] = v;
  const f = classicFk(ax, az, ph, ps, ta);
  let c = f.eyePiece.distanceTo(CL_EYE) * 7;
  c += (1 - f.axis.dot(AXIS_T)) * 10;
  if (f.pHand.y < 1.02) c += (1.02 - f.pHand.y) * 3;   // кисть у лица
  if (f.pHand.z < 0.05) c += (0.05 - f.pHand.z) * 3;   // перед грудью
  if (f.pHand.x > 0.06) c += (f.pHand.x - 0.06) * 4;   // не через всё тело
  if (Math.abs(az) > 0.8) c += (Math.abs(az) - 0.8) * 2;  // поза без «завязывания»
  return c;
}
const cls = search(costClassic, [
  [-1.9, -0.5], [0.0, 1.0], [-3.4, 3.4], [-1.3, 1.3], [-0.9, 0.9],
], 80000);
const clf = classicFk(...cls.v);
console.log('\n=== КЛАССИКА (рука-меш, труба у лица) ===');
console.log('cost =', cls.c.toFixed(4));
console.log('arm.rotation.set(%.3f, 0, %.3f)', +cls.v[0].toFixed(3), +cls.v[1].toFixed(3));
console.log('tube.rotation.set(%.3f, %.3f, %.3f)',
  +cls.v[2].toFixed(3), +cls.v[3].toFixed(3), +cls.v[4].toFixed(3));
console.log('окуляр:', clf.eyePiece.toArray().map(x => +x.toFixed(3)),
  '(глаз:', CL_EYE.toArray().map(x => +x.toFixed(3)), ')');
console.log('ось:', clf.axis.toArray().map(x => +x.toFixed(3)));
console.log('кисть:', clf.pHand.toArray().map(x => +x.toFixed(3)));
