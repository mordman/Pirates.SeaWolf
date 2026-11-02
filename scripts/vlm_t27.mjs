// VLM-верификация Task 27: волна-опора vs физическая в шторм
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

  await ask(zai, '/home/z/my-project/scripts/shots/t27_riding_storm.png',
`Кадр морской игры: парусник в шторм на крупных волнах (модель «волна-опора» — корабль идёт по поверхности). Ответь Да/Нет кратко:
1) Море с КРУПНЫМИ волнами/валами, гребни с пеной?
2) Корпус корабля ДЕРЖИТСЯ НА ПОВЕРХНОСТИ воды (не уходит под воду целиком, палуба над водой)?
3) Корпул наклонён по склону волны (нос заметно выше или ниже кормы)?
4) ВЕРДИКТ: корабль на поверхности, качается на волнах (да/нет)?`);

  await ask(zai, '/home/z/my-project/scripts/shots/t27_physical_storm.png',
`Кадр морской игры: парусник в шторм (физическая модель — Архимед по точкам корпуса). Ответь Да/Нет кратко:
1) Море волнуется, волны с пеной у корпуса?
2) Корабль на плаву (палуба в основном над водой)?
3) Виден носовой бурун/брызги у форштевня?
4) ВЕРДИКТ: корабль взаимодействует с волнами (да/нет)?`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
