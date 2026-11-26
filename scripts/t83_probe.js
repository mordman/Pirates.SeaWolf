// Task 83: проекция контрольных точек корабля в экранные координаты —
// потом по ним замерим реальные цвета пикселей на скриншоте.
(() => {
  const g = window.__game;
  const p = g.player;
  const vis = p.visual;
  const grp = vis.group;
  grp.updateWorldMatrix(true, true);
  // камера
  let cam = null;
  const findCam = (o) => { if (o && o.isPerspectiveCamera) cam = o; };
  g.scene.traverse(findCam);
  if (!cam && g.cameraRig) cam = g.cameraRig.camera;
  if (!cam) return 'нет камеры';
  cam.updateMatrixWorld(true);
  const canvas = document.querySelector('canvas');
  const W = canvas ? canvas.width : innerWidth;
  const H = canvas ? canvas.height : innerHeight;
  const L = p.preset.length;
  // контрольные точки (локальные координаты корабля)
  const prof0 = 0.5; // мидель
  const points = [
    ['планширь_борт_мидель', L * 0.1, 0, p.preset.freeboard * 0.95],
    ['планширь_борт_нос', L * 0.4, 0, p.preset.freeboard * 1.15],
    ['борт_ниже_планширя', L * 0.1, 0, p.preset.freeboard * 0.45],
    ['квартердек_настил', -L * 0.3, 0, p.preset.freeboard + (p.preset.quarter || 0) + 0.3],
    ['квартердек_перила', -L * 0.3, 0, p.preset.freeboard + (p.preset.quarter || 0) + 1.1],
    ['палуба_главная', 0, 0, p.preset.freeboard - 0.5],
  ];
  const v = new THREE.Vector3();
  const res = { W, H, pts: [] };
  for (const [name, lx, ly, lz] of points) {
    v.set(lx, lz, -ly); // в модели корабля y — высота
    grp.localToWorld(v.clone ? v : v);
    // localToWorld мутирует
    const world = v.clone();
    const ndc = world.clone().project(cam);
    res.pts.push({
      name,
      sx: Math.round((ndc.x + 1) / 2 * W),
      sy: Math.round((1 - (ndc.y + 1) / 2) * H),
      behind: ndc.z > 1,
    });
  }
  return JSON.stringify(res);
})()
