// VLM-верификация Task 19 (крупные планы): шлюпки у пирса, тонущая
// шлюпка, берег с краболовками/вешалом
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
  await ask(zai, '/home/z/my-project/scripts/shots/t19_boats_close.png',
    `Крупный кадр у деревянного пирса в морской игре. Оцени СТРОГО, кратко:
1) ШЛЮПКИ: видна ли маленькая деревянная рыбацкая лодка/шлюпка на воде (с бортами, банками-скамьями, вёслами)?
2) ПРИЧАЛ: виден ли деревянный пирс со сваями?
3) ЛЮДИ: видны ли фигурки людей (рыбаков) на пирсе или в лодке?
4) ПОПЛАВКИ: маленькие оранжевые буи/поплавки на воде?
5) ВЕРДИКТ: сцена читается как рыбацкая гавань (да/нет)?`);
  await ask(zai, '/home/z/my-project/scripts/shots/t19_boat_sinking.png',
    `Кадр у пирса в морской игре, только что рядом разорвался снаряд. Оцени СТРОГО, кратко:
1) ЛОДКА: есть ли деревянная шлюпка, погружающаяся в воду — с креном, наполовину под водой, борт у самой воды?
2) ЭФФЕКТЫ: брызги/пена/щепки вокруг неё?
3) ВЕРДИКТ: шлюпка тонет (да/нет)?`);
  await ask(zai, '/home/z/my-project/scripts/shots/t19_beach_traps.png',
    `Кадр песчаного берега у пристани в морской игре. Оцени СТРОГО, кратко:
1) КРАБОЛОВКИ: видны ли небольшие клетчатые ящики-ловушки (каркас из реек)?
2) ШЛЮПКИ: лодки, вытащенные на песок?
3) ВЕШАЛО: конструкция из стоек с перекладиной, на которой висит рыба?
4) ВЕРДИКТ: берег выглядит как рыбацкий (да/нет)?`);
}
main().catch(e => { console.error('VLM fail:', e?.message || e); process.exit(1); });
