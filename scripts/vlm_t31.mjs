// VLM-верификация Task 31: плавание/осадка/углы в настройках для всех
// моделей моря + ВТОРАЯ шлюпка («добавь еще одну»)
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

  await ask(zai, '/home/z/my-project/scripts/shots/t31_boats_davits.png',
`Кадр морской игры: парусный корабль на якоре, камера с кормы. У кормового среза на шлюпбалках (кранбалках) висят шлюпки-ялы. Ответь Да/Нет кратко:
1) Видны ДВЕ шлюпки — по одной у КАЖДОГО борта (зеркально, у кормового среза)?
2) Обе висят вдоль борта параллельно корпусу, носом в ту же сторону, что и корабль?
3) Кранбалки/тали (фалы) у обеих шлюпок выглядят аккуратно, шлюпки не проваливаются внутрь корпуса и не висят в воздухе далеко от борта?
4) ВЕРДИКТ: две шлюпки на бортах читаются как осмысленная деталь (да/нет)?`);

  await ask(zai, '/home/z/my-project/scripts/shots/t31_boat_rowers.png',
`Кадр морской игры: игрок в шлюпке-яле на воде (камера за шлюпкой). Ответь Да/Нет кратко:
1) Шлюпка НА поверхности воды (не под водой, не висит в воздухе)?
2) В шлюпке видны гребцы (фигурки людей на банках)?
3) За шлюпкой на воде есть след/рябь (вода живая)?
4) ВЕРДИКТ: плавание шлюпки выглядит живым (да/нет)?`);

  await ask(zai, '/home/z/my-project/scripts/shots/t31_panel_float.png',
`Скриншот настроек морской игры, вкладка «Погода», верх раздела «Плавание и посадка». Ответь Да/Нет кратко:
1) Есть заголовок раздела «Плавание и посадка (все модели моря)»?
2) Видны ползунки: «Осадка: глубже / мельче», «Осадка шлюпки», «Макс. крен»?
3) Ползунки аккуратны, подписи читаются, ничего не наезжает друг на друга?
4) ВЕРДИКТ: панель настроек плавания выглядит готовой (да/нет)?`);

  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
