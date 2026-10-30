// VLM: берег (вешало+шлюпка+краболовки) и тонущая шлюпка с эффектами
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
  await ask(zai, '/home/z/my-project/scripts/shots/t19_beach_traps.png',
    `Кадр песчаного берега у пристани в морской игре. Оцени СТРОГО, кратко:
1) ШЛЮПКА: лодка, вытащенная на песок?
2) ВЕШАЛО: стойки с перекладиной, на которой висит рыба (серо-серебристые тушки)?
3) КРАБОЛОВКИ/СЕТИ: ящики-клетки или ворох сетей?
4) ВЕРДИКТ: берег выглядит как рыбацкий (да/нет)?`);
  await ask(zai, '/home/z/my-project/scripts/shots/t19_boat_sinking.png',
    `Кадр у пристани в морской игре: рядом с шлюпкой только что разорвался снаряд. Оцени СТРОГО, кратко:
1) ШЛЮПКА: деревянная лодка тонет — крен/погружение/борт у воды?
2) ЭФФЕКТЫ: брызги, пена, всплеск или щепки вокруг?
3) ВЕРДИКТ: шлюпку потопило (да/нет)?`);
}
main().catch(e => { console.error('VLM fail:', e?.message || e); process.exit(1); });
