// VLM-верификация Task 19: убранные вёсла вдоль борта (не вверх),
// рыбацкая гавань (лодки/краболовки/поплавки), топящаяся шлюпка,
// падение мачты с обвязкой
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
  await ask(zai, '/home/z/my-project/scripts/shots/t19_oars_stowed.png',
    `Кадр морской игры: гребная галера сбоку, вёсла УБРАНЫ. Оцени СТРОГО, кратко:
1) ВЁСЛА: вёсла лежат ВДОЛЬ борта (валами к корме, горизонтально у планширя) или торчат ВЕРТИКАЛЬНО ВВЕРХ как палки? Или воткнуты куда-то в корпус?
2) Есть ли у борта какие-то посторонние палки, торчащие вверх или влево сквозь корпус?
3) ВЕРДИКТ: убранные вёсла выглядят аккуратно у борта (да/нет)?`);
  await ask(zai, '/home/z/my-project/scripts/shots/t19_port_fishing.png',
    `Кадр морской игры: гавань с деревянным пирсом. Оцени СТРОГО, кратко:
1) ПРИЧАЛ: виден деревянный пирс/пристань?
2) ЛОДКИ: у пирса или на берегу есть маленькие рыбацкие шлюпки?
3) ДЕТАЛИ: видны ли краболовки (клетки-ящики), вешала с рыбой, поплавки на воде, фигурки людей на пирсе?
4) ВЕРДИКТ: гавань выглядит как рыбацкая деревня с деталями (да/нет)?`);
  await ask(zai, '/home/z/my-project/scripts/shots/t19_boat_sinking.png',
    `Кадр морской игры у пирса. Оцени СТРОГО, кратко:
1) Видна ли шлюпка, которая ТОНЕТ — погружена в воду с креном, над водой остался борт/нос?
2) Летят ли обломки/щепки или брызги вокруг?
3) ВЕРДИКТ: шлюпка реально тонет (да/нет)?`);
  await ask(zai, '/home/z/my-project/scripts/shots/t19_mast_rigging.png',
    `Кадр морской игры: парусное судно, у которого сломана одна мачта. Оцени СТРОГО, кратко:
1) МАЧТА: одна из мачт упала/завалилась вбок-вперёд (вместе с реем и парусом)?
2) ОБВЯЗКА: у УПАВШЕЙ мачты оборвались ванты/штаги (тонкие тросы к борту), а у СТОЯЩИХ мачт тросы на месте?
3) ВЕРДИКТ: сломанная мачта упала вместе со всем, что её держало (да/нет)?`);
}
main().catch(e => { console.error('VLM fail:', e?.message || e); process.exit(1); });
