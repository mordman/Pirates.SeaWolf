// VLM-верификация Task 24
import ZAI from 'z-ai-web-dev-sdk';
import { readFileSync } from 'node:fs';

async function ask(zai, file, prompt) {
  const b64 = readFileSync(file).toString('base64');
  const response = await zai.chat.completions.createVision({
    model: 'glm-4.6v',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      },
    ],
    thinking: { type: 'disabled' },
  });
  console.log(`\n===== ${file.split('/').pop()} =====`);
  console.log(response.choices?.[0]?.message?.content ?? JSON.stringify(response).slice(0, 400));
}

async function main() {
  const zai = await ZAI.create();

  await ask(zai, '/home/z/my-project/scripts/shots/t24_boat_stern.png',
`Кадр морской игры: корма парусника, за транцем на наклонных шлюпбалках (кранбалки) висит шлюпка. Ответь СТРОГО и кратко, только то что ВИДНО:
1) Шлюпка выглядит как НАСТОЯЩАЯ гребная лодка (острый нос, плоская корма-транец, поднятые борта к концам, планширь-доска по кромке)?
2) Нос шлюпки направлен ОТ корабля (в сторону от кормы, на зрителя/вдоль)?
3) Видны банки (скамейки) внутри, вёсла, руль на транце?
4) Шлюпка висит на верёвках/талях от кранбалок?
5) ВЕРДИКТ: настоящая шлюпка-ял развёрнута носом от корабля (да/нет)?`);

  await ask(zai, '/home/z/my-project/scripts/shots/t24_crew_busy.png',
`Кадр морской игры: палуба крупного парусника сверху-сбоку, на палубе много матросов. Ответь СТРОГО и кратко:
1) Матросы СТОЯТ столбами неподвижно ИЛИ изображены в ПОЗАХ движения/работы (шаг, наклон, ходьба)?
2) Видны фигуры у пушек (наклонившиеся), ходящие вдоль бортов?
3) Толпа выглядит ЖИВОЙ (разные позы/направления) ИЛИ строем?
4) ВЕРДИКТ: экипаж занят делом, не стоит на месте (да/нет)?`);

  await ask(zai, '/home/z/my-project/scripts/shots/t24_boat_afloat.png',
`Кадр морской игры: небольшая гребная шлюпка на морской воде. Ответь СТРОГО и кратко:
1) Шлюпка ПЛАВАЕТ на воде (по ватерлинию, не под водой и не в воздухе)?
2) Внутри видны ГРЕБЦЫ (сидят на банках спиной к носу)?
3) Вёсла раскинуты по бортам на уключинах?
4) Вода/брызги вокруг выглядят правдоподобно?
5) ВЕРДИКТ: спущенная на воду шлюпка с гребцами (да/нет)?`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
