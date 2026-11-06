// VLM-верификация Task 33: единое море (Герстнер + FBM), прибой у
// островов, простая физика в шторм, каркас по категориям
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

  await ask(zai, '/home/z/my-project/scripts/shots/t33_surf.png',
`Кадр морской игры: штормовое море у скалистого острова (горы поднимаются прямо от берега), корабль на якоре неподалёку. Ответь Да/Нет кратко:
1) У берега острова видна БЕЛАЯ ПОЛОСА ПРИБОЯ (пена там, где волны разбиваются о сушу)?
2) Волны у самого берега ниже/спокойнее, чем в открытом море (гаснут)?
3) Остров с горами от самой береговой линии (крутой скальный берег)?
4) ВЕРДИКТ: волны разбиваются об остров правдоподобно (да/нет)?`);

  await ask(zai, '/home/z/my-project/scripts/shots/t33_simple_storm.png',
`Кадр морской игры: парусный корабль в штормовом море (режим «простая физика» — корабль скользит ПО поверхности волн). Ответь Да/Нет кратко:
1) Корабль НА поверхности воды (не утонул, не под водой)?
2) Палуба в основном НАД водой (борта не уходят глубоко под волну)?
3) Волны крупные, с пеной на гребнях — читается шторм?
4) ВЕРДИКТ: корабль держится на волнах, не проваливается внутрь них (да/нет)?`);

  await ask(zai, '/home/z/my-project/scripts/shots/t33_wireframe.png',
`Кадр морской игры в режиме «каркас» (треугольники без текстур): включён каркас воды и корабля. Ответь Да/Нет кратко:
1) Поверхность воды видна как ТРЕУГОЛЬНАЯ СЕТКА (wireframe)?
2) Корпус/паруса корабля тоже видны как каркас из треугольников?
3) Сетка воды покрывает море до горизонта?
4) ВЕРДИКТ: режим «только треугольники» читается ясно (да/нет)?`);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
