import ZAI from 'z-ai-web-dev-sdk';
import { readFileSync } from 'node:fs';
async function ask(zai, file, prompt) {
  const b64 = readFileSync(file).toString('base64');
  const r = await zai.chat.completions.createVision({
    model: 'glm-4.6v',
    messages: [{ role: 'user', content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
    ]}],
    thinking: { type: 'disabled' },
  });
  console.log(`\n===== ${file.split('/').pop()} =====`);
  console.log(r.choices?.[0]?.message?.content ?? 'NO ANSWER');
}
async function main() {
  const zai = await ZAI.create();
  await ask(zai, '/home/z/my-project/scripts/shots/t29_v2_storm_day.png',
`Кадр морской игры: ШТОРМОВОЕ МОРЕ (модуль sea.js), ветер 18 м/с, полдень. Палитра штормового моря — тёмная сине-бирюзовая (глубина), светлее к гребням. Ответь Да/Нет кратко:
1) Видно МОРСКИЕ ВОЛНЫ с гребнями (рельеф поверхности, не плоская текстура)?
2) У гребней/вокруг корпуса видна пена (белые/светлые участки)?
3) Корабль на поверхности, палуба над водой?
4) Корпус наклонён (качка на волнах)?
5) ВЕРДИКТ: штормовое море выглядит живым (да/нет)?`);
  await ask(zai, '/home/z/my-project/scripts/shots/t29_v2_boat.png',
`Кадр морской игры: игрок в ШЛЮПКЕ (ял) на штормовом море, камера рядом с лодкой. Ответь Да/Нет кратко:
1) Малая шлюпка/лодка видна на воде?
2) Она держится на поверхности волн?
3) Вокруг неё пена/след на воде?
4) ВЕРДИКТ: шлюпка на штормовых волнах (да/нет)?`);
  await ask(zai, '/home/z/my-project/scripts/shots/t29_v2_waves.png',
`Кадр морской игры: штормовое море крупным планом. Ответь Да/Нет кратко:
1) Видны крупные валы/гребни волн?
2) Пена на гребнях (белые пятна)?
3) ВЕРДИКТ: волны читаются как шторм (да/нет)?`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
