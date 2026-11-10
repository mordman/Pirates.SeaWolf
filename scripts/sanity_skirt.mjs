// САНТИ-ЧЁК юбок тайлов (Task 38): повторяем индексную математику
// buildTile и убеждаемся — все индексы в границах буфера.
const TILE = 480;
function check(seg) {
  const side = seg + 1;
  const n = side * side;              // вершины сетки
  const border = [];
  for (let i = 0; i < side; i++) border.push(i);
  for (let i = 0; i < side; i++) border.push(seg * side + i);
  for (let j = 0; j < side; j++) border.push(j * side);
  for (let j = 0; j < side; j++) border.push(j * side + seg);
  const nb = border.length;
  const total = n + nb;               // всего вершин (сетка + юбка)

  // СТАРЫЙ код (баг): a2 = n + ИНДЕКС_ВЕРШИНЫ
  let oldBad = 0, oldMax = 0;
  for (const a of border) { const a2 = n + a; oldMax = Math.max(oldMax, a2); if (a2 >= total) oldBad++; }

  // НОВЫЙ код: a2 = n + ПОЗИЦИЯ_В_BORDER
  const idx = [];
  const pushQuad = (k, k2, flip = false) => {
    const a = border[k], b = border[k2];
    const a2 = n + k, b2 = n + k2;
    if (flip) idx.push(b, a, a2, b, a2, b2);
    else idx.push(a, b, b2, a, b2, a2);
  };
  for (let i = 0; i + 1 < side; i++) pushQuad(i, i + 1);
  for (let i = 0; i + 1 < side; i++) pushQuad(side + i, side + i + 1, true);
  for (let j = 0; j + 1 < side; j++) pushQuad(2 * side + j, 2 * side + j + 1, true);
  for (let j = 0; j + 1 < side; j++) pushQuad(3 * side + j, 3 * side + j + 1);
  const bad = idx.filter(v => v < 0 || v >= total);
  // покрывают ли юбки все дубли? каждый skirt-индекс n+k должен встречаться
  const used = new Set(idx.filter(v => v >= n));
  let missing = 0;
  for (let k = 0; k < nb; k++) if (!used.has(n + k)) missing++;

  console.log(`seg=${seg}: вершин=${total}, треугольников юбки=${idx.length / 3}`);
  console.log(`  СТАРЫЙ код: выходов за буфер ${oldBad}/${nb} (макс индекс ${oldMax} >= ${total} = ${oldMax >= total})`);
  console.log(`  НОВЫЙ код: выходов за буфер ${bad.length}, неиспользованных юбочных вершин ${missing}`);
  return bad.length === 0 && missing === 0 && oldBad > 0;
}
const ok1 = check(20);  // дальний тайл
const ok2 = check(60);  // ближний тайл
console.log(ok1 && ok2 ? 'САНТИ-ЧЁК: OK' : 'САНТИ-ЧЁК: ПРОВАЛ');
