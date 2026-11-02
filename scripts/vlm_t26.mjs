// VLM-верификация Task 26: шлюпка бортом к борту + след от лодки + ровный киль
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

  await ask(zai, '/home/z/my-project/scripts/shots/t26_boat_side.png',
`Кадр морской игры: парусник, вид с кормового ракурса. Вдоль БОРТА корабля на кранбалках-шлюпбалках висит гребная шлюпка (ял). Ответь СТРОГО и кратко, только то что ВИДНО:
1) Шлюпка висит ВДОЛЬ борта большого корабля, СВОИМ БОРТОМ к его борту (не за кормой, не поперёк) — да/нет?
2) Острый нос шлюпки направлен в ту же сторону, что и нос корабля?
3) Шлюпка висит ровно, килем вниз, не перевёрнута, не цепляет борт?
4) Видны фалы/тали (верёвки) от шлюпбалок к шлюпке?
5) ВЕРДИКТ: шлюпка «бортом к борту» с корпусом (да/нет)?`);

  await ask(zai, '/home/z/my-project/scripts/shots/t26_boat_wake.png',
`Кадр морской игры: гребная шлюпка (ял) с гребцами на воде, вид сверху-сзади. Ответь СТРОГО и кратко, только то что ВИДНО:
1) За кормой шлюпки по воде тянется СЛЕД — пенная дорожка/кильватерная полоса?
2) След идёт именно от шлюпки, расширяется/рассеивается кзади?
3) Вёсла у бортов, гребцы на банках?
4) ВЕРДИКТ: у лодки есть след на воде (да/нет)?`);

  await ask(zai, '/home/z/my-project/scripts/shots/t26_ship_level.png',
`Кадр морской игры: парусник на якоре в спокойном море, вид с борта (профиль). Ответь СТРОГО и кратко, только то что ВИДНО:
1) Корпус стоит РОВНО на воде (нос НЕ зарывается в воду, корма не задрана — нет сильного дифферента на нос)?
2) НОС корабля над водой, палуба у форштевня сухая и выше ватерлинии?
3) Корма тоже над водой?
4) ВЕРДИКТ: корабль на ровном киле, нос не в воде (да/нет)?`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
