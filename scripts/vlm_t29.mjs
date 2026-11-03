// VLM-верификация Task 29: штормовой модуль sea.js
// (штормовое море с качкой; шлюпка на волнах; возврат на физическую)
import ZAI from 'z-ai-web-dev-sdk';
import { readFileSync } from 'node:fs';

async function ask(zai, file, prompt) {
  const b64 = readFileSync(file).toString('base64');
  const response = await zai.chat.completions.createVision({
    model: 'glm-4.6v',
    messages: [
      { role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
      ] },
    ],
    thinking: { type: 'disabled' },
  });
  console.log(`\n===== ${file.split('/').pop()} =====`);
  console.log(response.choices?.[0]?.message?.content ?? JSON.stringify(response).slice(0, 400));
}

async function main() {
  const zai = await ZAI.create();

  await ask(zai, '/home/z/my-project/scripts/shots/t29_storm_riding.png',
`Кадр морской игры: штормовое море (автономный модуль sea.js — волны Герстнера, качка корпуса shipPhysics.js). Ответь Да/Нет кратко:
1) Море с крупными волнами/валами, видна пена (барашки/обводка у корпуса)?
2) Корпус корабля на поверхности: палуба в основном над водой, не уходит целиком под волну?
3) Корпус наклонён по склону волны (крен или дифферент заметен)?
4) ВЕРДИКТ: штормовое море и качка выглядят живыми (да/нет)?`);

  await ask(zai, '/home/z/my-project/scripts/shots/t29_storm_boat.png',
`Кадр морской игры: шлюпка (ял) спущена на воду в штормовом море. Ответь Да/Нет кратко:
1) Малая лодка/шлюпка видна на воде?
2) Шлюпка держится на поверхности волн (не погружена целиком под воду)?
3) Вокруг лодки есть пена/бурун у носа?
4) ВЕРДИКТ: шлюпка на волнах шторма (да/нет)?`);

  await ask(zai, '/home/z/my-project/scripts/shots/t29_back_physical.png',
`Кадр морской игры после возврата с штормового модуля на обычную физическую модель воды. Ответь Да/Нет кратко:
1) Море отображается нормально (без артефактов/дыр/чёрного экрана)?
2) Корабль на плаву?
3) ВЕРДИКТ: вода после переключения модели в порядке (да/нет)?`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
