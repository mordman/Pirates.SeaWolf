// VLM-верификация Task 30 (повтор): неправильная форма островов,
// берег с пальмами GLB, чайки в полёте, карта с полигонами берега
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

  await ask(zai, '/home/z/my-project/scripts/shots/t30_coast_aerial.png',
`Кадр морской пиратской игры: вид сверху-сбоку на остров. Ответь Да/Нет кратко:
1) Береговая линия острова НЕПРАВИЛЬНАЯ (вытянутый остров, бухты/мысы), а НЕ круглая/овальная «клякса»?
2) Нет широкой отмели вокруг острова (вода резко становится глубокой у кромки)?
3) На острове видна растительность (пальмы/кусты) и песчаный пляж?
4) ВЕРДИКТ: форма острова живая и неправильная (да/нет)?`);

  await ask(zai, '/home/z/my-project/scripts/shots/t30_beach_palms.png',
`Кадр морской игры: пляж острова с пальмами. Ответь Да/Нет кратко:
1) Пальмы выглядят как пальмы (ствол + крона из листьев)?
2) Помимо пальм видны камни/валуны или сухие пни?
3) Пальм на пляже несколько и стоят на суше (не в воде)?
4) ВЕРДИКТ: берег с растительностью выглядит хорошо (да/нет)?`);

  await ask(zai, '/home/z/my-project/scripts/shots/t30_gulls_flight.png',
`Кадр морской игры: вид с палубы корабля. Ответь Да/Нет кратко:
1) В небе видны чайки (белые птицы с крыльями)?
2) Чайки НЕ на одном месте — позы полётные, есть наклон/крен?
3) ВЕРДИКТ: чайки в полёте над кораблём есть (да/нет)?`);

  await ask(zai, '/home/z/my-project/scripts/shots/t30_map_polygons.png',
`Кадр игры: большая навигационная карта архипелага. Ответь Да/Нет кратко:
1) Острова на карте нарисованы НЕ кругами — контуры неправильные, вытянутые, с бухтами?
2) Есть подписи названий островов?
3) Есть роза ветров/компас и отметка корабля игрока?
4) ВЕРДИКТ: карта показывает неправильные формы берегов (да/нет)?`);

  await ask(zai, '/home/z/my-project/scripts/shots/t30_rock_island.png',
`Кадр морской игры: скальный остров с моря. Ответь Да/Нет кратко:
1) Остров скалистый, вытянутый/неправильной формы (не круглый)?
2) У берега нет широкой мели — вода тёмная/глубокая сразу у кромки?
3) ВЕРДИКТ: скальный остров выглядит естественно (да/нет)?`);
}

main().catch(e => { console.error('VLM FAIL:', e.message); process.exit(1); });
