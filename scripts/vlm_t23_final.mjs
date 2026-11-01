// Финальная VLM-верификация Task 23
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

  await ask(zai, '/home/z/my-project/scripts/shots/t23_stern_davits.png',
`Кадр морской игры: корма тёмного парусника, вид сзади-сбоку. Ответь СТРОГО и кратко, только то что ВИДНО:
1) За транцем ПОДВЕШЕНА шлюпка на наклонных шлюпбалках (кранбалки над кормой)?
2) Шлюпка длиной ВДОЛЬ корабля, носом к носу?
3) Шлюпка над водой, ничего не пересекает?
4) Форма — настоящая лодка (острый нос, круглые борта)?
5) ВЕРДИКТ: шлюпка прикреплена сзади на шлюпбалках (да/нет)?`);

  await ask(zai, '/home/z/my-project/scripts/shots/t23_qd_broadside.png',
`Кадр морской игры: борт кормовой надстройки (квартердека) тёмного фрегата, вид сбоку. Ответь СТРОГО и кратко:
1) Боковина (сплошная часть над фальшбортом): ГЛАДКАЯ единая поверхность ИЛИ секции-коробки со швами/лесенкой?
2) Цвет боковины, стоек и поручня: В ТОН тёмного корпуса ИЛИ светлый (крем/золото)?
3) Поручень идёт плавной линией?
4) ВЕРДИКТ: боковинка гладкая и в цвет корпуса (да/нет)?`);

  await ask(zai, '/home/z/my-project/scripts/shots/t23_stair_rail.png',
`Кадр морской игры: трап (лесенка) на приподнятую кормовую надстройку. Ответь СТРОГО и кратко:
1) Поручень трапа НАКЛОНЁН вдоль ступеней ИЛИ горизонтален?
2) Перила трапа тёмные (в тон корпуса)?
3) ВЕРДИКТ: перила под углом вдоль подъёма (да/нет)?`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
