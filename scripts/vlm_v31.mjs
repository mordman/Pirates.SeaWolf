// VLM-верификация скриншота шторма: корабль должен идти ПОВЕРХНОСТЬЮ волн
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
  const prompt = `Кадр морской игры: парусный корабль в штормовом море, камера сбоку-сверху. Оцени СТРОГО по пунктам, кратко:
1) ВАТЕРЛИНИЯ: корпус входит в воду по ватерлинию (нормально, низ корпуса в воде) или висит НАД водой с зазором, или погружён слишком глубоко (палуба у самой воды)?
2) ГРЕБНИ: проходит ли гребень волны СКВОЗЬ корпус выше ватерлинии (сквозь палубу/борта)? Или корпус вскрывает гребень носом/бортом как нож — это нормально в шторм.
3) ПАЛУБА: горизонтальная палуба над водой? Видны ли фигурки экипажа НАД водой?
4) ВЕРДИКТ: корабль плывёт ПО поверхности волн (да/нет) и выглядит ли посадка естественно для шторма?`;
  await ask(zai, process.argv[2] || '/home/z/my-project/scripts/shots/v31_storm_t2.png', prompt);
  if (process.argv[3]) await ask(zai, process.argv[3], prompt);
}

main().catch(e => { console.error('VLM fail:', e?.message || e); process.exit(1); });
