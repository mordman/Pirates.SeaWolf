// VLM: стволы gunmetal + якорь
import ZAI from 'z-ai-web-dev-sdk';
import { readFileSync } from 'node:fs';
async function ask(zai, file, prompt) {
  const b64 = readFileSync(file).toString('base64');
  const r = await zai.chat.completions.createVision({
    model: 'glm-4.6v',
    messages: [{ role: 'user', content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
    ]}],
    thinking: { type: 'disabled' },
  });
  console.log(`\n===== ${file.split('/').pop()} =====`);
  console.log(r.choices?.[0]?.message?.content ?? JSON.stringify(r).slice(0, 400));
}
async function main() {
  const zai = await ZAI.create();
  await ask(zai, '/home/z/my-project/scripts/shots/v37_gun_metal4.png',
`Кадр морской игры: палуба парусного корабля, на ней пушки. Оцени СТРОГО по пунктам, кратко:
1) ПУШКИ: сколько видно? На лафетах?
2) СТВОЛЫ: серо-стальные цилиндры — есть ли БЛИКИ/отсветы неба, градиент яркости по стволу, ощущение МЕТАЛЛА? Или матовые картонки?
3) ВЕРДИКТ: стволы читаются как металлические (да/нет)?`);
  await ask(zai, '/home/z/my-project/scripts/shots/v37_anchor_metal.png',
`Кадр морской игры: носовая часть парусного корабля снаружи, у скулы висит якорь. Оцени СТРОГО по пунктам, кратко:
1) ЯКОРЬ: виден ли (веретено-стержень, рога-дуга, лапы, кольцо-рым, деревянный шток)?
2) МЕТАЛЛ: детали якоря выглядят как тёмный металл с бликами/градиентом (не плоская заливка)?
3) ВЕРДИКТ: якорь читается как металлический предмет (да/нет)?`);
}
main().catch(e => { console.error('VLM fail:', e?.message || e); process.exit(1); });
